param([string]$Python='python', [switch]$Gpu)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    & $Python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment creation failed.' }
}
& ./.venv/Scripts/python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
if ($Gpu) {
    & ./.venv/Scripts/python.exe -m pip install 'nvidia-cublas-cu12>=12.9,<13' 'nvidia-cudnn-cu12>=9.7,<10'
    if ($LASTEXITCODE -ne 0) { throw 'NVIDIA runtime installation failed.' }
}
Write-Host 'Installed. Start with ./start.ps1. GPU mode also requires CUDA 12 cuBLAS and cuDNN 9 DLLs on PATH.'
