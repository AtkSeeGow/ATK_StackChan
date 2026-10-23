$ErrorActionPreference='Continue'
Write-Host 'GPU driver and device:'
if(Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
} else { Write-Host 'nvidia-smi not found on PATH.' }
$venvPython=Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if(Test-Path -LiteralPath $venvPython) {
    & $venvPython --version
    & $venvPython -c 'import importlib.metadata as m; print("faster-whisper", m.version("faster-whisper")); print("ctranslate2", m.version("ctranslate2")); import ctranslate2; print("CUDA devices", ctranslate2.get_cuda_device_count()); print("CUDA compute types", sorted(ctranslate2.get_supported_compute_types("cuda")))'
} else {
    Write-Host 'Speech virtual environment not installed. Available Python:'
    python --version
}
Write-Host 'CUDA DLL discovery (no changes):'
where.exe cublas64_12.dll
where.exe cudnn64_9.dll
Write-Host 'These checks do not replace an actual GPU transcription test. No settings or secrets were read.'
