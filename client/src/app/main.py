"""
Audio processing server for presentation co-pilot.
Communicates with Electron via stdin/stdout JSON lines.
"""

import sys
import json
import base64
import io
import numpy as np

# Will be used for STT
from faster_whisper import WhisperModel


def log(message: str):
    """Log to stderr so it doesn't interfere with stdout protocol."""
    print(f"[server] {message}", file=sys.stderr, flush=True)


def send(msg: dict):
    """Send a JSON message to Electron."""
    print(json.dumps(msg), flush=True)


def main():
    log("Starting audio server...")
    
    # Load Whisper model (tiny.en for speed)
    log("Loading Whisper model...")
    model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
    log("Model loaded!")
    
    # Signal ready
    send({"type": "ready"})
    
    # Main message loop
    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
            msg_type = msg.get("type")
            
            if msg_type == "audio":
                # TODO: Process audio chunk
                # audio_data = base64.b64decode(msg["data"])
                send({"type": "transcript", "text": "[placeholder]"})
            
            elif msg_type == "ping":
                send({"type": "pong"})
            
            elif msg_type == "quit":
                log("Shutting down...")
                break
                
        except json.JSONDecodeError as e:
            log(f"JSON decode error: {e}")
        except Exception as e:
            log(f"Error: {e}")
            send({"type": "error", "message": str(e)})


if __name__ == "__main__":
    main()