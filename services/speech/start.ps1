param([ValidateSet('cuda','cpu')][string]$Device='cuda')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$settingsPath=Join-Path $PSScriptRoot 'settings.local.json'
if (-not (Test-Path -LiteralPath $settingsPath)) { throw 'Missing settings.local.json. Transfer the existing private file or run ./configure.ps1 and pair the new key with the web host.' }
$speechSettings=Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$env:STT_TOKEN=$speechSettings.token
$env:STT_HOST=$speechSettings.host
$env:STT_PORT=[string]$speechSettings.port
$env:STT_MODEL=$speechSettings.model
$env:STT_DEVICE=$Device
$env:PYTHONIOENCODING='utf-8'
& ./.venv/Scripts/python.exe server.py
if($LASTEXITCODE -ne 0) { throw 'Speech service failed. Check Python/CUDA libraries; CPU testing is available with ./start.ps1 -Device cpu.' }
