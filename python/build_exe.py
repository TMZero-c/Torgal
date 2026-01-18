"""
Build script to create standalone executables using PyInstaller.
Run this before packaging the Electron app.

Usage:
    cd python
    pip install pyinstaller
    python build_exe.py
"""
import subprocess
import sys

def build():
    # Common PyInstaller options
    common_opts = [
        '--noconfirm',
        '--clean',
        '--log-level=WARN',
    ]
    
    # Build server.exe
    print("Building server executable...")
    subprocess.run([
        sys.executable, '-m', 'PyInstaller',
        *common_opts,
        '--name=server',
        '--onedir',  # onedir is faster to start than onefile
        '--add-data=config.py;.',
        '--add-data=audio.py;.',
        '--add-data=embeddings.py;.',
        '--add-data=logger.py;.',
        '--add-data=runtime.py;.',
        '--add-data=slides.py;.',
        '--add-data=triggers.py;.',
        '--add-data=pre_process.py;.',
        '--hidden-import=faster_whisper',
        '--hidden-import=sentence_transformers',
        '--hidden-import=numpy',
        '--collect-all=faster_whisper',
        '--collect-all=sentence_transformers',
        '--collect-all=ctranslate2',
        'server.py'
    ], check=True)
    
    # Build parse_slides.exe
    print("Building parse_slides executable...")
    subprocess.run([
        sys.executable, '-m', 'PyInstaller',
        *common_opts,
        '--name=parse_slides',
        '--onedir',
        '--add-data=config.py;.',
        '--add-data=logger.py;.',
        '--hidden-import=fitz',
        '--hidden-import=pptx',
        '--collect-all=pymupdf',
        '--collect-all=python-pptx',
        'parse_slides.py'
    ], check=True)
    
    print("\n✅ Build complete! Executables are in python/dist/")
    print("   - dist/server/server.exe")
    print("   - dist/parse_slides/parse_slides.exe")

if __name__ == '__main__':
    build()
