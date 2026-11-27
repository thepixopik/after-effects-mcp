param(
  [Parameter(Mandatory=$true)][string]$SessionDir,
  [int]$Fps = 60,
  [int]$Countdown = 3,
  [string]$PickMode = "",
  [int]$InitW = 1280,
  [int]$InitH = 720,
  [int]$CropX = 0,
  [int]$CropY = 0,
  [int]$CropW = 0,
  [int]$CropH = 0
)

$ErrorActionPreference = "SilentlyContinue"
New-Item -ItemType Directory -Force -Path $SessionDir | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$bounds  = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$screenW = $bounds.Width
$screenH = $bounds.Height

# ============================================================================
# TELEMETRY-ONLY MODE FOR REAL BANDICAM.EXE LIVE BRIDGE!
# ============================================================================
if ($PickMode -eq "track_only") {
  $motionOut  = Join-Path $SessionDir "motion.json"
  $stopSignal = Join-Path $SessionDir "stop.signal"
  $doneSignal = Join-Path $SessionDir "done.signal"
  if (Test-Path -LiteralPath $stopSignal) { Remove-Item -LiteralPath $stopSignal -Force }
  if (Test-Path -LiteralPath $doneSignal) { Remove-Item -LiteralPath $doneSignal -Force }

  $tw = if ($CropW -ge 80) { $CropW } else { $screenW }
  $th = if ($CropH -ge 80) { $CropH } else { $screenH }
  $tx = if ($CropW -ge 80) { $CropX } else { 0 }
  $ty = if ($CropH -ge 80) { $CropY } else { 0 }

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $samples = New-Object System.Collections.Generic.List[object]
  $clicks  = New-Object System.Collections.Generic.List[object]
  $wasL = $false; $wasR = $false

  while (-not (Test-Path -LiteralPath $stopSignal)) {
    $t = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
    $pos = [System.Windows.Forms.Cursor]::Position
    $rx = [Math]::Max(0, [Math]::Min($tw, ($pos.X - $tx)))
    $ry = [Math]::Max(0, [Math]::Min($th, ($pos.Y - $ty)))
    $inside = ($pos.X -ge $tx -and $pos.X -le ($tx + $tw) -and $pos.Y -ge $ty -and $pos.Y -le ($ty + $th))

    $btns = [System.Windows.Forms.Control]::MouseButtons
    $lDown = ($btns -band [System.Windows.Forms.MouseButtons]::Left) -ne 0
    $rDown = ($btns -band [System.Windows.Forms.MouseButtons]::Right) -ne 0

    $samples.Add(@{ t = $t; x = $rx; y = $ry })
    if ($inside) {
      if ($lDown -and -not $wasL) { $clicks.Add(@{ t = $t; x = $rx; y = $ry; button = "left" }) }
      if ($rDown -and -not $wasR) { $clicks.Add(@{ t = $t; x = $rx; y = $ry; button = "right" }) }
    }
    $wasL = $lDown; $wasR = $rDown
    Start-Sleep -Milliseconds 25
  }

  $payload = @{
    version = "2.3.0"; fps = 60; captureMode = "real_bandicam"
    screenWidth = $tw; screenHeight = $th
    duration = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
    samples = $samples; clicks = $clicks
  }
  [System.IO.File]::WriteAllText($motionOut, ($payload | ConvertTo-Json -Depth 5 -Compress), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($doneSignal, "OK")
  exit 0
}

if ($PickMode -eq "area") {
  $outJson = Join-Path $SessionDir "picked_region.json"
  if (Test-Path -LiteralPath $outJson) { Remove-Item -LiteralPath $outJson -Force }
  $ov = New-Object System.Windows.Forms.Form
  $ov.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $ov.Bounds = $bounds; $ov.TopMost = $true; $ov.ShowInTaskbar = $false
  $ov.BackColor = [System.Drawing.Color]::FromArgb(12, 18, 30); $ov.Opacity = 0.48
  $ov.Cursor = [System.Windows.Forms.Cursors]::Cross; $ov.KeyPreview = $true
  $ov.GetType().GetProperty("DoubleBuffered", [System.Reflection.BindingFlags]"Instance,NonPublic").SetValue($ov, $true, $null)
  $script:dragging = $false; $script:startPt = [System.Drawing.Point]::Empty; $script:curRect = [System.Drawing.Rectangle]::Empty
  $penBox = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(244, 63, 94), 3)
  $fontBg = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
  $ov.Add_KeyDown({ if ($_.KeyCode -eq "Escape") { $ov.Close() } })
  $ov.Add_MouseDown({ if ($_.Button -eq "Left") { $script:dragging = $true; $script:startPt = $_.Location; $script:curRect = New-Object System.Drawing.Rectangle($_.X, $_.Y, 0, 0) } })
  $ov.Add_MouseMove({
    if ($script:dragging) {
      $script:curRect = New-Object System.Drawing.Rectangle([Math]::Min($script:startPt.X, $_.X), [Math]::Min($script:startPt.Y, $_.Y), [Math]::Abs($_.X - $script:startPt.X), [Math]::Abs($_.Y - $script:startPt.Y))
      $ov.Invalidate()
    }
  })
  $ov.Add_MouseUp({
    if ($script:dragging) {
      $script:dragging = $false
      if ($script:curRect.Width -ge 80 -and $script:curRect.Height -ge 80) {
        $res = @{ ok = $true; x = $script:curRect.X; y = $script:curRect.Y; w = ([int]([Math]::Floor($script:curRect.Width / 2) * 2)); h = ([int]([Math]::Floor($script:curRect.Height / 2) * 2)) }
        [System.IO.File]::WriteAllText($outJson, ($res | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
      }
      $ov.Close()
    }
  })
  $ov.Add_Paint({
    $g = $_.Graphics
    if ($script:curRect.Width -gt 4 -and $script:curRect.Height -gt 4) {
      $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45, 99, 102, 241))), $script:curRect)
      $g.DrawRectangle($penBox, $script:curRect)
      $txt = "$($script:curRect.Width) x $($script:curRect.Height)"
      $g.FillRectangle([System.Drawing.Brushes]::Black, $script:curRect.X, [Math]::Max(4, $script:curRect.Y - 28), 130, 24)
      $g.DrawString($txt, $fontBg, [System.Drawing.Brushes]::White, ($script:curRect.X + 8), [Math]::Max(6, $script:curRect.Y - 26))
    } else {
      $g.DrawString("Drag mouse to select recording area  •  ESC to cancel", $fontBg, [System.Drawing.Brushes]::White, ([int]($screenW / 2) - 210), 28)
    }
  })
  [System.Windows.Forms.Application]::Run($ov)
  exit 0
}

if ($PickMode -eq "rect") {
  $outJson = Join-Path $SessionDir "picked_region.json"
  if (Test-Path -LiteralPath $outJson) { Remove-Item -LiteralPath $outJson -Force }
  $rw = [Math]::Min($screenW - 40, [Math]::Max(200, $InitW))
  $rh = [Math]::Min($screenH - 80, [Math]::Max(200, $InitH))
  $box = New-Object System.Windows.Forms.Form
  $box.Text = "Position Recording Frame ($rw x $rh)"
  $box.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::SizableToolWindow
  $box.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $box.ClientSize = New-Object System.Drawing.Size($rw, $rh); $box.TopMost = $true
  $box.BackColor = [System.Drawing.Color]::Magenta; $box.TransparencyKey = [System.Drawing.Color]::Magenta
  $topStrip = New-Object System.Windows.Forms.Panel
  $topStrip.Dock = [System.Windows.Forms.DockStyle]::Top; $topStrip.Height = 34; $topStrip.BackColor = [System.Drawing.Color]::FromArgb(20, 25, 35)
  $box.Controls.Add($topStrip)
  $infoL = New-Object System.Windows.Forms.Label
  $infoL.Text = "▭  Move/Resize red frame over target area"; $infoL.ForeColor = [System.Drawing.Color]::White
  $infoL.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold); $infoL.Left = 10; $infoL.Top = 8; $infoL.Width = 280
  $topStrip.Controls.Add($infoL)
  $okBtn = New-Object System.Windows.Forms.Button
  $okBtn.Text = "✓ Lock Frame"; $okBtn.Left = $rw - 115; $okBtn.Top = 4; $okBtn.Width = 105; $okBtn.Height = 26
  $okBtn.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
  $okBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $okBtn.BackColor = [System.Drawing.Color]::FromArgb(225, 29, 72); $okBtn.ForeColor = [System.Drawing.Color]::White
  $okBtn.Add_Click({
    $pt = $box.PointToScreen((New-Object System.Drawing.Point(0, 34)))
    $res = @{ ok = $true; x = [Math]::Max(0, $pt.X); y = [Math]::Max(0, $pt.Y); w = ([int]([Math]::Floor($box.ClientSize.Width / 2) * 2)); h = ([int]([Math]::Floor(($box.ClientSize.Height - 34) / 2) * 2)) }
    [System.IO.File]::WriteAllText($outJson, ($res | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
    $box.Close()
  })
  $topStrip.Controls.Add($okBtn)
  $box.Add_Paint({
    $p = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(244, 63, 94), 4)
    $_.Graphics.DrawRectangle($p, 2, 36, $box.ClientSize.Width - 4, $box.ClientSize.Height - 38)
  })
  [System.Windows.Forms.Application]::Run($box)
  exit 0
}

if ($PickMode -eq "screenshot") {
  $shotDir = Join-Path $SessionDir "Screenshots"
  New-Item -ItemType Directory -Force -Path $shotDir | Out-Null
  $shotPath = Join-Path $shotDir ("shot_" + (Get-Date).ToString("yyyyMMdd_HHmmss") + ".png")
  $bmp = New-Object System.Drawing.Bitmap($screenW, $screenH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $bmp.Save($shotPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  exit 0
}

# ============================================================================
# BUILT-IN 60 FPS CAPTURE ENGINE
# ============================================================================
$videoOut = Join-Path $SessionDir "screen.mp4"
$motionOut = Join-Path $SessionDir "motion.json"
$script:stopSignal = Join-Path $SessionDir "stop.signal"
$doneSignal = Join-Path $SessionDir "done.signal"
$script:stopReq = $false
foreach ($f in @($videoOut, $script:stopSignal, $doneSignal)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }

try {
  Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PxRecGhost {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
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
  foreach ($c in @("C:\ffmpeg\bin\ffmpeg.exe", "C:\Program Files\ffmpeg\bin\ffmpeg.exe")) { if (Test-Path -LiteralPath $c) { return $c } }
  return $null
}

$ffmpegExe = Find-Ffmpeg
if (-not $ffmpegExe) { [System.IO.File]::WriteAllText($doneSignal, "ERROR:FFMPEG_NOT_FOUND"); exit 1 }

$prefsFile = Join-Path (Split-Path $SessionDir -Parent) "studio_v2_prefs.json"
$capMode = "fullscreen"; $cropX = 0; $cropY = 0; $cropW = $screenW; $cropH = $screenH; $useCrop = $false

if (Test-Path -LiteralPath $prefsFile) {
  try {
    $pObj = Get-Content -LiteralPath $prefsFile -Raw | ConvertFrom-Json
    if ($pObj.captureMode) { $capMode = [string]$pObj.captureMode }
    if (($capMode -eq "select_area" -or $capMode -eq "rectangle") -and $pObj.cropW -ge 80 -and $pObj.cropH -ge 80) {
      $cropX = [int]$pObj.cropX; $cropY = [int]$pObj.cropY; $cropW = [int]$pObj.cropW; $cropH = [int]$pObj.cropH; $useCrop = $true
    } elseif ($capMode -eq "specific_window" -and $pObj.windowPid) {
      $wp = Get-Process -Id ([int]$pObj.windowPid) -ErrorAction SilentlyContinue
      if ($wp -and $wp.MainWindowHandle -ne [IntPtr]::Zero) {
        try { [void][PxRecGhost]::SetForegroundWindow($wp.MainWindowHandle) } catch {}
        Start-Sleep -Milliseconds 180
        $rc = New-Object PxRecGhost+RECT
        if ([PxRecGhost]::GetWindowRect($wp.MainWindowHandle, [ref]$rc)) {
          $cropX = [Math]::Max(0, $rc.Left + 7); $cropY = [Math]::Max(0, $rc.Top)
          $cropW = ($rc.Right - $rc.Left) - 14; $cropH = ($rc.Bottom - $rc.Top) - 7; $useCrop = $true
        }
      }
    }
  } catch {}
}

if ($useCrop) {
  $cropX = [Math]::Max(0, [Math]::Min($screenW - 80, $cropX)); $cropY = [Math]::Max(0, [Math]::Min($screenH - 80, $cropY))
  $cropW = [Math]::Min($screenW - $cropX, [Math]::Max(80, [int]([Math]::Floor($cropW / 2) * 2)))
  $cropH = [Math]::Min($screenH - $cropY, [Math]::Max(80, [int]([Math]::Floor($cropH / 2) * 2)))
} else { $cropX = 0; $cropY = 0; $cropW = $screenW; $cropH = $screenH }

$guideForm = $null
if ($useCrop) {
  $guideForm = New-Object System.Windows.Forms.Form
  $guideForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None; $guideForm.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $guideForm.Bounds = New-Object System.Drawing.Rectangle(($cropX - 3), ($cropY - 3), ($cropW + 6), ($cropH + 6))
  $guideForm.TopMost = $true; $guideForm.ShowInTaskbar = $false
  $guideForm.BackColor = [System.Drawing.Color]::Magenta; $guideForm.TransparencyKey = [System.Drawing.Color]::Magenta
  $guideForm.Add_Paint({ $_.Graphics.DrawRectangle((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(244, 63, 94), 3)), 1, 1, $guideForm.Width - 3, $guideForm.Height - 3) })
  $guideForm.Show()
  try {
    $exG = [PxRecGhost]::GetWindowLong($guideForm.Handle, -20)
    [void][PxRecGhost]::SetWindowLong($guideForm.Handle, -20, ($exG -bor 0x20 -bor 0x08000000))
    [void][PxRecGhost]::SetWindowDisplayAffinity($guideForm.Handle, 0x00000011)
  } catch {}
}

$pill = New-Object System.Windows.Forms.Form
$pill.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None; $pill.TopMost = $true; $pill.ShowInTaskbar = $false
$pill.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual; $pill.Width = 290; $pill.Height = 42
$pill.Left = [Math]::Max(20, $screenW - 306); $pill.Top = 10; $pill.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42); $pill.Opacity = 0.95
$lbl = New-Object System.Windows.Forms.Label
$lbl.ForeColor = [System.Drawing.Color]::White; $lbl.Font = New-Object System.Drawing.Font("Segoe UI", 9.0, [System.Drawing.FontStyle]::Bold)
$lbl.Left = 12; $lbl.Top = 0; $lbl.Width = 178; $lbl.Height = 42; $lbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$pill.Controls.Add($lbl)
$stopBtn = New-Object System.Windows.Forms.Button
$stopBtn.Text = "Stop & Rig"; $stopBtn.Left = 194; $stopBtn.Top = 7; $stopBtn.Width = 86; $stopBtn.Height = 28
$stopBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $stopBtn.FlatAppearance.BorderSize = 0
$stopBtn.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68); $stopBtn.ForeColor = [System.Drawing.Color]::White
$stopBtn.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$stopBtn.Add_Click({ $script:stopReq = $true; try { [System.IO.File]::WriteAllText($script:stopSignal, "STOP") } catch {} })
$pill.Controls.Add($stopBtn); $pill.Show()
try { [void][PxRecGhost]::SetWindowDisplayAffinity($pill.Handle, 0x00000011) } catch {}

try {
  if ($Countdown -gt 0) {
    $endWait = [DateTime]::UtcNow.AddSeconds($Countdown)
    while ([DateTime]::UtcNow -lt $endWait) {
      if ($script:stopReq -or (Test-Path -LiteralPath $script:stopSignal)) { break }
      $lbl.Text = "REC in $([Math]::Ceiling(($endWait - [DateTime]::UtcNow).TotalSeconds))s ($cropW x $cropH)"
      [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 60
    }
  }

  # Play Bandicam start.wav if installed!
  if (Test-Path "C:\Program Files\Bandicam\data\start.wav") {
    try { (New-Object System.Media.SoundPlayer "C:\Program Files\Bandicam\data\start.wav").Play() } catch {}
  }

  $filtersTxt = & $ffmpegExe -hide_banner -filters 2>&1 | Out-String
  $hasDda = $filtersTxt -match "ddagrab"
  $vfChain = if ($useCrop) { "crop=${cropW}:${cropH}:${cropX}:${cropY},scale=trunc(iw/2)*2:trunc(ih/2)*2" } else { "scale=trunc(iw/2)*2:trunc(ih/2)*2" }

  function Start-VideoCapture([bool]$useDda) {
    $vIn = if ($useDda) { "-f lavfi -i `"ddagrab=framerate=$Fps`:draw_mouse=0,hwdownload,format=bgra`"" } else { "-f gdigrab -framerate $Fps -draw_mouse 0 -i desktop" }
    $pInfo = New-Object System.Diagnostics.ProcessStartInfo
    $pInfo.FileName = $ffmpegExe
    $pInfo.Arguments = "-y -loglevel error $vIn -an -vf `"$vfChain`" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -movflags +faststart `"$videoOut`""
    $pInfo.RedirectStandardInput = $true; $pInfo.UseShellExecute = $false; $pInfo.CreateNoWindow = $true
    $proc = New-Object System.Diagnostics.Process; $proc.StartInfo = $pInfo; $proc.Start() | Out-Null
    return $proc
  }

  $usedDda = $hasDda; $vProc = Start-VideoCapture -useDda $usedDda; Start-Sleep -Milliseconds 850
  if ($vProc.HasExited -and $usedDda) { $usedDda = $false; $vProc = Start-VideoCapture -useDda $false; Start-Sleep -Milliseconds 450 }

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $samples = New-Object System.Collections.Generic.List[object]; $clicks = New-Object System.Collections.Generic.List[object]
  $wasL = $false; $wasR = $false

  while ($true) {
    [System.Windows.Forms.Application]::DoEvents()
    if ($script:stopReq -or (Test-Path -LiteralPath $script:stopSignal) -or $vProc.HasExited) { break }
    $t = [Math]::Round($sw.Elapsed.TotalSeconds, 3); $sec = [int][Math]::Floor($t)
    $lbl.Text = ("● {0:D2}:{1:D2} • ${cropW}x${cropH}" -f [int][Math]::Floor($sec / 60), ($sec % 60))
    $pos = [System.Windows.Forms.Cursor]::Position
    $rx = [Math]::Max(0, [Math]::Min($cropW, ($pos.X - $cropX))); $ry = [Math]::Max(0, [Math]::Min($cropH, ($pos.Y - $cropY)))
    $inside = ($pos.X -ge $cropX -and $pos.X -le ($cropX + $cropW) -and $pos.Y -ge $cropY -and $pos.Y -le ($cropY + $cropH))
    $btns = [System.Windows.Forms.Control]::MouseButtons
    $lDown = ($btns -band [System.Windows.Forms.MouseButtons]::Left) -ne 0
    $rDown = ($btns -band [System.Windows.Forms.MouseButtons]::Right) -ne 0
    $samples.Add(@{ t = $t; x = $rx; y = $ry })
    if ($inside) {
      if ($lDown -and -not $wasL) { $clicks.Add(@{ t = $t; x = $rx; y = $ry; button = "left" }) }
      if ($rDown -and -not $wasR) { $clicks.Add(@{ t = $t; x = $rx; y = $ry; button = "right" }) }
    }
    $wasL = $lDown; $wasR = $rDown; Start-Sleep -Milliseconds 28
  }

  if (Test-Path "C:\Program Files\Bandicam\data\stop.wav") {
    try { (New-Object System.Media.SoundPlayer "C:\Program Files\Bandicam\data\stop.wav").Play() } catch {}
  }

  $lbl.Text = "Saving MP4..."
  if ($vProc -and -not $vProc.HasExited) {
    try { $vProc.StandardInput.Write("q`n"); $vProc.StandardInput.Flush(); $vProc.StandardInput.Close(); $vProc.WaitForExit(4500) | Out-Null } catch {}
    if (-not $vProc.HasExited) { try { $vProc.Kill() } catch {} }
  }

  $payload = @{ version = "2.3.0"; fps = $Fps; captureMode = $capMode; screenWidth = $cropW; screenHeight = $cropH; duration = [Math]::Round($sw.Elapsed.TotalSeconds, 3); samples = $samples; clicks = $clicks }
  [System.IO.File]::WriteAllText($motionOut, ($payload | ConvertTo-Json -Depth 5 -Compress), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($doneSignal, "OK")
}
finally {
  if ($guideForm) { try { $guideForm.Close(); $guideForm.Dispose() } catch {} }
  try { $pill.Close(); $pill.Dispose() } catch {}
}
try { (New-Object -ComObject WScript.Shell).AppActivate("Adobe After Effects") | Out-Null } catch {}
