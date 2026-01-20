# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import collect_submodules

datas = [('config.py', '.'), ('audio.py', '.'), ('embeddings.py', '.'), ('logger.py', '.'), ('runtime.py', '.'), ('slides.py', '.'), ('triggers.py', '.'), ('pre_process.py', '.')]
hiddenimports = ['faster_whisper', 'sentence_transformers', 'numpy', 'ctranslate2', 'transformers', 'tokenizers', 'huggingface_hub', 'torch', 'tqdm', 'av']
datas += collect_data_files('faster_whisper')
datas += collect_data_files('sentence_transformers')
hiddenimports += collect_submodules('faster_whisper')
hiddenimports += collect_submodules('ctranslate2')


a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pytest', 'tensorflow', 'keras', 'jax', 'flax', 'sphinx', 'IPython', 'jupyter', 'notebook', 'matplotlib'],
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
