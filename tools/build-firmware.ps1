$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$cliPath = Join-Path $projectRoot '.tools/arduino-cli/arduino-cli.exe'
if (-not (Test-Path -LiteralPath $cliPath)) {
    throw 'Arduino CLI is not installed in .tools/arduino-cli.'
}
& $cliPath --config-file tools/arduino-cli.yaml compile --fqbn 'm5stack:esp32:m5stack_cores3:PartitionScheme=custom,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc' --build-path .tools/build/display-probe firmware/DisplayProbe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$application = Get-Item -LiteralPath '.tools/build/display-probe/DisplayProbe.ino.bin'
if ($application.Length -gt 0x4F0000) { throw 'Application exceeds the factory OTA slot.' }
Write-Host 'Build complete. No firmware was written to the device.'
