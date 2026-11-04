#!/bin/zsh
set -euo pipefail
worker_dir="${0:A:h}"
if [[ ! -f "$worker_dir/config.env" ]]; then
  print -u2 "Create config.env before installing the worker."
  exit 1
fi
chmod 700 "$worker_dir/run-macos.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
plist="$HOME/Library/LaunchAgents/com.parakkat.video-worker.plist"
/usr/bin/python3 - "$plist" "$worker_dir" "$HOME" <<'PY'
import plistlib, sys
from pathlib import Path
target, folder, home = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
data = {
    'Label': 'com.parakkat.video-worker',
    'ProgramArguments': [str(folder / 'run-macos.sh')],
    'WorkingDirectory': str(folder),
    'RunAtLoad': True,
    'KeepAlive': True,
    'StandardOutPath': str(home / 'Library/Logs/parakkat-video-worker.log'),
    'StandardErrorPath': str(home / 'Library/Logs/parakkat-video-worker.error.log'),
}
target.write_bytes(plistlib.dumps(data))
PY
launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
print "Video worker installed for this logged-in user. Logs: ~/Library/Logs/parakkat-video-worker*.log"
