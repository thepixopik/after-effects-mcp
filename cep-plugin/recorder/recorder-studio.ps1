param(
  [Parameter(Mandatory=$true)][string]$CommandFile,
  [Parameter(Mandatory=$true)][string]$PrefsFile
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Send-StudioCmd([string]$cmdStr) {
  [System.IO.File]::WriteAllText($CommandFile, $cmdStr, [System.Text.UTF8Encoding]::new($false))
}

$win = New-Object System.Windows.Forms.Form
$win.Text = "Pixopik Recorder Studio v2.0"
$win.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$win.MaximizeBox = $false
$win.MinimizeBox = $true
$win.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$win.ClientSize = New-Object System.Drawing.Size(460, 445)
$win.TopMost = $true
$win.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$win.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)

$hdr = New-Object System.Windows.Forms.Panel
$hdr.Left = 0; $hdr.Top = 0; $hdr.Width = 460; $hdr.Height = 44
$hdr.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$win.Controls.Add($hdr)

$titleLbl = New-Object System.Windows.Forms.Label
$titleLbl.Text = "🎬  PIXOPIK PRO RECORDER STUDIO  •  ZERO-SHAKE ENGINE"
$titleLbl.Font = New-Object System.Drawing.Font("Segoe UI", 9.2, [System.Drawing.FontStyle]::Bold)
$titleLbl.ForeColor = [System.Drawing.Color]::FromArgb(165, 180, 252)
$titleLbl.Left = 16; $titleLbl.Top = 12; $titleLbl.Width = 420; $titleLbl.Height = 22
$hdr.Controls.Add($titleLbl)

function Add-FieldLabel([string]$txt, [int]$x, [int]$y, [int]$w = 205) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $txt; $l.Left = $x; $l.Top = $y; $l.Width = $w; $l.Height = 18
  $l.Font = New-Object System.Drawing.Font("Segoe UI", 8.3, [System.Drawing.FontStyle]::Bold)
  $l.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
  $win.Controls.Add($l)
}

function Add-Dropdown([string[]]$items, [int]$selIdx, [int]$x, [int]$y, [int]$w) {
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

# Row 1: Quick Prep Buttons
$btnChrome = New-Object System.Windows.Forms.Button
$btnChrome.Text = "🧼 Open Clean Chrome"; $btnChrome.Left = 18; $btnChrome.Top = 56; $btnChrome.Width = 206; $btnChrome.Height = 32
$btnChrome.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $btnChrome.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnChrome.ForeColor = [System.Drawing.Color]::White; $btnChrome.Font = New-Object System.Drawing.Font("Segoe UI", 8.8, [System.Drawing.FontStyle]::Bold)
$btnChrome.Add_Click({ Send-StudioCmd "OPEN_CHROME" })
$win.Controls.Add($btnChrome)

$btnGhost = New-Object System.Windows.Forms.Button
$btnGhost.Text = "👻 Open Draw Toolbar"; $btnGhost.Left = 236; $btnGhost.Top = 56; $btnGhost.Width = 206; $btnGhost.Height = 32
$btnGhost.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $btnGhost.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnGhost.ForeColor = [System.Drawing.Color]::White; $btnGhost.Font = New-Object System.Drawing.Font("Segoe UI", 8.8, [System.Drawing.FontStyle]::Bold)
$btnGhost.Add_Click({ Send-StudioCmd "OPEN_GHOST" })
$win.Controls.Add($btnGhost)

# Row 2: Preset & Format
Add-FieldLabel "EDITING PRESET" 18 98
$cmbPreset = Add-Dropdown @("🎓 YouTube Tutorial (95% Big Screen)", "🚀 SaaS Promo (84% 3D Glass)") 0 18 117 256
Add-FieldLabel "FORMAT" 286 98 150
$cmbAspect = Add-Dropdown @("16:9 YouTube", "9:16 Shorts", "1:1 Square") 0 286 117 156

# Row 3: Camera Engine
Add-FieldLabel "CAMERA MOTION ENGINE (ZERO HOVER SHAKE)" 18 152 340
$cmbCam = Add-Dropdown @(
  "🎥 Pro Dolly Travel (Click-Driven, Rock-Steady)",
  "🎯 Classic Zoom In / Out on Clicks",
  "📌 Static Locked Camera (0% Zoom/Move)"
) 0 18 171 424

# Row 4: Zoom Strength & Dead-Zone Safe Box
Add-FieldLabel "ZOOM DEPTH" 18 206
$cmbZoom = Add-Dropdown @("135% Gentle Zoom", "150% Balanced Pro", "175% Deep Close-Up") 1 18 225 204
Add-FieldLabel "ANTI-SHAKE SAFE ZONE" 238 206
$cmbDead = Add-Dropdown @("🛡️ Strict 65% Safe-Box (Best)", "⚖️ Medium 45% Safe-Box", "🎯 Follow Every Click") 0 238 225 204

# Row 5: Cursor Stabilizer & Eye Dimmer
Add-FieldLabel "CURSOR STABILIZER" 18 260
$cmbCur = Add-Dropdown @("✨ Butter-Smooth Stabilized", "⚡ Raw Instant Cursor") 0 18 279 204
Add-FieldLabel "EYE-SAFE GHOST DIMMER" 238 260
$cmbDim = Add-Dropdown @("☀️ Off (100% Bright)", "🌙 30% Eye Dim", "🌙 50% Night Dim") 0 238 279 204
$cmbDim.Add_SelectedIndexChanged({
  $vals = @(0, 30, 50)
  Send-StudioCmd ("DIM:" + $vals[$cmbDim.SelectedIndex])
})

# Row 6: Backdrop & Countdown
Add-FieldLabel "STUDIO BACKDROP" 18 314
$cmbWall = Add-Dropdown @("🖤 Dark Carbon", "🌌 Cosmic Indigo", "🌊 Ocean Breeze", "🔥 Sunset Coral") 0 18 333 204
Add-FieldLabel "START COUNTDOWN" 238 314
$cmbDelay = Add-Dropdown @("⏱️ 3 Seconds", "⏱️ 5 Seconds", "⚡ Instant (0s)") 0 238 333 204

# Checkboxes
$chkSfx = New-Object System.Windows.Forms.CheckBox
$chkSfx.Text = "🔊 Click SFX"; $chkSfx.Checked = $true; $chkSfx.Left = 20; $chkSfx.Top = 367; $chkSfx.Width = 120
$chkSfx.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240); $win.Controls.Add($chkSfx)

$chkRip = New-Object System.Windows.Forms.CheckBox
$chkRip.Text = "💫 Click Ripples"; $chkRip.Checked = $true; $chkRip.Left = 155; $chkRip.Top = 367; $chkRip.Width = 135
$chkRip.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240); $win.Controls.Add($chkRip)

$chkAuto = New-Object System.Windows.Forms.CheckBox
$chkAuto.Text = "⚡ Auto-Rig in AE"; $chkAuto.Checked = $true; $chkAuto.Left = 305; $chkAuto.Top = 367; $chkAuto.Width = 140
$chkAuto.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240); $win.Controls.Add($chkAuto)

# Start Button
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "●  START PRO STUDIO RECORDING (60 FPS)"
$btnStart.Left = 18; $btnStart.Top = 394; $btnStart.Width = 424; $btnStart.Height = 40
$btnStart.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnStart.FlatAppearance.BorderSize = 0
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(225, 29, 72)
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.Font = New-Object System.Drawing.Font("Segoe UI", 10.0, [System.Drawing.FontStyle]::Bold)
$btnStart.Add_Click({
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
    countdown     = $delayMap[$cmbDelay.SelectedIndex]
    clickSfx      = [bool]$chkSfx.Checked
    clickRipples  = [bool]$chkRip.Checked
    autoRig       = [bool]$chkAuto.Checked
    autoZoom      = ($cmbCam.SelectedIndex -ne 2)
  }

  [System.IO.File]::WriteAllText($PrefsFile, ($prefs | ConvertTo-Json -Depth 4 -Compress), [System.Text.UTF8Encoding]::new($false))
  Send-StudioCmd "START_RECORD"
  $win.Close()
})
$win.Controls.Add($btnStart)

[System.Windows.Forms.Application]::Run($win)
