@echo off
cd /d "%~dp0" || exit /b 1
set "ANTHROPIC_API_KEY="
py -3 remote_edit.py check
if errorlevel 1 (
  echo Resolve or FFmpeg is not ready. Fix the message above and try again.
  pause
  exit /b 1
)
claude remote-control
if errorlevel 1 pause
