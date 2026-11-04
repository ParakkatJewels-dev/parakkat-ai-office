$ErrorActionPreference = 'Stop'
$workerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path -LiteralPath (Join-Path $workerDir 'config.env'))) {
    throw 'Create config.env and pass run-windows.cmd --check before installing startup.'
}
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Parakkat Video Worker.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $workerDir 'run-windows.cmd'
$shortcut.WorkingDirectory = $workerDir
$shortcut.WindowStyle = 7
$shortcut.Description = 'Starts the local AI Office video worker after sign-in'
$shortcut.Save()
Write-Host "Installed startup shortcut: $shortcutPath"
Write-Host 'Keep Windows signed in and DaVinci Resolve Studio open for editing jobs.'
