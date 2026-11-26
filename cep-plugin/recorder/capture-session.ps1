param(
  [Parameter(Mandatory=$true)][string]$SessionDir,
  [int]$Fps = 60,
  [string]$AudioDevice = ""
)

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $SessionDir)) {
  New-Item -ItemType Directory -Path $SessionDir -Force | Out-Null
}

$videoOut   = Join-Path $SessionDir "screen.mp4"
$motionOut  = Join-Path $SessionDir "motion.json"
$stopSignal = Join-Path $SessionDir "stop.signal"
$doneSignal = Join-Path $SessionDir "done.signal"

# Locate ffmpeg
$ffmpegExe = $null
$cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($cmd) { $ffmpegExe = $cmd.Source }
if (-not $ffmpegExe) {
  $wingetPkg = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($wingetPkg) { $ffmpegExe = $wingetPkg.FullName }
}
if (-not $ffmpegExe -and (Test-Path "C:\ffmpeg\bin\ffmpeg.exe")) {
  $ffmpegExe = "C:\ffmpeg\bin\ffmpeg.exe"
}
if (-not $ffmpegExe) {
  Set-Content -LiteralPath $doneSignal -Value "ERROR:FFMPEG_NOT_FOUND"
  exit 1
}

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$screenW = $bounds.Width
$screenH = $bounds.Height

# Start clean cursor-free 60fps screen capture
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ffmpegExe
if ($AudioDevice -and $AudioDevice.Trim().Length -gt 0) {
  $psi.Arguments = "-y -f gdigrab -framerate $Fps -draw_mouse 0 -i desktop -f dshow -i audio=`"$AudioDevice`" -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p -c:a aac `"$videoOut`""
} else {
  $psi.Arguments = "-y -f gdigrab -framerate $Fps -draw_mouse 0 -i desktop -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p `"$videoOut`""
}
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$samples = New-Object System.Collections.Generic.List[object]
$clicks  = New-Object System.Collections.Generic.List[object]
$lastX = -1
$lastY = -1
$wasLeftDown = $false
$wasRightDown = $false

while (-not (Test-Path -LiteralPath $stopSignal)) {
  if ($proc.HasExited) { break }

  $t = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
  $pos = [System.Windows.Forms.Cursor]::Position
  $btns = [System.Windows.Forms.Control]::MouseButtons

  if ($pos.X -ne $lastX -or $pos.Y -ne $lastY) {
    $samples.Add(@{ t = $t; x = $pos.X; y = $pos.Y })
    $lastX = $pos.X
    $lastY = $pos.Y
  }

  $leftDown = (($btns -band [System.Windows.Forms.MouseButtons]::Left) -ne 0)
  if ($leftDown -and -not $wasLeftDown) {
    $clicks.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "left" })
  }
  $wasLeftDown = $leftDown

  $rightDown = (($btns -band [System.Windows.Forms.MouseButtons]::Right) -ne 0)
  if ($rightDown -and -not $wasRightDown) {
    $clicks.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "right" })
  }
  $wasRightDown = $rightDown

  Start-Sleep -Milliseconds 16
}

$durationSec = [Math]::Round($sw.Elapsed.TotalSeconds, 3)

# Gracefully finalize MP4 container
if (-not $proc.HasExited) {
  try {
    $proc.StandardInput.WriteLine("q")
    $proc.StandardInput.Flush()
    $proc.WaitForExit(5000) | Out-Null
  } catch {}
  if (-not $proc.HasExited) {
    try { $proc.Kill() } catch {}
  }
}

$telemetry = @{
  version      = "0.1.0"
  fps          = $Fps
  duration     = $durationSec
  screenWidth  = $screenW
  screenHeight = $screenH
  samples      = $samples
  clicks       = $clicks
}

$telemetry | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath $motionOut -Encoding UTF8
Set-Content -LiteralPath $doneSignal -Value "OK" -Encoding UTF8
