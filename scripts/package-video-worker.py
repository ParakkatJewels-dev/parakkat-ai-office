#!/usr/bin/env python3
"""Package the tracked Windows worker files without private environment files."""
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / 'deploy' / 'downloads' / 'video-worker.zip'


def main():
    files = subprocess.check_output(['git', 'ls-files', '-z', 'deploy/video-worker'], cwd=ROOT).decode().split('\0')
    source_files = [Path(name) for name in files if name]
    if not source_files or not any(path.name == '.mcp.json' for path in source_files):
        raise RuntimeError('Worker sources or hidden MCP configuration are missing')
    forbidden = {'subscription.env', 'config.env', '.env', 'auth.json'}
    if any(path.name in forbidden or 'node_modules' in path.parts for path in source_files):
        raise RuntimeError('A private worker file was selected for packaging')
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(DESTINATION, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source in source_files:
            archive.write(ROOT / source, Path('video-worker') / source.relative_to('deploy/video-worker'))
    print(f'Packaged {len(source_files)} worker files into {DESTINATION}')


if __name__ == '__main__':
    main()
