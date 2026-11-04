$ErrorActionPreference = 'Stop'
$workerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $workerDir 'subscription.env'
if (-not (Test-Path -LiteralPath $configPath)) {
    Copy-Item (Join-Path $workerDir 'subscription.env.example') $configPath
    throw 'Edit subscription.env beside this launcher, then start it again. Keep VIDEO_WORKER_TOKEN private.'
}
$allowed = @('VIDEO_OFFICE_URL', 'VIDEO_WORKER_TOKEN', 'VIDEO_MEDIA_ROOT', 'VIDEO_EXPORT_ROOT')
foreach ($line in Get-Content -LiteralPath $configPath) {
    if ($line -match '^\s*(#|$)') { continue }
    if ($line -notmatch '^\s*([A-Z][A-Z0-9_]*)=(.*)$') { throw 'Invalid subscription.env line. Use NAME=value.' }
    $name = $matches[1]
    if ($name -notin $allowed) { throw "Unknown subscription setting: $name" }
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $value = [Environment]::ExpandEnvironmentVariables($value)
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}
if (-not $env:VIDEO_OFFICE_URL -or -not $env:VIDEO_OFFICE_URL.StartsWith('https://')) { throw 'VIDEO_OFFICE_URL must use HTTPS.' }
if (-not $env:VIDEO_WORKER_TOKEN -or $env:VIDEO_WORKER_TOKEN.Length -lt 32 -or $env:VIDEO_WORKER_TOKEN.StartsWith('replace-')) { throw 'Set the same long VIDEO_WORKER_TOKEN as the AI Office server.' }
if (-not (Test-Path -LiteralPath $env:VIDEO_MEDIA_ROOT -PathType Container)) { throw "Source folder does not exist: $env:VIDEO_MEDIA_ROOT" }
if (-not $env:VIDEO_EXPORT_ROOT) { throw 'Set VIDEO_EXPORT_ROOT.' }
New-Item -ItemType Directory -Force -Path $env:VIDEO_EXPORT_ROOT | Out-Null
$env:ANTHROPIC_API_KEY = $null
$env:ANTHROPIC_AUTH_TOKEN = $null
$env:CLAUDE_CODE_OAUTH_TOKEN = $null
$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) { throw 'Install Python 3.10 or newer.' }
& $python.Source -3 (Join-Path $workerDir 'remote_edit.py') check
if ($LASTEXITCODE -ne 0) { throw 'Resolve or FFmpeg is not ready.' }
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) { throw 'Install Node.js LTS, then open a new Command Prompt and try again.' }
$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) { throw 'Claude Code is not on PATH. Open a new Command Prompt and try again.' }
$channelDir = Join-Path $workerDir 'channel'
if (-not (Test-Path -LiteralPath (Join-Path $channelDir 'node_modules/@modelcontextprotocol/sdk'))) {
    Push-Location $channelDir
    try { & $npm.Source ci --omit=dev --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Could not install the local channel dependency.' } }
    finally { Pop-Location }
}
try {
    $headers = @{ Authorization = "Bearer $env:VIDEO_WORKER_TOKEN" }
    $body = '{"action":"peek"}'
    Invoke-RestMethod -Uri ($env:VIDEO_OFFICE_URL.TrimEnd('/') + '/api/video-worker') -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
    Write-Host 'AI Office video queue reachable.'
} catch { throw 'AI Office video queue is not reachable with this token. Check the VPS deployment, migration, URL and token.' }
Set-Location $workerDir
Write-Host 'Claude Code will use your signed-in Max account. Accept the development channel prompt on first launch.'
Write-Host 'The Claude session and DaVinci Resolve must remain open for AI Office video jobs.'
& claude --dangerously-load-development-channels server:ai-office-video
exit $LASTEXITCODE
