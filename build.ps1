<#
.SYNOPSIS
    Builds the portable QuickNote.exe into dist\.

.DESCRIPTION
    Plain 'cargo build --release' is enough: the frontend is static and tauri-build
    embeds web\ into the binary, so there is no Node step and no installer to produce.
    The result is one self-contained exe to drop on a flash drive.
#>

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$srcTauri = Join-Path $root 'src-tauri'
$icon = Join-Path $srcTauri 'icons\icon.ico'

if (-not (Test-Path $icon)) {
    Write-Host 'Icon missing, generating it...' -ForegroundColor Yellow
    python (Join-Path $root 'tools\make-icon.py')
    if ($LASTEXITCODE -ne 0) { throw "Icon generation failed with exit code $LASTEXITCODE" }
}

Write-Host 'Building QuickNote (release)...' -ForegroundColor Cyan
Push-Location $srcTauri
try {
    cargo build --release
    # $ErrorActionPreference does not trap native exit codes, so check explicitly.
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

$built = Join-Path $srcTauri 'target\release\quick-note.exe'
if (-not (Test-Path $built)) { throw "Build reported success but $built is missing." }

$dist = Join-Path $root 'dist'
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }

$target = Join-Path $dist 'QuickNote.exe'
Copy-Item $built $target -Force

$sizeMb = [math]::Round((Get-Item $target).Length / 1MB, 1)

Write-Host ''
Write-Host "Done: $target ($sizeMb MB)" -ForegroundColor Green
Write-Host ''
Write-Host 'Copy that single file to your flash drive and run it from there.'
Write-Host 'On first run it creates notes\ and .cache\ next to itself, on the drive.'
