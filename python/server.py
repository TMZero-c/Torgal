"""
Streaming transcription server with slide matching.
Uses LocalAgreement policy for stable word detection.
"""
import sys, os, json, base64
import numpy as np

# Add CUDA DLLs to PATH
venv_path = os.path.dirname(os.path.dirname(sys.executable))
for subdir in ["cublas", "cudnn"]:
    p = os.path.join(venv_path, "Lib", "site-packages", "nvidia", subdir, "bin")
    if os.path.exists(p):
        os.add_dll_directory(p)
        os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel
from slides import SlideMatcher

SAMPLE_RATE = 16000

def log(msg):
    print(f"[server] {msg}", file=sys.stderr, flush=True)

def send(msg):
    print(json.dumps(msg), flush=True)


class Transcriber:
    """Streaming transcription with LocalAgreement for stability."""
    
    def __init__(self, model):
        self.model = model
        self.buffer = np.array([], dtype=np.float32)
        self.last_words = []
    
    def add_audio(self, pcm_bytes):
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buffer = np.concatenate([self.buffer, samples])
        # Keep max 15 seconds
        max_samples = 15 * SAMPLE_RATE
        if len(self.buffer) > max_samples:
            self.buffer = self.buffer[-max_samples:]
    
    def process(self):
        """Returns (confirmed_words, partial_words)"""
        if len(self.buffer) < SAMPLE_RATE:  # Need 1 second
            return [], []
        
        segments, _ = self.model.transcribe(
            self.buffer, beam_size=1, language="en",
            word_timestamps=True, vad_filter=True,
            condition_on_previous_text=False
        )
        
        words = []
        for seg in segments:
            if seg.words:
                words.extend({"word": w.word.strip(), "end": w.end} for w in seg.words)
        
        # LocalAgreement: confirm words that match previous transcription
        confirmed = []
        if self.last_words and words:
            for i, (last, curr) in enumerate(zip(self.last_words, words)):
                if last["word"].lower() == curr["word"].lower():
                    confirmed.append(curr["word"])
                else:
                    break
            
            # Trim confirmed audio from buffer
            if confirmed and words[len(confirmed)-1]["end"]:
                trim = int(words[len(confirmed)-1]["end"] * SAMPLE_RATE)
                if 0 < trim < len(self.buffer):
                    self.buffer = self.buffer[trim:]
        
        self.last_words = words
        partial = [w["word"] for w in words[len(confirmed):]]
        return confirmed, partial
    
    def reset(self):
        self.buffer = np.array([], dtype=np.float32)
        self.last_words = []


def main():
    log("Loading Whisper model...")
    model = WhisperModel("small.en", device="cuda", compute_type="float16")
    log("Model loaded!")
    
    log("Loading slides...")
    matcher = SlideMatcher()
    log(f"Loaded {len(matcher.slides)} slides")
    
    transcriber = Transcriber(model)
    text_window = []  # Rolling window of recent words
    
    # Send ready with slide info
    slides_info = [{"index": s.index, "title": s.title} for s in matcher.slides]
    send({"type": "ready", "slides": slides_info, "current_slide": 0})
    
    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
            
            if msg["type"] == "audio":
                transcriber.add_audio(base64.b64decode(msg["data"]))
                confirmed, partial = transcriber.process()
                
                if confirmed:
                    send({"type": "final", "text": " ".join(confirmed)})
                    
                    # Update window and check for slide transition
                    text_window.extend(confirmed)
                    text_window = text_window[-25:]  # Keep last 25 words
                    matcher.add_words(len(confirmed))
                    
                    transition = matcher.check(" ".join(text_window))
                    if transition:
                        send(transition)
                        text_window.clear()
                
                if partial:
                    send({"type": "partial", "text": " ".join(partial)})
            
            elif msg["type"] == "goto_slide":
                matcher.goto(msg.get("index", 0))
                text_window.clear()
                send({"type": "slide_set", "current_slide": matcher.current})
            
            elif msg["type"] == "reset":
                transcriber.reset()
                matcher.reset()
                text_window.clear()
                send({"type": "reset_done", "current_slide": 0})
                
        except Exception as e:
            log(f"Error: {e}")

if __name__ == "__main__":
    main()
