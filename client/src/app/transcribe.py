# transcribe.py
import sys
import json
from faster_whisper import WhisperModel

def transcribe(file_path):
    # Use 'tiny' or 'base' for speed on standard CPUs
    model = WhisperModel("base", device="cpu", compute_type="int8")
    
    # transcribe returns a generator (segments) and info
    segments, info = model.transcribe(file_path, beam_size=5)
    
    results = []
    for segment in segments:
        results.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip()
        })
        
    # Print as JSON so Electron can easily parse it
    print(json.dumps({"segments": results, "language": info.language}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        transcribe(sys.argv[1])