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
    log("="*50)
    log("SERVER STARTING")
    log("="*50)
    log("Loading Whisper model (distil-medium.en on CUDA)...")
    model = WhisperModel("distil-medium.en", device="cuda", compute_type="float16")
    log("Whisper model loaded!")
    
    matcher = None  # Will be created when slides are loaded
    transcriber = Transcriber(model)
    text_window = []
    
    log("Sending 'ready' to Electron")
    send({"type": "ready"})
    log("Waiting for messages on stdin...")
    
    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
            
            if msg["type"] == "audio":
                transcriber.add_audio(base64.b64decode(msg["data"]))
                confirmed, partial = transcriber.process()
                
                # Filter out empty strings
                confirmed = [w for w in confirmed if w and w.strip()]
                partial = [w for w in partial if w and w.strip()]
                
                if confirmed:
                    log(f"CONFIRMED: {' '.join(confirmed)}")
                    send({"type": "final", "text": " ".join(confirmed)})
                    
                    # Check slide transition if slides are loaded
                    if matcher:
                        text_window.extend(confirmed)
                        text_window = text_window[-15:]  # Smaller window = more responsive
                        matcher.add_words(len(confirmed))
                        
                        window_text = " ".join(text_window).strip()
                        if window_text:
                            log(f"Text window: {len(text_window)} words")
                            transition = matcher.check(window_text)
                            if transition:
                                log(f"SENDING TRANSITION: {transition['from_slide']} → {transition['to_slide']}")
                                send(transition)
                                text_window.clear()
                
                if partial:
                    send({"type": "partial", "text": " ".join(partial)})
            
            elif msg["type"] == "load_slides":
                log("="*50)
                log("LOADING SLIDES")
                log("="*50)
                # Load slides from parsed PDF/PPTX
                from slides import Slide, SlideMatcher
                slides_data = msg.get("slides", [])
                log(f"Received {len(slides_data)} slides from main.js")
                for i, s in enumerate(slides_data):
                    title = s.get('title', '')
                    content = s.get('content', '')
                    log(f"  Slide {i}: title={type(title).__name__}:'{str(title)[:30]}' content={type(content).__name__}:{len(str(content))} chars")
                slides = [Slide(i, s.get("title", f"Slide {i+1}"), s.get("content", "")) 
                          for i, s in enumerate(slides_data)]
                matcher = SlideMatcher(slides=slides)
                text_window.clear()
                log(f"SlideMatcher created with {len(slides)} slides")
                log("Sending slides_ready to Electron")
                send({"type": "slides_ready", "count": len(slides)})
            
            elif msg["type"] == "goto_slide":
                if matcher:
                    matcher.goto(msg.get("index", 0))
                    text_window.clear()
                    send({"type": "slide_set", "current_slide": matcher.current})
            
            elif msg["type"] == "reset":
                transcriber.reset()
                if matcher:
                    matcher.reset()
                text_window.clear()
                send({"type": "reset_done", "current_slide": 0})
                
        except Exception as e:
            import traceback
            log(f"Error: {e}")
            log(traceback.format_exc())

if __name__ == "__main__":
    main()
