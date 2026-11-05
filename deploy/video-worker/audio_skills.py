#!/usr/bin/env python3
"""Set up the pinned audio skills inside this worker folder when an edit needs them."""
import hashlib
import json
import shutil
import subprocess
import sys
import venv
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'vendor' / 'earshot-source-591fa3e.zip'
SOURCE_SHA256 = '7d9c63126c5fc372ce43519057e308bd0a439eb2583918553121703ba7b14713'
VENV = HERE / '.audio-skills-venv'
EARSHOT_PYTHON = VENV / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
REAL_SFX = HERE / '.claude' / 'skills' / 'real-sfx'
UISFX_PACKAGE = REAL_SFX / 'vendor' / 'node_modules' / 'uisfx' / 'package.json'


def earshot_ready():
    return EARSHOT_PYTHON.is_file() and subprocess.run(
        [str(EARSHOT_PYTHON), '-c',
         'from importlib.metadata import version; import earshot, numpy, soundfile; assert version("earshot") == "0.4.0"'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode == 0


def check():
    source_ok = SOURCE.is_file() and hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_SHA256
    earshot_ok = earshot_ready()
    try:
        uisfx_ok = json.loads(UISFX_PACKAGE.read_text(encoding='utf-8')).get('version') == '0.4.0'
    except (OSError, ValueError):
        uisfx_ok = False
    print(f'Pinned earshot source: {"ready" if source_ok else "missing or changed"}')
    print(f'Earshot Python tools: {"ready" if earshot_ok else "not installed"}')
    real_sfx_ok = (REAL_SFX / 'SKILL.md').is_file() and (REAL_SFX / 'config.json').is_file()
    print(f'Real SFX skill: {"ready" if real_sfx_ok else "not configured"}')
    print(f'CC0 UI sounds: {"ready" if uisfx_ok else "not installed"}')
    return source_ok and earshot_ok and real_sfx_ok and uisfx_ok


def install():
    if not SOURCE.is_file() or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise RuntimeError('Pinned earshot source archive is missing or changed')
    if not (REAL_SFX / 'SKILL.md').is_file():
        raise RuntimeError('Real SFX skill is missing; update the AI Office worker first')

    config = REAL_SFX / 'config.json'
    if not config.exists():
        subprocess.run([sys.executable, str(REAL_SFX / 'scripts' / 'setup.py'), 'init'], check=True)

    try:
        uisfx = json.loads(UISFX_PACKAGE.read_text(encoding='utf-8')).get('version') == '0.4.0'
    except (OSError, ValueError):
        uisfx = False
    if not uisfx:
        npm = shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm')
        if not npm:
            raise RuntimeError('Node.js npm is required for the Real SFX UI sound pack')
        subprocess.run([npm, 'install', 'uisfx@0.4.0', '--prefix', str(REAL_SFX / 'vendor'),
                        '--no-audit', '--no-fund'], check=True, timeout=600)

    if not EARSHOT_PYTHON.is_file():
        venv.EnvBuilder(with_pip=True).create(VENV)
    if not earshot_ready():
        subprocess.run([str(EARSHOT_PYTHON), '-m', 'pip', 'install', '--disable-pip-version-check',
                        '--no-input', str(SOURCE)], check=True, timeout=3600)
    if not check():
        raise RuntimeError('Audio skill setup did not complete')
    print('Earshot model-based commands download their pinned model files on first use (~1.1 GB).')
    print('Add a local recorded sound library with real-sfx/scripts/setup.py before using non-UI Real SFX sounds.')


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ('check', 'install'):
            raise ValueError('Usage: py -3 audio_skills.py check|install')
        if sys.argv[1] == 'check':
            raise SystemExit(0 if check() else 1)
        install()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f'AI Office audio skills: {error}', file=sys.stderr)
        raise SystemExit(1) from error
