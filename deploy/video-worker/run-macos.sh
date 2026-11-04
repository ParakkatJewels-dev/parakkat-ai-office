#!/bin/zsh
set -euo pipefail
worker_dir="${0:A:h}"
if [[ "${1:-}" == "--check-resolve" ]]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
  exec "$(command -v python3)" "$worker_dir/worker.py" --check-resolve
fi
if [[ ! -f "$worker_dir/config.env" ]]; then
  print -u2 "Copy config.env.example to config.env and fill in the Mac paths and worker token."
  exit 1
fi
set -a
source "$worker_dir/config.env"
set +a
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
exec "$(command -v python3)" "$worker_dir/worker.py" "$@"
