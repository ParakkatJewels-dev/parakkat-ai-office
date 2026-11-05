$ErrorActionPreference = 'Stop'
$workerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $workerDir 'run-ai-office-subscription.ps1'
$resolveExe = Join-Path $env:ProgramFiles 'Blackmagic Design\DaVinci Resolve\Resolve.exe'

Set-Location $workerDir
Write-Host 'AI Office Video Editor will reconnect automatically while this window stays open.'
Write-Host 'Sign in to Windows to keep this editor available. Close this window to stop it.'

while ($true) {
    if (-not (Get-Process -Name Resolve -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $resolveExe)) {
        try {
            Start-Process -FilePath $resolveExe | Out-Null
            Write-Host 'Starting DaVinci Resolve Studio...'
        } catch {
            Write-Warning "Could not start Resolve automatically: $($_.Exception.Message)"
        }
    }

    try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher
        if ($LASTEXITCODE -ne 0) { Write-Warning "AI Office editor exited with code $LASTEXITCODE." }
    } catch {
        Write-Warning "AI Office editor could not start: $($_.Exception.Message)"
    }

    Write-Host 'Trying again in 30 seconds. Close this window to stop.'
    Start-Sleep -Seconds 30
}
