@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-ai-office-subscription.ps1"
if errorlevel 1 pause
