@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-ai-office-autostart.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
start "AI Office Video Editor" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0keep-ai-office-editor-online.ps1"
