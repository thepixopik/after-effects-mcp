param(
  [Parameter(Mandatory=$true)][string]$SessionDir,
  [int]$Fps = 60,
  [int]$Countdown = 3,
  [int]$UseMic = 0
)

$ErrorActionPreference = "SilentlyContinue"
New-Item -ItemType Directory -Force -Path $SessionDir | Out-Null

$videoOut          = Join-Path $SessionDir "screen.mp4"
$motionOut         = Join-Path $SessionDir "motion.json"
$script:stopSignal = Join-Path $SessionDir "stop.signal"
$doneSignal        = Join-Path $SessionDir "done.signal"
$script:stopReq    = $false

if (Test-Path -LiteralPath $script:stopSignal) { Remove-Item -LiteralPath $script:stopSignal -Force }
if (Test-Path -LiteralPath $doneSignal) { Remove-Item -LiteralPath $doneSignal -Force }

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
      if ($nm -notmatch "Stereo Mix|Hands-Free AG") { return $nm }
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

# Floating Top-Right Stop Pill
$pill = New-Object System.Windows.Forms.Form
$pill.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$pill.TopMost = $true
$pill.ShowInTaskbar = $false
$pill.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$pill.Width = 290
$pill.Height = 42
$pill.Left = [Math]::Max(20, $screenW - 310)
$pill.Top = 18
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

$filtersTxt  = & $ffmpegExe -hide_banner -filters 2>&1 | Out-String
$encodersTxt = & $ffmpegExe -hide_banner -encoders 2>&1 | Out-String
$hasDda   = $filtersTxt -match "ddagrab"
$hasNvenc = $encodersTxt -match "h264_nvenc"

function Start-CaptureProcess([bool]$useDda, [bool]$useNvenc, [string]$micDev) {
  $vCodec = if ($useNvenc) { "-c:v h264_nvenc -preset p2 -cq 20" } else { "-c:v libx264 -preset ultrafast -crf 20 -threads 0" }
  $vInput = if ($useDda) { "-f lavfi -i `"ddagrab=framerate=$Fps`:draw_mouse=0,hwdownload,format=bgra`"" } else { "-f gdigrab -framerate $Fps -draw_mouse 0 -i desktop" }
  $aPart  = if ($micDev) { "-f dshow -rtbufsize 128M -i audio=`"$micDev`" -c:a aac -b:a 192k" } else { "" }

  # -loglevel error prevents stderr buffer deadlock on long recordings!
  $argsStr = "-y -loglevel error $vInput $aPart $vCodec -pix_fmt yuv420p -movflags +faststart `"$videoOut`""
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

$ffProc = Start-CaptureProcess -useDda $hasDda -useNvenc $hasNvenc -micDev $micName
Start-Sleep -Milliseconds 420
if ($ffProc.HasExited -and $micName) {
  $ffProc = Start-CaptureProcess -useDda $false -useNvenc $false -micDev $micName
  Start-Sleep -Milliseconds 350
}
if ($ffProc.HasExited) {
  $micName = $null
  $ffProc = Start-CaptureProcess -useDda $false -useNvenc $false -micDev $null
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$samples = New-Object System.Collections.Generic.List[object]
$clicks  = New-Object System.Collections.Generic.List[object]
$wasLeftDown = $false
$wasRightDown = $false
$micTag = if ($micName) { "MIC ON" } else { "60 FPS" }

while (-not $ffProc.HasExited) {
  [System.Windows.Forms.Application]::DoEvents()
  if ($script:stopReq -or (Test-Path -LiteralPath $script:stopSignal)) { break }

  $t = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
  $sec = [int][Math]::Floor($t)
  $mm = "{0:D2}" -f [int][Math]::Floor($sec / 60)
  $ss = "{0:D2}" -f ($sec % 60)
  $lbl.Text = "REC $mm`:$ss • $micTag"

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

$lbl.Text = "Saving MP4 + Audio..."
[System.Windows.Forms.Application]::DoEvents()

try {
  if (-not $ffProc.HasExited) {
    $ffProc.StandardInput.Write("q`n")
    $ffProc.StandardInput.Flush()
    $ffProc.StandardInput.Close()
    $ffProc.WaitForExit(5000) | Out-Null
  }
  if (-not $ffProc.HasExited) { $ffProc.Kill() }
} catch {}

try { $pill.Close(); $pill.Dispose() } catch {}

$payload = @{
  version      = "1.1.1"
  fps          = $Fps
  hasMicAudio  = [bool]$micName
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
