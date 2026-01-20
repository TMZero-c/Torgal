# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import collect_dynamic_libs
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import collect_all

datas = [('config.py', '.'), ('audio.py', '.'), ('embeddings.py', '.'), ('logger.py', '.'), ('runtime.py', '.'), ('slides.py', '.'), ('triggers.py', '.'), ('pre_process.py', '.')]
binaries = []
hiddenimports = ['faster_whisper', 'sentence_transformers', 'numpy', 'ctranslate2', 'transformers', 'tokenizers', 'huggingface_hub', 'torch', 'tqdm', 'av']
datas += collect_data_files('faster_whisper')
datas += collect_data_files('sentence_transformers')
binaries += collect_dynamic_libs('torch')
binaries += collect_dynamic_libs('ctranslate2')
hiddenimports += collect_submodules('faster_whisper')
hiddenimports += collect_submodules('ctranslate2')
tmp_ret = collect_all('nvidia.cublas')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('nvidia.cuda_runtime')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('nvidia.cudnn')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pytest', 'unittest', 'tensorflow', 'keras', 'jax', 'flax', 'sphinx', 'IPython', 'jupyter', 'notebook', 'matplotlib'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
