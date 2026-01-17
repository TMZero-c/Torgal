"""
Optimal streaming transcription using LocalAgreement policy.
Key insight: Only emit words that are "stable" across multiple transcription passes.
Uses a sliding window of audio and word-level timestamps.
"""
import sys
import os
import json
import base64
import numpy as np

# Add CUDA DLLs to PATH
venv_path = os.path.dirname(os.path.dirname(sys.executable))
for subdir in ["cublas", "cudnn"]:
    p = os.path.join(venv_path, "Lib", "site-packages", "nvidia", subdir, "bin")
    if os.path.exists(p):
        os.add_dll_directory(p)
        os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel

SAMPLE_RATE = 16000

def log(msg):
    print(f"[server] {msg}", file=sys.stderr, flush=True)

def send(msg):
    print(json.dumps(msg), flush=True)


class StreamingTranscriber:
    def __init__(self, model):
        self.model = model
        self.audio_buffer = np.array([], dtype=np.float32)
        self.confirmed_text = []  # Words we've committed
        self.last_words = []  # Words from previous transcription
        self.min_chunk_sec = 1.0  # Process every 1 second
        self.buffer_max_sec = 15.0  # Keep max 15 seconds of audio context
        
    def add_audio(self, pcm_int16):
        """Add audio samples (int16) to buffer"""
        samples = np.frombuffer(pcm_int16, dtype=np.int16).astype(np.float32) / 32768.0
        self.audio_buffer = np.concatenate([self.audio_buffer, samples])
        
        # Trim buffer if too long
        max_samples = int(self.buffer_max_sec * SAMPLE_RATE)
        if len(self.audio_buffer) > max_samples:
            self.audio_buffer = self.audio_buffer[-max_samples:]
    
    def should_process(self):
        """Check if we have enough audio to process"""
        return len(self.audio_buffer) >= int(self.min_chunk_sec * SAMPLE_RATE)
    
    def process(self):
        """Transcribe and return (confirmed_words, partial_words)"""
        if len(self.audio_buffer) < SAMPLE_RATE * 0.5:  # Need at least 0.5s
            return [], []
        
        # Transcribe with word timestamps
        segments, _ = self.model.transcribe(
            self.audio_buffer,
            beam_size=1,
            language="en",
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=300),
            condition_on_previous_text=False,
            no_speech_threshold=0.5,
        )
        
        # Extract words with timestamps
        current_words = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    current_words.append({
                        "word": w.word.strip(),
                        "start": w.start,
                        "end": w.end,
                        "prob": w.probability
                    })
        
        # LocalAgreement: find words that match between this and last transcription
        confirmed_new = []
        
        if self.last_words and current_words:
            # Find matching prefix between last and current transcription
            match_count = 0
            for i, (last_w, curr_w) in enumerate(zip(self.last_words, current_words)):
                if last_w["word"].lower() == curr_w["word"].lower():
                    match_count += 1
                else:
                    break
            
            # Confirm matched words (they appeared in 2 consecutive transcriptions)
            if match_count > 0:
                confirmed_new = [w["word"] for w in current_words[:match_count]]
                
                # Trim audio buffer to remove confirmed audio
                if match_count > 0 and current_words[match_count - 1]["end"]:
                    trim_time = current_words[match_count - 1]["end"]
                    trim_samples = int(trim_time * SAMPLE_RATE)
                    if trim_samples > 0 and trim_samples < len(self.audio_buffer):
                        self.audio_buffer = self.audio_buffer[trim_samples:]
        
        # Save current words for next comparison
        self.last_words = current_words
        
        # Return confirmed and partial (unconfirmed) words
        partial = [w["word"] for w in current_words[len(confirmed_new):]]
        
        return confirmed_new, partial
    
    def reset(self):
        self.audio_buffer = np.array([], dtype=np.float32)
        self.confirmed_text = []
        self.last_words = []


def main():
    log("Loading Whisper model (small.en + GPU)...")
    model = WhisperModel("small.en", device="cuda", compute_type="float16")
    log("Model loaded!")
    
    transcriber = StreamingTranscriber(model)
    send({"type": "ready"})
    
    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
            
            if msg["type"] == "audio":
                audio_bytes = base64.b64decode(msg["data"])
                transcriber.add_audio(audio_bytes)
                
                if transcriber.should_process():
                    confirmed, partial = transcriber.process()
                    
                    if confirmed:
                        text = " ".join(confirmed)
                        send({"type": "final", "text": text})
                    
                    if partial:
                        text = " ".join(partial)
                        send({"type": "partial", "text": text})
            
            elif msg["type"] == "reset":
                transcriber.reset()
                send({"type": "reset_done"})
            
            elif msg["type"] == "ping":
                send({"type": "pong"})
                
        except Exception as e:
            log(f"Error: {e}")
            import traceback
            traceback.print_exc(file=sys.stderr)

if __name__ == "__main__":
    main()
