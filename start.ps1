$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'server.mjs')
} else {
    $runtimeNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $runtimeNode) {
        & $runtimeNode (Join-Path $PSScriptRoot 'server.mjs')
    } else {
        Write-Host 'Please install Node.js 24 or newer, then run this file again.'
        exit 1
    }
}
