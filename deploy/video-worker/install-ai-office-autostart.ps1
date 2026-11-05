$ErrorActionPreference = 'Stop'
$workerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Join-Path $workerDir 'subscription.env'
$runner = Join-Path $workerDir 'keep-ai-office-editor-online.ps1'

if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
    throw 'subscription.env is missing. Keep your existing private file in this video-worker folder.'
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    throw 'The AI Office startup runner is missing. Download the latest worker package.'
}
if (-not (Test-Path -LiteralPath (Join-Path $workerDir '.mcp.json') -PathType Leaf)) {
    throw 'The Claude channel configuration is missing from this video-worker folder.'
}

$startup = [Environment]::GetFolderPath('Startup')
if (-not $startup) { throw 'Windows Startup folder could not be found for this account.' }
New-Item -ItemType Directory -Force -Path $startup | Out-Null
$shortcutPath = Join-Path $startup 'AI Office Video Editor.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '"'
$shortcut.WorkingDirectory = $workerDir
$shortcut.WindowStyle = 1
$shortcut.Description = 'Keeps the local AI Office Claude video channel connected after Windows sign-in'
$shortcut.Save()

Write-Host 'AI Office Video Editor will start automatically when you sign in to Windows.'
Write-Host 'Worker code updates will continue downloading automatically while the editor is running.'
