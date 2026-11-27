param(
  [Parameter(Mandatory=$true)][string]$SessionDir,
  [int]$Fps = 60,
  [int]$Countdown = 3
)

$ErrorActionPreference = "SilentlyContinue"
New-Item -ItemType Directory -Force -Path $SessionDir | Out-Null

$videoOut          = Join-Path $SessionDir "screen.mp4"
$motionOut         = Join-Path $SessionDir "motion.json"
$script:stopSignal = Join-Path $SessionDir "stop.signal"
$doneSignal        = Join-Path $SessionDir "done.signal"
$script:stopReq    = $false

foreach ($f in @($videoOut, $script:stopSignal, $doneSignal)) {
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
$pill.Width = 280
$pill.Height = 42
$pill.Left = [Math]::Max(20, $screenW - 296)
$pill.Top = 10
$pill.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$pill.Opacity = 0.95

$lbl = New-Object System.Windows.Forms.Label
$lbl.ForeColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
$lbl.Font = New-Object System.Drawing.Font("Segoe UI", 9.0, [System.Drawing.FontStyle]::Bold)
$lbl.AutoSize = $false
$lbl.Left = 12; $lbl.Top = 0; $lbl.Width = 168; $lbl.Height = 42
$lbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$pill.Controls.Add($lbl)

$stopBtn = New-Object System.Windows.Forms.Button
$stopBtn.Text = "Stop & Rig"
$stopBtn.Left = 184; $stopBtn.Top = 7; $stopBtn.Width = 86; $stopBtn.Height = 28
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

function Start-VideoCapture([bool]$useDda) {
  $vIn = if ($useDda) {
    "-f lavfi -i `"ddagrab=framerate=$Fps`:draw_mouse=0,hwdownload,format=bgra`""
  } else {
    "-f gdigrab -framerate $Fps -draw_mouse 0 -i desktop"
  }
  # Pure silent 60fps capture (-an = zero audio overhead, instant stop!)
  $argsStr = "-y -loglevel error $vIn -an -vf `"scale=trunc(iw/2)*2:trunc(ih/2)*2`" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -movflags +faststart `"$videoOut`""
  $pInfo = New-Object System.Diagnostics.ProcessStartInfo
  $pInfo.FileName = $ffmpegExe
  $pInfo.Arguments = $argsStr
  $pInfo.RedirectStandardInput = $true
  $pInfo.UseShellExecute = $false
  $pInfo.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $pInfo
  $proc.Start() | Out-Null
  return $proc
}

$usedDda = $hasDda
$vProc = Start-VideoCapture -useDda $usedDda
Start-Sleep -Milliseconds 850
if ($vProc.HasExited -and $usedDda) {
  $usedDda = $false
  $vProc = Start-VideoCapture -useDda $false
  Start-Sleep -Milliseconds 450
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$samples = New-Object System.Collections.Generic.List[object]
$clicks  = New-Object System.Collections.Generic.List[object]
$wasLeftDown = $false
$wasRightDown = $false
$retriedGdi = $false

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
  $lbl.Text = "GHOST $mm`:$ss • 60 FPS"

  $pos = [System.Windows.Forms.Cursor]::Position
  $btns = [System.Windows.Forms.Control]::MouseButtons
  $leftDown  = ($btns -band [System.Windows.Forms.MouseButtons]::Left) -ne 0
  $rightDown = ($btns -band [System.Windows.Forms.MouseButtons]::Right) -ne 0

  # Sample at ~33Hz (every 30ms) instead of 60Hz to keep motion.json super light!
  $samples.Add(@{ t = $t; x = $pos.X; y = $pos.Y })

  if ($leftDown -and -not $wasLeftDown) {
    $clicks.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "left" })
  }
  if ($rightDown -and -not $wasRightDown) {
    $clicks.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "right" })
  }
  $wasLeftDown = $leftDown
  $wasRightDown = $rightDown

  Start-Sleep -Milliseconds 28
}

$lbl.Text = "Saving MP4..."
[System.Windows.Forms.Application]::DoEvents()

if ($vProc -and -not $vProc.HasExited) {
  try {
    $vProc.StandardInput.Write("q`n")
    $vProc.StandardInput.Flush()
    $vProc.StandardInput.Close()
    $vProc.WaitForExit(4500) | Out-Null
  } catch {}
  if (-not $vProc.HasExited) { try { $vProc.Kill() } catch {} }
}

try { $pill.Close(); $pill.Dispose() } catch {}

$payload = @{
  version      = "1.5.0"
  fps          = $Fps
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
