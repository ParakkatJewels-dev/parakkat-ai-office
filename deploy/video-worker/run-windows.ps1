$ErrorActionPreference = 'Stop'
$workerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $workerDir 'config.env'
if ($args.Count -eq 1 -and $args[0] -eq '--check-resolve') {
    $python = Get-Command py -ErrorAction SilentlyContinue
    if ($python) { & $python.Source -3 (Join-Path $workerDir 'worker.py') --check-resolve; exit $LASTEXITCODE }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { throw 'Python 3.10 or newer is required.' }
    & $python.Source (Join-Path $workerDir 'worker.py') --check-resolve
    exit $LASTEXITCODE
}
if (-not (Test-Path -LiteralPath $configPath)) {
    throw 'Copy config.windows.env.example to config.env and fill in the worker token, API key, and folders.'
}
$allowed = @('VIDEO_OFFICE_URL', 'VIDEO_WORKER_TOKEN', 'ANTHROPIC_API_KEY', 'VIDEO_MEDIA_ROOT', 'VIDEO_EXPORT_ROOT', 'VIDEO_BRIDGE_SCRIPT', 'VIDEO_CLAUDE_BIN', 'VIDEO_WORKER_ID')
foreach ($line in Get-Content -LiteralPath $configPath) {
    if ($line -match '^\s*(#|$)') { continue }
    if ($line -notmatch '^\s*([A-Z][A-Z0-9_]*)=(.*)$') { throw 'Invalid config.env line. Use NAME=value.' }
    $name = $matches[1]
    $value = $matches[2].Trim()
    if ($name -notin $allowed) { throw "Unknown worker setting: $name" }
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $value = [Environment]::ExpandEnvironmentVariables($value)
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}
$python = Get-Command py -ErrorAction SilentlyContinue
if ($python) {
    & $python.Source -3 (Join-Path $workerDir 'worker.py') @args
    exit $LASTEXITCODE
}
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python 3.10 or newer is required.' }
& $python.Source (Join-Path $workerDir 'worker.py') @args
exit $LASTEXITCODE
