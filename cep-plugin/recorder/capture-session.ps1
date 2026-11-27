param(
  [Parameter(Mandatory=$true)][string]$SessionDir,
  [int]$Fps = 60,
  [int]$Countdown = 3,
  [int]$UseMic = 0
)

$ErrorActionPreference = "SilentlyContinue"
New-Item -ItemType Directory -Force -Path $SessionDir | Out-Null

$rawVideo          = Join-Path $SessionDir "video_raw.mp4"
$micWav            = Join-Path $SessionDir "voiceover.wav"
$videoOut          = Join-Path $SessionDir "screen.mp4"
$motionOut         = Join-Path $SessionDir "motion.json"
$script:stopSignal = Join-Path $SessionDir "stop.signal"
$doneSignal        = Join-Path $SessionDir "done.signal"
$script:stopReq    = $false

foreach ($f in @($rawVideo, $micWav, $videoOut, $script:stopSignal, $doneSignal)) {
  if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
}

try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PxRecGhost {
  [DllImport("user32.dll")]
  public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
}
"@ -ErrorAction SilentlyContinue
} catch {}

function Find-Ffmpeg {
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $wingetRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path -LiteralPath $wingetRoot) {
    $found = Get-ChildItem -LiteralPath $wingetRoot -Recurse -Filter "ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  foreach ($c in @("C:\ffmpeg\bin\ffmpeg.exe", "C:\Program Files\ffmpeg\bin\ffmpeg.exe")) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  return $null
}

$ffmpegExe = Find-Ffmpeg
if (-not $ffmpegExe) {
  [System.IO.File]::WriteAllText($doneSignal, "ERROR:FFMPEG_NOT_FOUND")
  exit 1
}

function Find-DefaultMic([string]$ff) {
  try {
    $p = New-Object System.Diagnostics.ProcessStartInfo
    $p.FileName = $ff
    $p.Arguments = "-hide_banner -list_devices true -f dshow -i dummy"
    $p.RedirectStandardError = $true
    $p.UseShellExecute = $false
    $p.CreateNoWindow = $true
    $pr = [System.Diagnostics.Process]::Start($p)
    $errTxt = $pr.StandardError.ReadToEnd()
    $pr.WaitForExit(3000) | Out-Null
    $matchesAll = [regex]::Matches($errTxt, '"([^"]+)"\s+\(audio\)')
    foreach ($m in $matchesAll) {
      $nm = $m.Groups[1].Value
      if ($nm -notmatch "Stereo Mix|Hands-Free AG|Virtual") { return $nm }
    }
    if ($matchesAll.Count -gt 0) { return $matchesAll[0].Groups[1].Value }
  } catch {}
  return $null
}

$micName = if ($UseMic -eq 1) { Find-DefaultMic $ffmpegExe } else { $null }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds  = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$screenW = $bounds.Width
$screenH = $bounds.Height

# Floating Top-Right Ghost Stop Pill (100% Invisible in Recorded MP4!)
$pill = New-Object System.Windows.Forms.Form
$pill.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$pill.TopMost = $true
$pill.ShowInTaskbar = $false
$pill.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$pill.Width = 290
$pill.Height = 42
$pill.Left = [Math]::Max(20, $screenW - 304)
$pill.Top = 10
$pill.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$pill.Opacity = 0.95

$lbl = New-Object System.Windows.Forms.Label
$lbl.ForeColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
$lbl.Font = New-Object System.Drawing.Font("Segoe UI", 9.0, [System.Drawing.FontStyle]::Bold)
$lbl.AutoSize = $false
$lbl.Left = 12
$lbl.Top = 0
$lbl.Width = 176
$lbl.Height = 42
$lbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$pill.Controls.Add($lbl)

$stopBtn = New-Object System.Windows.Forms.Button
$stopBtn.Text = "Stop & Rig"
$stopBtn.Left = 192
$stopBtn.Top = 7
$stopBtn.Width = 88
$stopBtn.Height = 28
$stopBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$stopBtn.FlatAppearance.BorderSize = 0
$stopBtn.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
$stopBtn.ForeColor = [System.Drawing.Color]::White
$stopBtn.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$stopBtn.Add_Click({
  $script:stopReq = $true
  try { [System.IO.File]::WriteAllText($script:stopSignal, "STOP") } catch {}
})
$pill.Controls.Add($stopBtn)
$pill.Show()
try { [void][PxRecGhost]::SetWindowDisplayAffinity($pill.Handle, 0x00000011) } catch {}

if ($Countdown -gt 0) {
  $endWait = [DateTime]::UtcNow.AddSeconds($Countdown)
  while ([DateTime]::UtcNow -lt $endWait) {
    if ($script:stopReq -or (Test-Path -LiteralPath $script:stopSignal)) { break }
    $rem = [Math]::Ceiling(($endWait - [DateTime]::UtcNow).TotalSeconds)
    $lbl.Text = "Starting in ${rem}s... Open App!"
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 60
  }
}

$filtersTxt = & $ffmpegExe -hide_banner -filters 2>&1 | Out-String
$hasDda = $filtersTxt -match "ddagrab"

function Start-Proc([string]$exe, [string]$arguments) {
  $pInfo = New-Object System.Diagnostics.ProcessStartInfo
  $pInfo.FileName = $exe
  $pInfo.Arguments = $arguments
  $pInfo.RedirectStandardInput = $true
  $pInfo.UseShellExecute = $false
  $pInfo.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $pInfo
  $proc.Start() | Out-Null
  return $proc
}

function Start-VideoCapture([bool]$useDda) {
  $vIn = if ($useDda) {
    "-f lavfi -i `"ddagrab=framerate=$Fps`:draw_mouse=0,hwdownload,format=bgra`""
  } else {
    "-f gdigrab -framerate $Fps -draw_mouse 0 -i desktop"
  }
  $args = "-y -loglevel error $vIn -vf `"scale=trunc(iw/2)*2:trunc(ih/2)*2`" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p `"$rawVideo`""
  return Start-Proc $ffmpegExe $args
}

function Start-MicCapture([string]$dev) {
  $args = "-y -loglevel error -f dshow -rtbufsize 128M -i `"audio=$dev`" -ac 1 -ar 48000 `"$micWav`""
  return Start-Proc $ffmpegExe $args
}

$usedDda = $hasDda
$vProc = Start-VideoCapture -useDda $usedDda
Start-Sleep -Milliseconds 900
if ($vProc.HasExited -and $usedDda) {
  $usedDda = $false
  $vProc = Start-VideoCapture -useDda $false
  Start-Sleep -Milliseconds 500
}

$micProc = $null
if ($micName) {
  $micProc = Start-MicCapture -dev $micName
  Start-Sleep -Milliseconds 250
  if ($micProc.HasExited) { $micProc = $null; $micName = $null }
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$samples = New-Object System.Collections.Generic.List[object]
$clicks  = New-Object System.Collections.Generic.List[object]
$wasLeftDown = $false
$wasRightDown = $false
$retriedGdi = $false
$micTag = if ($micProc -and -not $micProc.HasExited) { "MIC ON" } else { "60 FPS" }

while ($true) {
  [System.Windows.Forms.Application]::DoEvents()
  if ($script:stopReq -or (Test-Path -LiteralPath $script:stopSignal)) { break }

  if ($vProc.HasExited) {
    if ($usedDda -and -not $retriedGdi -and $sw.Elapsed.TotalSeconds -lt 3.0) {
      $usedDda = $false
      $retriedGdi = $true
      $samples.Clear(); $clicks.Clear()
      $vProc = Start-VideoCapture -useDda $false
      $sw.Restart()
      Start-Sleep -Milliseconds 300
      continue
    }
    break
  }

  $t = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
  $sec = [int][Math]::Floor($t)
  $mm = "{0:D2}" -f [int][Math]::Floor($sec / 60)
  $ss = "{0:D2}" -f ($sec % 60)
  $lbl.Text = "GHOST $mm`:$ss • $micTag"

  $pos = [System.Windows.Forms.Cursor]::Position
  $btns = [System.Windows.Forms.Control]::MouseButtons
  $leftDown  = ($btns -band [System.Windows.Forms.MouseButtons]::Left) -ne 0
  $rightDown = ($btns -band [System.Windows.Forms.MouseButtons]::Right) -ne 0

  $samples.Add(@{ t = $t; x = $pos.X; y = $pos.Y })

  if ($leftDown -and -not $wasLeftDown) {
    $clicks.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "left" })
  }
  if ($rightDown -and -not $wasRightDown) {
    $clicks.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "right" })
  }
  $wasLeftDown = $leftDown
  $wasRightDown = $rightDown

  Start-Sleep -Milliseconds 16
}

$lbl.Text = "Saving MP4 + Mic..."
[System.Windows.Forms.Application]::DoEvents()

foreach ($pr in @($vProc, $micProc)) {
  if ($pr -and -not $pr.HasExited) {
    try {
      $pr.StandardInput.Write("q`n")
      $pr.StandardInput.Flush()
      $pr.StandardInput.Close()
      $pr.WaitForExit(5000) | Out-Null
    } catch {}
    if (-not $pr.HasExited) { try { $pr.Kill() } catch {} }
  }
}

try { $pill.Close(); $pill.Dispose() } catch {}

$hasVideo = (Test-Path -LiteralPath $rawVideo) -and ((Get-Item -LiteralPath $rawVideo).Length -gt 1000)
$hasAudio = (Test-Path -LiteralPath $micWav) -and ((Get-Item -LiteralPath $micWav).Length -gt 2000)

if ($hasVideo -and $hasAudio) {
  $muxArgs = "-y -loglevel error -i `"$rawVideo`" -i `"$micWav`" -c:v copy -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest -movflags +faststart `"$videoOut`""
  $muxProc = Start-Proc $ffmpegExe $muxArgs
  $muxProc.WaitForExit(12000) | Out-Null
  if (-not ((Test-Path -LiteralPath $videoOut) -and ((Get-Item -LiteralPath $videoOut).Length -gt 1000))) {
    Copy-Item -LiteralPath $rawVideo -Destination $videoOut -Force
  } else {
    Remove-Item -LiteralPath $rawVideo -Force -ErrorAction SilentlyContinue
  }
} elseif ($hasVideo) {
  Move-Item -LiteralPath $rawVideo -Destination $videoOut -Force
}

$payload = @{
  version      = "1.3.0"
  fps          = $Fps
  hasMicAudio  = $hasAudio
  screenWidth  = $screenW
  screenHeight = $screenH
  duration     = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
  samples      = $samples
  clicks       = $clicks
}

$jsonStr = $payload | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($motionOut, $jsonStr, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($doneSignal, "OK")

try {
  $wsh = New-Object -ComObject WScript.Shell
  $wsh.AppActivate("Adobe After Effects") | Out-Null
} catch {}
