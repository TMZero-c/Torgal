"""
Runtime helpers (CUDA DLL path, platform specifics).
"""
import os
import sys


def setup_cuda_dlls() -> None:
    """Add CUDA DLL directories to PATH when running in a venv on Windows."""
    venv_path = os.path.dirname(os.path.dirname(sys.executable))
    for subdir in ["cublas", "cudnn"]:
        dll_path = os.path.join(venv_path, "Lib", "site-packages", "nvidia", subdir, "bin")
        if os.path.exists(dll_path):
            os.add_dll_directory(dll_path)
            os.environ["PATH"] = dll_path + os.pathsep + os.environ.get("PATH", "")