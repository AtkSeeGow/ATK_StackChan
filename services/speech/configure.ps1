$ErrorActionPreference='Stop'
$settingsPath=Join-Path $PSScriptRoot 'settings.local.json'
if(Test-Path -LiteralPath $settingsPath) {
    Write-Host 'Existing settings.local.json preserved. No secrets printed.'
    exit 0
}
$speechSettings=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'settings.example.json') -Raw | ConvertFrom-Json
$keyBytes=New-Object byte[] 32
$generator=[Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($keyBytes) } finally { $generator.Dispose() }
$speechSettings.token=[BitConverter]::ToString($keyBytes).Replace('-','').ToLowerInvariant()
$speechSettings | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding UTF8
Write-Host 'Created settings.local.json with a new private key. Pair it with STACKCHAN_STT_TOKEN on the web host; the key was not printed.'
