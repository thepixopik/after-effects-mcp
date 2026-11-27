param(
  [int]$Port = 47832
)

$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PxGhostWin {
  [DllImport("user32.dll")]
  public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
}
"@ -ErrorAction SilentlyContinue
} catch {}

function Enable-GhostWindow([System.Windows.Forms.Form]$frm) {
  try {
    # 0x00000011 = WDA_EXCLUDEFROMCAPTURE (Visible to user, 100% invisible in screen recordings!)
    [void][PxGhostWin]::SetWindowDisplayAffinity($frm.Handle, 0x00000011)
  } catch {}
}

$script:bridgePort = $Port
function Send-ToolCmd([string]$toolName, [string]$extraUrl = "") {
  try {
    $u = "http://127.0.0.1:$($script:bridgePort)/cmd?tool=$([uri]::EscapeDataString($toolName))"
    if ($extraUrl) { $u += "&url=$([uri]::EscapeDataString($extraUrl))" }
    Invoke-RestMethod -Uri $u -Method Get -TimeoutSec 1 | Out-Null
  } catch {}
}

$bounds  = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$screenW = $bounds.Width

$bar = New-Object System.Windows.Forms.Form
$bar.Text = "Pixopik Ghost Toolbar"
$bar.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$bar.TopMost = $true
$bar.ShowInTaskbar = $false
$bar.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$bar.Width = 776
$bar.Height = 44
$bar.Left = [Math]::Max(16, [int](($screenW - $bar.Width) / 2))
$bar.Top = 10
$bar.BackColor = [System.Drawing.Color]::FromArgb(13, 18, 30)
$bar.Opacity = 0.96

$bar.Add_Shown({ Enable-GhostWindow $bar })

# Drag handle label
$drag = New-Object System.Windows.Forms.Label
$drag.Text = "GHOST BAR"
$drag.ForeColor = [System.Drawing.Color]::FromArgb(129, 140, 248)
$drag.Font = New-Object System.Drawing.Font("Segoe UI", 8.0, [System.Drawing.FontStyle]::Bold)
$drag.Left = 10
$drag.Top = 0
$drag.Width = 74
$drag.Height = 44
$drag.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$drag.Cursor = [System.Windows.Forms.Cursors]::SizeAll

$script:dragging = $false
$script:dragOffset = New-Object System.Drawing.Point(0, 0)
$drag.Add_MouseDown({
  param($s, $e)
  $script:dragging = $true
  $script:dragOffset = New-Object System.Drawing.Point($e.X, $e.Y)
})
$drag.Add_MouseMove({
  param($s, $e)
  if ($script:dragging) {
    $p = [System.Windows.Forms.Cursor]::Position
    $bar.Left = $p.X - $script:dragOffset.X - 10
    $bar.Top  = $p.Y - $script:dragOffset.Y
  }
})
$drag.Add_MouseUp({ $script:dragging = $false })
$bar.Controls.Add($drag)

$script:toolBtns = @{}
$items = @(
  @{ id = "cursor";    txt = "Cursor";    w = 58 },
  @{ id = "spotlight"; txt = "Spot";      w = 54 },
  @{ id = "box";       txt = "Box";       w = 50 },
  @{ id = "arrow";     txt = "Arrow";     w = 58 },
  @{ id = "pen";       txt = "Pen";       w = 50 },
  @{ id = "blur";      txt = "Blur";      w = 52 },
  @{ id = "step";      txt = "1-2-3";     w = 56 },
  @{ id = "laser";     txt = "Laser";     w = 56 },
  @{ id = "goto_url";  txt = "Go URL";    w = 64 },
  @{ id = "clear";     txt = "Clear";     w = 54 },
  @{ id = "unblur_all";txt = "Unblur";    w = 60 }
)

function Highlight-Active([string]$activeId) {
  foreach ($k in $script:toolBtns.Keys) {
    $b = $script:toolBtns[$k]
    if ($k -eq $activeId) {
      $b.BackColor = [System.Drawing.Color]::FromArgb(79, 70, 229)
      $b.ForeColor = [System.Drawing.Color]::White
    } else {
      $b.BackColor = [System.Drawing.Color]::FromArgb(26, 35, 52)
      $b.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
    }
  }
}

$curX = 88
foreach ($it in $items) {
  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = $it.txt
  $btn.Tag  = $it.id
  $btn.Left = $curX
  $btn.Top  = 7
  $btn.Width = $it.w
  $btn.Height = 30
  $btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $btn.FlatAppearance.BorderSize = 1
  $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
  $btn.BackColor = [System.Drawing.Color]::FromArgb(26, 35, 52)
  $btn.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
  $btn.Font = New-Object System.Drawing.Font("Segoe UI", 8.2, [System.Drawing.FontStyle]::Bold)
  $btn.Cursor = [System.Windows.Forms.Cursors]::Hand

  $btn.Add_Click({
    param($sender, $ev)
    $tid = [string]$sender.Tag
    if ($tid -eq "goto_url") {
      $u = [Microsoft.VisualBasic.Interaction]::InputBox("Enter website URL for Clean Studio Chrome:", "Pixopik Clean Browser Switcher", "https://pixopik.com")
      if ($u) { Send-ToolCmd "goto_url" $u }
      return
    }
    if ($tid -eq "clear" -or $tid -eq "unblur_all") {
      Send-ToolCmd $tid ""
      return
    }
    Highlight-Active $tid
    Send-ToolCmd $tid ""
  })

  $bar.Controls.Add($btn)
  $script:toolBtns[$it.id] = $btn
  $curX += ($it.w + 5)
}

$closeBtn = New-Object System.Windows.Forms.Button
$closeBtn.Text = "X"
$closeBtn.Left = $curX + 2
$closeBtn.Top = 7
$closeBtn.Width = 30
$closeBtn.Height = 30
$closeBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$closeBtn.FlatAppearance.BorderSize = 0
$closeBtn.BackColor = [System.Drawing.Color]::FromArgb(127, 29, 29)
$closeBtn.ForeColor = [System.Drawing.Color]::White
$closeBtn.Font = New-Object System.Drawing.Font("Segoe UI", 8.2, [System.Drawing.FontStyle]::Bold)
$closeBtn.Add_Click({
  Send-ToolCmd "cursor" ""
  $bar.Close()
})
$bar.Controls.Add($closeBtn)
$bar.Width = $curX + 42
$bar.Left = [Math]::Max(16, [int](($screenW - $bar.Width) / 2))

Highlight-Active "cursor"
[System.Windows.Forms.Application]::Run($bar)
