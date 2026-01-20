"""
Runtime helpers (CUDA DLL path, platform specifics).
"""
import os
import sys


def setup_cuda_dlls() -> None:
    """Add CUDA DLL directories to PATH when running on Windows.
    
    Works for both:
    - Dev mode: venv with nvidia packages in site-packages
    - Bundled mode: PyInstaller bundles DLLs in _internal folder
    """
    # Check if we're running as a PyInstaller bundle
    if getattr(sys, 'frozen', False):
        # PyInstaller bundles everything - DLLs should already be on PATH
        # But we may need to add the _internal folder explicitly
        bundle_dir = os.path.dirname(sys.executable)
        internal_dir = os.path.join(bundle_dir, '_internal')
        if os.path.exists(internal_dir):
            os.add_dll_directory(internal_dir)
            os.environ["PATH"] = internal_dir + os.pathsep + os.environ.get("PATH", "")
        return
    
    # Dev mode: look for nvidia packages in venv
    venv_path = os.path.dirname(os.path.dirname(sys.executable))
    for subdir in ["cublas", "cudnn"]:
        dll_path = os.path.join(venv_path, "Lib", "site-packages", "nvidia", subdir, "bin")
        if os.path.exists(dll_path):
            os.add_dll_directory(dll_path)
            os.environ["PATH"] = dll_path + os.pathsep + os.environ.get("PATH", "")