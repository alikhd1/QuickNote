<#
.SYNOPSIS
    Builds the portable QuickNote.exe into dist\.

.DESCRIPTION
    Three steps: install the frontend dependencies if needed, bundle the React app to
    dist-web\, then compile the Rust binary with that bundle embedded. The result is one
    self-contained exe to drop on a flash drive — no installer, and nothing for the host
    PC to install either.

    The frontend is built here rather than left to tauri.conf.json's beforeBuildCommand,
    because that only runs under the Tauri CLI and this script uses plain cargo.
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

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host 'Installing frontend dependencies...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
}

Write-Host 'Type-checking and bundling the UI...' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE" }

$bundle = Join-Path $root 'dist-web\index.html'
if (-not (Test-Path $bundle)) { throw "Frontend build produced no $bundle" }

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
