import sys
import json
from faster_whisper import WhisperModel

# Load model once at startup (tiny.en is fastest)
model = WhisperModel("tiny.en", device="cpu", compute_type="int8")

def transcribe(file_path):
    segments, _ = model.transcribe(file_path, beam_size=1, vad_filter=True)
    text = " ".join(seg.text.strip() for seg in segments)
    print(json.dumps({"text": text}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        transcribe(sys.argv[1])