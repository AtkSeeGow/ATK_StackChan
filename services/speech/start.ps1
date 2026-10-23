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
if (-not $env:HF_HOME) { $env:HF_HOME=Join-Path $PSScriptRoot '../../.tools/huggingface' }
# NVIDIA pip wheels keep their Windows runtime DLLs inside the venv.
$nvidiaRoot=Join-Path $PSScriptRoot '.venv/Lib/site-packages/nvidia'
if ($Device -eq 'cuda' -and (Test-Path -LiteralPath $nvidiaRoot)) {
    $dllDirectories=Get-ChildItem -LiteralPath $nvidiaRoot -Recurse -Filter '*.dll' | Select-Object -ExpandProperty DirectoryName -Unique
    if ($dllDirectories) { $env:PATH=($dllDirectories -join ';')+';'+$env:PATH }
}
& ./.venv/Scripts/python.exe server.py
if($LASTEXITCODE -ne 0) { throw 'Speech service failed. Check Python/CUDA libraries; CPU testing is available with ./start.ps1 -Device cpu.' }
