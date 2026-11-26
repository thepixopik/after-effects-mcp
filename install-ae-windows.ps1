$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$cepSource = Join-Path $scriptDir "cep-plugin"
if (-not (Test-Path -LiteralPath $cepSource)) {
  Write-Host "ERROR: cep-plugin folder not found!" -ForegroundColor Red
  exit 1
}

# 1. Enable Adobe CEP PlayerDebugMode for CSXS 9..12
foreach ($ver in 9..12) {
  $regPath = "HKCU:\Software\Adobe\CSXS.$ver"
  if (-not (Test-Path -LiteralPath $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
  }
  Set-ItemProperty -LiteralPath $regPath -Name "PlayerDebugMode" -Value "1" -Type String
}
Write-Host "[OK] Enabled Adobe CEP PlayerDebugMode (CSXS 9-12)" -ForegroundColor Cyan

# 2. Copy CEP extension into %APPDATA%\Adobe\CEP\extensions
$extRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
if (-not (Test-Path -LiteralPath $extRoot)) {
  New-Item -ItemType Directory -Path $extRoot -Force | Out-Null
}

$targetDir = Join-Path $extRoot "com.thepixopik.aftereffects.mcp"
if (Test-Path -LiteralPath $targetDir) {
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}
Copy-Item -LiteralPath $cepSource -Destination $targetDir -Recurse -Force
Write-Host "[SUCCESS] Installed CEP Plugin to: $targetDir" -ForegroundColor Green

# 3. Ensure Recordings folder exists
$recRoot = Join-Path $env:USERPROFILE "Videos\PixopikRecordings"
if (-not (Test-Path -LiteralPath $recRoot)) {
  New-Item -ItemType Directory -Path $recRoot -Force | Out-Null
}
Write-Host "[OK] Recordings directory ready: $recRoot" -ForegroundColor Cyan

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  SUCCESS! Pixopik Motion Studio Installed!" -ForegroundColor Green
Write-Host "  1. Restart Adobe After Effects" -ForegroundColor White
Write-Host "  2. Open: Window > Extensions > Pixopik Motion Studio" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
