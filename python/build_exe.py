"""
Build script to create standalone executables using PyInstaller.
Run this before packaging the Electron app.

Usage:
    cd python
    pip install pyinstaller
    python build_exe.py           # Build CPU version only (default)
    python build_exe.py --gpu     # Build GPU version only
    python build_exe.py --both    # Build both CPU and GPU versions
"""
import subprocess
import sys
import argparse
import os
import shutil

# Packages to exclude for smaller builds
EXCLUDE_PACKAGES = [
    # Testing/dev tools
    'pytest', 'unittest', 'test', 'tests',
    # Unused ML backends
    'tensorflow', 'keras', 'jax', 'flax',
    # Documentation
    'sphinx', 'docutils',
    # Jupyter (not needed for runtime)
    'IPython', 'jupyter', 'notebook', 'ipykernel',
    # Unused torch extensions (if not using GPU)
    'torch.distributed', 'torch.testing',
    # Large optional deps
    'matplotlib', 'pandas', 'scipy.sparse',
]

# CUDA libraries to exclude for CPU-only builds
CUDA_EXCLUDES = [
    'nvidia', 'cuda', 'cudnn', 'cublas', 'cufft', 'curand', 'cusolver', 'cusparse',
    'nccl', 'nvrtc', 'torch_cuda', 'libnvrtc', 'libcudart',
]

def get_folder_size(folder):
    """Get total size of a folder in bytes."""
    total = 0
    if os.path.exists(folder):
        for dirpath, dirnames, filenames in os.walk(folder):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                total += os.path.getsize(fp)
    return total

def build_variant(variant='cpu', output_suffix=''):
    """Build a single variant (cpu or gpu)."""
    include_gpu = (variant == 'gpu')
    dist_folder = f'dist{output_suffix}'
    
    # Common PyInstaller options
    common_opts = [
        '--noconfirm',
        '--clean',
        '--log-level=WARN',
        f'--distpath={dist_folder}',
        f'--workpath=build/{variant}',
    ]
    
    # Add excludes
    excludes = EXCLUDE_PACKAGES.copy()
    if not include_gpu:
        excludes.extend(CUDA_EXCLUDES)
        print(f"\n🔧 Building CPU-only version → {dist_folder}/")
    else:
        print(f"\n🔧 Building GPU/CUDA version → {dist_folder}/")
    
    for pkg in excludes:
        common_opts.append(f'--exclude-module={pkg}')
    
    # Build server.exe
    print("\n📦 Building server executable...")
    server_cmd = [
        sys.executable, '-m', 'PyInstaller',
        *common_opts,
        '--name=server',
        '--onefile',  # Single standalone exe
        '--add-data=config.py;.',
        '--add-data=audio.py;.',
        '--add-data=embeddings.py;.',
        '--add-data=logger.py;.',
        '--add-data=runtime.py;.',
        '--add-data=slides.py;.',
        '--add-data=triggers.py;.',
        '--add-data=pre_process.py;.',
        # Use explicit imports instead of collect-all (smaller)
        '--hidden-import=faster_whisper',
        '--hidden-import=sentence_transformers',
        '--hidden-import=numpy',
        '--hidden-import=ctranslate2',
        '--hidden-import=transformers',
        '--hidden-import=tokenizers',
        '--hidden-import=huggingface_hub',
        '--hidden-import=torch',
        '--hidden-import=tqdm',
        '--hidden-import=av',
        # Collect only essential submodules
        '--collect-submodules=faster_whisper',
        '--collect-submodules=ctranslate2',
        '--collect-data=faster_whisper',
        '--collect-data=sentence_transformers',
        'server.py'
    ]
    subprocess.run(server_cmd, check=True)
    
    # Build parse_slides.exe
    print("\n📦 Building parse_slides executable...")
    subprocess.run([
        sys.executable, '-m', 'PyInstaller',
        *common_opts,
        '--name=parse_slides',
        '--onefile',  # Single standalone exe
        '--add-data=config.py;.',
        '--add-data=logger.py;.',
        '--hidden-import=fitz',
        '--hidden-import=pymupdf',
        # Use collect-submodules instead of collect-all
        '--collect-submodules=pymupdf',
        '--collect-data=pymupdf',
        'parse_slides.py'
    ], check=True)
    
    # Show size
    server_size = os.path.getsize(f'{dist_folder}/server.exe') if os.path.exists(f'{dist_folder}/server.exe') else 0
    slides_size = os.path.getsize(f'{dist_folder}/parse_slides.exe') if os.path.exists(f'{dist_folder}/parse_slides.exe') else 0
    total_mb = (server_size + slides_size) / (1024**2)
    
    print(f"\n✅ {variant.upper()} build complete!")
    print(f"   📁 {dist_folder}/server.exe ({server_size / (1024**2):.1f} MB)")
    print(f"   📁 {dist_folder}/parse_slides.exe ({slides_size / (1024**2):.1f} MB)")
    print(f"   📊 Total: {total_mb:.1f} MB")
    
    return total_mb

def build(mode='cpu'):
    """Build executables based on mode."""
    
    if mode == 'both':
        print("=" * 50)
        print("🚀 Building BOTH CPU and GPU versions")
        print("=" * 50)
        
        # Build CPU version
        cpu_size = build_variant('cpu', '-cpu')
        
        # Build GPU version
        gpu_size = build_variant('gpu', '-gpu')
        
        # Also copy CPU to default dist/ for Electron packaging
        if os.path.exists('dist'):
            shutil.rmtree('dist')
        shutil.copytree('dist-cpu', 'dist')
        
        print("\n" + "=" * 50)
        print("🎉 All builds complete!")
        print("=" * 50)
        print(f"\n   dist-cpu/  → CPU-only ({cpu_size:.1f} MB) - Smaller, works everywhere")
        print(f"   dist-gpu/  → GPU/CUDA ({gpu_size:.1f} MB) - Faster with NVIDIA GPU")
        print(f"   dist/      → Default (CPU copy for Electron packaging)")
        
    elif mode == 'gpu':
        build_variant('gpu', '')
        
    else:  # cpu (default)
        build_variant('cpu', '')
    
    print("\n📝 Next step: cd ../app && npm run make")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build Torgal Python executables')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--gpu', action='store_true', help='Build GPU/CUDA version only')
    group.add_argument('--both', action='store_true', help='Build both CPU and GPU versions')
    args = parser.parse_args()
    
    if args.both:
        build('both')
    elif args.gpu:
        build('gpu')
    else:
        build('cpu')
