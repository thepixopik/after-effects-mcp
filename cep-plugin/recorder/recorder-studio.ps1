param(
  [Parameter(Mandatory=$true)][string]$RecordingsRoot,
  [Parameter(Mandatory=$true)][string]$SignalOutFile,
  [string]$BrowserScript = "",
  [string]$GhostScript = "",
  [string]$DimmerScript = ""
)

$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PxStudioGhost {
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
  [DllImport("user32.dll")] public static extern bool ReleaseCapture();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
}
"@ -ErrorAction SilentlyContinue
} catch {}

function Find-Ffmpeg {
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $wg = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path -LiteralPath $wg) {
    $f = Get-ChildItem -LiteralPath $wg -Recurse -Filter "ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { return $f.FullName }
  }
  foreach ($c in @("C:\ffmpeg\bin\ffmpeg.exe", "C:\Program Files\ffmpeg\bin\ffmpeg.exe")) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  return $null
}

$bounds  = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$screenW = $bounds.Width
$screenH = $bounds.Height
$script:dimProc = $null

function Set-EyeDim([int]$pct) {
  if ($script:dimProc -and -not $script:dimProc.HasExited) {
    try { $script:dimProc.Kill() } catch {}
    $script:dimProc = $null
  }
  if ($pct -gt 0 -and $DimmerScript -and (Test-Path -LiteralPath $DimmerScript)) {
    $script:dimProc = Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File `"$DimmerScript`" -DimPercent $pct" -PassThru
  }
}

# ============================================================================
# DEDICATED FLOATING RECORDER STUDIO WINDOW (Screen Studio Style, Ghost Mode)
# ============================================================================
$win = New-Object System.Windows.Forms.Form
$win.Text = "Pixopik Recorder Studio v2.0"
$win.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$win.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$win.Width = 460
$win.Height = 468
$win.TopMost = $true
$win.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$win.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)

$hdr = New-Object System.Windows.Forms.Panel
$hdr.Left = 0; $hdr.Top = 0; $hdr.Width = 460; $hdr.Height = 48
$hdr.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$hdr.Add_MouseDown({
  [PxStudioGhost]::ReleaseCapture() | Out-Null
  [PxStudioGhost]::SendMessage($win.Handle, 0xA1, 0x2, 0) | Out-Null
})
$win.Controls.Add($hdr)

$titleLbl = New-Object System.Windows.Forms.Label
$titleLbl.Text = "🎬  PIXOPIK RECORDER STUDIO  v2.0"
$titleLbl.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$titleLbl.ForeColor = [System.Drawing.Color]::FromArgb(165, 180, 252)
$titleLbl.Left = 16; $titleLbl.Top = 13; $titleLbl.Width = 360; $titleLbl.Height = 24
$titleLbl.Add_MouseDown({
  [PxStudioGhost]::ReleaseCapture() | Out-Null
  [PxStudioGhost]::SendMessage($win.Handle, 0xA1, 0x2, 0) | Out-Null
})
$hdr.Controls.Add($titleLbl)

$closeBtn = New-Object System.Windows.Forms.Button
$closeBtn.Text = "✕"; $closeBtn.Left = 416; $closeBtn.Top = 10; $closeBtn.Width = 32; $closeBtn.Height = 28
$closeBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$closeBtn.FlatAppearance.BorderSize = 0
$closeBtn.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$closeBtn.ForeColor = [System.Drawing.Color]::White
$closeBtn.Add_Click({ Set-EyeDim 0; $win.Close() })
$hdr.Controls.Add($closeBtn)

function Add-Label([string]$txt, [int]$x, [int]$y, [int]$w = 200) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $txt; $l.Left = $x; $l.Top = $y; $l.Width = $w; $l.Height = 18
  $l.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
  $l.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
  $win.Controls.Add($l)
}

function Add-Combo([string[]]$items, [int]$selIdx, [int]$x, [int]$y, [int]$w) {
  $c = New-Object System.Windows.Forms.ComboBox
  $c.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
  $c.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
  $c.ForeColor = [System.Drawing.Color]::White
  $c.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $c.Font = New-Object System.Drawing.Font("Segoe UI", 9.0)
  $c.Left = $x; $c.Top = $y; $c.Width = $w
  [void]$c.Items.AddRange($items)
  $c.SelectedIndex = $selIdx
  $win.Controls.Add($c)
  return $c
}

# Quick Helper Row
$btnChrome = New-Object System.Windows.Forms.Button
$btnChrome.Text = "🧼 Open Clean Chrome"; $btnChrome.Left = 18; $btnChrome.Top = 60; $btnChrome.Width = 206; $btnChrome.Height = 32
$btnChrome.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $btnChrome.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnChrome.ForeColor = [System.Drawing.Color]::White; $btnChrome.Font = New-Object System.Drawing.Font("Segoe UI", 8.8, [System.Drawing.FontStyle]::Bold)
$btnChrome.Add_Click({
  if ($BrowserScript -and (Test-Path -LiteralPath $BrowserScript)) {
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File `"$BrowserScript`" -StartUrl `"https://pixopik.com`""
  }
})
$win.Controls.Add($btnChrome)

$btnGhost = New-Object System.Windows.Forms.Button
$btnGhost.Text = "👻 Open Draw Toolbar"; $btnGhost.Left = 236; $btnGhost.Top = 60; $btnGhost.Width = 206; $btnGhost.Height = 32
$btnGhost.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $btnGhost.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnGhost.ForeColor = [System.Drawing.Color]::White; $btnGhost.Font = New-Object System.Drawing.Font("Segoe UI", 8.8, [System.Drawing.FontStyle]::Bold)
$btnGhost.Add_Click({
  if ($GhostScript -and (Test-Path -LiteralPath $GhostScript)) {
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File `"$GhostScript`""
  }
})
$win.Controls.Add($btnGhost)

# Studio Presets & Aspect
Add-Label "EDITING PRESET" 18 104
$cmbPreset = Add-Combo @("🎓 YouTube Tutorial (95% Big Screen)", "🚀 SaaS Promo (84% 3D Glass)") 0 18 123 255
Add-Label "FORMAT" 286 104 150
$cmbAspect = Add-Combo @("16:9 YouTube", "9:16 Shorts", "1:1 Square") 0 286 123 156

# Camera Motion & Zoom Depth
Add-Label "CAMERA MOTION ENGINE (ZERO HOVER SHAKE)" 18 158 320
$cmbCam = Add-Combo @(
  "🎥 Pro Dolly Travel (Click-Driven, Rock-Steady)",
  "🎯 Classic Zoom In / Out on Clicks",
  "📌 Static Locked Camera (0% Zoom/Move)"
) 0 18 177 424

Add-Label "ZOOM STRENGTH" 18 212
$cmbZoom = Add-Combo @("135% Gentle Zoom", "150% Balanced Pro", "175% Deep Close-Up") 1 18 231 204
Add-Label "ANTI-SHAKE SAFE ZONE" 238 212
$cmbDead = Add-Combo @("🛡️ Strict 65% Safe-Box (Best)", "⚖️ Medium 45% Safe-Box", "🎯 Follow Every Click") 0 238 231 204

# Cursor Smoothness & Eye Dimmer
Add-Label "CURSOR STABILIZER" 18 266
$cmbCur = Add-Combo @("✨ Butter-Smooth Stabilized", "⚡ Raw Instant Cursor") 0 18 285 204
Add-Label "EYE-SAFE GHOST DIMMER" 238 266
$cmbDim = Add-Combo @("☀️ Off (100% Bright)", "🌙 35% Eye Comfort", "🌙 50% Night Dim") 0 238 285 204
$cmbDim.Add_SelectedIndexChanged({
  $vals = @(0, 35, 50)
  Set-EyeDim $vals[$cmbDim.SelectedIndex]
})

# Wallpaper & Delay
Add-Label "STUDIO BACKDROP" 18 320
$cmbWall = Add-Combo @("🖤 Dark Carbon", "🌌 Cosmic Indigo", "🌊 Ocean Breeze", "🔥 Sunset Coral") 0 18 339 204
Add-Label "START COUNTDOWN" 238 320
$cmbDelay = Add-Combo @("⏱️ 3 Seconds", "⏱️ 5 Seconds", "⚡ Instant (0s)") 0 238 339 204

# Toggles
$chkSfx = New-Object System.Windows.Forms.CheckBox
$chkSfx.Text = "🔊 Click SFX"; $chkSfx.Checked = $true; $chkSfx.Left = 20; $chkSfx.Top = 374; $chkSfx.Width = 120
$chkSfx.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240); $win.Controls.Add($chkSfx)

$chkRip = New-Object System.Windows.Forms.CheckBox
$chkRip.Text = "💫 Click Ripples"; $chkRip.Checked = $true; $chkRip.Left = 155; $chkRip.Top = 374; $chkRip.Width = 135
$chkRip.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240); $win.Controls.Add($chkRip)

$chkAuto = New-Object System.Windows.Forms.CheckBox
$chkAuto.Text = "⚡ Auto-Rig in AE"; $chkAuto.Checked = $true; $chkAuto.Left = 305; $chkAuto.Top = 374; $chkAuto.Width = 140
$chkAuto.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240); $win.Controls.Add($chkAuto)

# Big Start Button
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "●  START PRO STUDIO RECORDING (60 FPS)"
$btnStart.Left = 18; $btnStart.Top = 408; $btnStart.Width = 424; $btnStart.Height = 44
$btnStart.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnStart.FlatAppearance.BorderSize = 0
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(225, 29, 72)
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.Font = New-Object System.Drawing.Font("Segoe UI", 10.2, [System.Drawing.FontStyle]::Bold)
$win.Controls.Add($btnStart)

$win.Add_Shown({
  try { [void][PxStudioGhost]::SetWindowDisplayAffinity($win.Handle, 0x00000011) } catch {}
})

function Run-CaptureSession {
  $ffmpegExe = Find-Ffmpeg
  if (-not $ffmpegExe) {
    [System.Windows.Forms.MessageBox]::Show("FFmpeg not found! Click Auto-Install in AE panel first.", "Pixopik Recorder Studio") | Out-Null
    return
  }

  $presetMap = @("youtube_tutorial", "saas_promo")
  $aspectMap = @("youtube_16_9", "shorts_9_16", "square_1_1")
  $camMap    = @("dolly_steady", "click_bounce", "static_lock")
  $zoomMap   = @(135, 150, 175)
  $deadMap   = @(0.65, 0.45, 0.18)
  $wallMap   = @("dark_carbon", "cosmic_indigo", "ocean_breeze", "sunset_saas")
  $delayMap  = @(3, 5, 0)

  $prefs = @{
    editMode      = $presetMap[$cmbPreset.SelectedIndex]
    aspectPreset  = $aspectMap[$cmbAspect.SelectedIndex]
    cameraMode    = $camMap[$cmbCam.SelectedIndex]
    zoomPercent   = $zoomMap[$cmbZoom.SelectedIndex]
    deadZoneRatio = $deadMap[$cmbDead.SelectedIndex]
    cursorSmooth  = if ($cmbCur.SelectedIndex -eq 0) { "high" } else { "raw" }
    wallpaper     = $wallMap[$cmbWall.SelectedIndex]
    frameStyle    = if ($cmbPreset.SelectedIndex -eq 0) { "minimal_rounded" } else { "macos_glass" }
    clickSfx      = [bool]$chkSfx.Checked
    clickRipples  = [bool]$chkRip.Checked
    autoRig       = [bool]$chkAuto.Checked
    autoZoom      = ($cmbCam.SelectedIndex -ne 2)
    vectorCursor  = $true
  }
  $countdownSec = $delayMap[$cmbDelay.SelectedIndex]

  $win.Hide()

  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss-fffZ")
  $sessDir = Join-Path $RecordingsRoot "rec_$stamp"
  New-Item -ItemType Directory -Force -Path $sessDir | Out-Null
  $videoOut  = Join-Path $sessDir "screen.mp4"
  $motionOut = Join-Path $sessDir "motion.json"
  $prefsOut  = Join-Path $sessDir "studio_prefs.json"

  # Floating Live Recording HUD (Invisible in MP4!)
  $hud = New-Object System.Windows.Forms.Form
  $hud.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $hud.TopMost = $true; $hud.ShowInTaskbar = $false
  $hud.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $hud.Width = 376; $hud.Height = 44
  $hud.Left = [Math]::Max(20, $screenW - 396); $hud.Top = 12
  $hud.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
  $hud.Opacity = 0.96

  $lblT = New-Object System.Windows.Forms.Label
  $lblT.ForeColor = [System.Drawing.Color]::White
  $lblT.Font = New-Object System.Drawing.Font("Segoe UI", 9.0, [System.Drawing.FontStyle]::Bold)
  $lblT.Left = 12; $lblT.Top = 0; $lblT.Width = 132; $lblT.Height = 44
  $lblT.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
  $lblT.Add_MouseDown({
    [PxStudioGhost]::ReleaseCapture() | Out-Null
    [PxStudioGhost]::SendMessage($hud.Handle, 0xA1, 0x2, 0) | Out-Null
  })
  $hud.Controls.Add($lblT)

  $script:wantStop = $false
  $script:wantRedo = $false
  $script:pinReq   = $false

  $btnPin = New-Object System.Windows.Forms.Button
  $btnPin.Text = "📍 Zoom Pin"; $btnPin.Left = 146; $btnPin.Top = 8; $btnPin.Width = 84; $btnPin.Height = 28
  $btnPin.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $btnPin.FlatAppearance.BorderSize = 0
  $btnPin.BackColor = [System.Drawing.Color]::FromArgb(79, 70, 229); $btnPin.ForeColor = [System.Drawing.Color]::White
  $btnPin.Font = New-Object System.Drawing.Font("Segoe UI", 8.0, [System.Drawing.FontStyle]::Bold)
  $btnPin.Add_Click({ $script:pinReq = $true })
  $hud.Controls.Add($btnPin)

  $btnRedo = New-Object System.Windows.Forms.Button
  $btnRedo.Text = "↺ Redo"; $btnRedo.Left = 234; $btnRedo.Top = 8; $btnRedo.Width = 56; $btnRedo.Height = 28
  $btnRedo.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $btnRedo.FlatAppearance.BorderSize = 0
  $btnRedo.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85); $btnRedo.ForeColor = [System.Drawing.Color]::White
  $btnRedo.Font = New-Object System.Drawing.Font("Segoe UI", 8.0, [System.Drawing.FontStyle]::Bold)
  $btnRedo.Add_Click({ $script:wantRedo = $true; $script:wantStop = $true })
  $hud.Controls.Add($btnRedo)

  $btnStop = New-Object System.Windows.Forms.Button
  $btnStop.Text = "■ Stop"; $btnStop.Left = 294; $btnStop.Top = 8; $btnStop.Width = 72; $btnStop.Height = 28
  $btnStop.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $btnStop.FlatAppearance.BorderSize = 0
  $btnStop.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68); $btnStop.ForeColor = [System.Drawing.Color]::White
  $btnStop.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
  $btnStop.Add_Click({ $script:wantStop = $true })
  $hud.Controls.Add($btnStop)

  $hud.Show()
  try { [void][PxStudioGhost]::SetWindowDisplayAffinity($hud.Handle, 0x00000011) } catch {}

  if ($countdownSec -gt 0) {
    $endWait = [DateTime]::UtcNow.AddSeconds($countdownSec)
    while ([DateTime]::UtcNow -lt $endWait -and -not $script:wantStop) {
      $rem = [Math]::Ceiling(($endWait - [DateTime]::UtcNow).TotalSeconds)
      $lblT.Text = "Starting in ${rem}s..."
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 50
    }
  }

  if ($script:wantRedo) {
    $hud.Close(); Remove-Item -LiteralPath $sessDir -Recurse -Force
    $win.Show(); return
  }

  $filtersTxt = & $ffmpegExe -hide_banner -filters 2>&1 | Out-String
  $hasDda = $filtersTxt -match "ddagrab"
  function Spawn-Ffmpeg([bool]$dda) {
    $vIn = if ($dda) { "-f lavfi -i `"ddagrab=framerate=60:draw_mouse=0,hwdownload,format=bgra`"" } else { "-f gdigrab -framerate 60 -draw_mouse 0 -i desktop" }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ffmpegExe
    $psi.Arguments = "-y -loglevel error $vIn -an -vf `"scale=trunc(iw/2)*2:trunc(ih/2)*2`" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -movflags +faststart `"$videoOut`""
    $psi.RedirectStandardInput = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $p = New-Object System.Diagnostics.Process; $p.StartInfo = $psi; $p.Start() | Out-Null
    return $p
  }

  $vProc = Spawn-Ffmpeg $hasDda
  Start-Sleep -Milliseconds 750
  if ($vProc.HasExited -and $hasDda) { $vProc = Spawn-Ffmpeg $false; Start-Sleep -Milliseconds 400 }

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $samples  = New-Object System.Collections.Generic.List[object]
  $clicks   = New-Object System.Collections.Generic.List[object]
  $zoomPins = New-Object System.Collections.Generic.List[object]
  $wasL = $false; $wasR = $false

  while (-not $script:wantStop -and -not $vProc.HasExited) {
    [System.Windows.Forms.Application]::DoEvents()
    $t = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
    $sec = [int][Math]::Floor($t)
    $lblT.Text = ("● {0:D2}:{1:D2} • 60fps" -f [int][Math]::Floor($sec / 60), ($sec % 60))

    $pos = [System.Windows.Forms.Cursor]::Position
    $hudRect = [System.Drawing.Rectangle]::Inflate($hud.Bounds, 8, 8)
    $insideHud = $hudRect.Contains($pos)

    if (-not $insideHud) {
      $samples.Add(@{ t = $t; x = $pos.X; y = $pos.Y })
    }

    if ($script:pinReq) {
      $script:pinReq = $false
      $zoomPins.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "pin" })
    }

    $btns = [System.Windows.Forms.Control]::MouseButtons
    $lDown = ($btns -band [System.Windows.Forms.MouseButtons]::Left) -ne 0
    $rDown = ($btns -band [System.Windows.Forms.MouseButtons]::Right) -ne 0
    if (-not $insideHud) {
      if ($lDown -and -not $wasL) { $clicks.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "left" }) }
      if ($rDown -and -not $wasR) { $clicks.Add(@{ t = $t; x = $pos.X; y = $pos.Y; button = "right" }) }
    }
    $wasL = $lDown; $wasR = $rDown
    Start-Sleep -Milliseconds 28
  }

  $lblT.Text = "Finalizing MP4..."
  [System.Windows.Forms.Application]::DoEvents()
  if ($vProc -and -not $vProc.HasExited) {
    try { $vProc.StandardInput.Write("q`n"); $vProc.StandardInput.Flush(); $vProc.StandardInput.Close(); $vProc.WaitForExit(4500) | Out-Null } catch {}
    if (-not $vProc.HasExited) { try { $vProc.Kill() } catch {} }
  }
  $hud.Close()

  if ($script:wantRedo) {
    Remove-Item -LiteralPath $sessDir -Recurse -Force
    $win.Show(); return
  }

  $motObj = @{
    version      = "2.0.0"
    fps          = 60
    screenWidth  = $screenW
    screenHeight = $screenH
    duration     = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
    samples      = $samples
    clicks       = $clicks
    zoomPins     = $zoomPins
  }
  [System.IO.File]::WriteAllText($motionOut, ($motObj | ConvertTo-Json -Depth 5 -Compress), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($prefsOut, ($prefs | ConvertTo-Json -Depth 4 -Compress), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($SignalOutFile, $sessDir, [System.Text.UTF8Encoding]::new($false))

  Set-EyeDim 0
  try { (New-Object -ComObject WScript.Shell).AppActivate("Adobe After Effects") | Out-Null } catch {}
  $win.Close()
}

$btnStart.Add_Click({ Run-CaptureSession })
[System.Windows.Forms.Application]::Run($win)
Set-EyeDim 0
