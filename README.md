# Torgal

Local-first AI presentation assistant that listens to your talk and advances slides automatically.

<img width="1919" height="996" alt="Screenshot 2026-01-18 075259" src="https://github.com/user-attachments/assets/86987248-8188-4930-aebb-ac656e73ad5f" />

## What it is

Torgal is a desktop presenter app built with Electron + Python. It captures microphone audio, transcribes speech on-device, and matches what you’re saying to slide content to advance at the right moment. No cloud API required.

## Highlights

- **On-device speech-to-text** via `faster-whisper` (CPU or NVIDIA CUDA).
- **Semantic slide matching** using `sentence-transformers` embeddings with recency/keyword boosts.
- **Dual-window flow** (presenter view + slideshow output).
- **Slide parsing** from PDF into images + text using PyMuPDF.
- **Voice commands** like “next slide”, “previous slide”, “slide 5”, “first/last slide”.
- **Q&A mode** for global matching (easier non-adjacent jumps).
- **Preferences UI** to tune thresholds, models, audio gating, and cache settings.

## How it works

1. **Parse slides**: the selected PDF is rendered into per-slide images and extracted text.
2. **Embed slides**: text is encoded into vectors for semantic matching.
3. **Stream audio**: mic audio is streamed to a Python server over IPC.
4. **Match & advance**: speech is transcribed and matched to the most likely slide.

## Tech stack

- **Electron** for the desktop UI (presenter + slideshow windows).
- **Python** backend for transcription, embeddings, and matching.
- **faster-whisper**, **sentence-transformers**, **PyMuPDF**.

## Download & run (Windows)

1. **Grab a release asset**

- CPU build: works on any Windows machine (slower but smaller).
- GPU build: requires an NVIDIA GPU with CUDA drivers (faster, very large).

1. **Extract and launch**

- Unzip the downloaded asset and run the app executable inside the folder.
- Allow microphone permissions when prompted.

1. **First run model download**

- The first launch downloads Whisper + embedding models (several GB).
- Expect a longer startup time the first time only.

1. **Split GPU zip assets**

- If the GPU zip is split into parts, download every `.part00x` file.
- Rejoin before unzipping (Windows example):
  - CMD: `copy /b torgal-win32-x64-1.0.0.zip.part001 + torgal-win32-x64-1.0.0.zip.part002 torgal-win32-x64-1.0.0.zip`
  - PowerShell: `Get-Content .\torgal-win32-x64-1.0.0.zip.part001, .\torgal-win32-x64-1.0.0.zip.part002 -Encoding Byte -ReadCount 0 | Set-Content .\torgal-win32-x64-1.0.0.zip -Encoding Byte`

## Setup from source (dev)

1. **Create configs**

- `app/example.config.js` → `app/config.js`
- `python/example.config.py` → `python/config.py`

1. **Python setup** (CPU or GPU)

- CPU: install `python/requirements-cpu.txt`
- GPU: install PyTorch with CUDA, then `python/requirements-gpu.txt`

1. **Install app deps**

- Run `npm install` inside `app/`.

1. **Start the app**

- `npm run start` from `app/`
- Optional flags: `-- --gpu` or `-- --cpu` to prefer a venv.

> Torgal auto-detects Python envs in `.venv`, `.venv-gpu`, or `.venv-cpu` at repo root.

## Voice commands

These are parsed before embeddings and trigger immediate actions:

- “next slide”, “previous slide”
- “slide 7” / “go to slide 7”
- “first slide”, “last slide”

## Configuration

- **App-side audio settings**: `app/config.js`
- **Python matching/model settings**: `python/config.py`
- **Runtime overrides**: environment variables prefixed with `TORGAL_` (see `python/config.py`).

## Model downloads & cache

- Model files are cached in the user’s HuggingFace cache (typically `~/.cache/huggingface`).
- You can open or clear the cache from the Preferences window in the app.

## Build & packaging (Windows)

The repo includes a PowerShell build pipeline that creates CPU and/or GPU bundles:

- `./build.ps1 -SetupVenvs` creates `.venv-cpu` and `.venv-gpu`.
- `./build.ps1 -Variant cpu|gpu|both` builds the Python exe(s) and packages the Electron app.

Output:

- CPU: `app/out/make-cpu/...`
- GPU: `app/out/make-gpu/...`

## Release note (GPU builds)

GPU builds are large and can exceed GitHub’s 2 GB per-asset limit. If you upload to Releases, split the zip into multiple parts and upload each part separately.
