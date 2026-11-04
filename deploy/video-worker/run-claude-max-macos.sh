#!/bin/zsh
set -e
cd "${0:A:h}"
unset ANTHROPIC_API_KEY
python3 remote_edit.py check
exec claude remote-control
