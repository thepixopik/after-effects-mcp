param(
  [string]$StartUrl = "https://pixopik.com"
)

$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PxBrowserWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  public static List<IntPtr> GetChromeWindows() {
    var list = new List<IntPtr>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      var sb = new StringBuilder(128);
      GetClassName(hWnd, sb, sb.Capacity);
      if (sb.ToString() == "Chrome_WidgetWin_1") {
        var tb = new StringBuilder(256);
        GetWindowText(hWnd, tb, tb.Capacity);
        if (tb.Length > 0) list.Add(hWnd);
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static string GetTitle(IntPtr hWnd) {
    var tb = new StringBuilder(256);
    GetWindowText(hWnd, tb, tb.Capacity);
    return tb.ToString();
  }
}
"@ -ErrorAction SilentlyContinue
} catch {}

function Find-ChromeExe {
  foreach ($p in @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

$chromeExe = Find-ChromeExe
if (-not $chromeExe) { exit 1 }

function Normalize-InputUrl([string]$raw) {
  $s = ($raw + "").Trim()
  if (-not $s) { return "https://www.google.com" }
  if ($s -match "^https?://") { return $s }
  if ($s -notmatch "\s" -and $s -match "\.") { return "https://$s" }
  return "https://www.google.com/search?q=$([uri]::EscapeDataString($s))"
}

$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$wx = $work.X; $wy = $work.Y; $ww = $work.Width; $wh = $work.Height
$headerH = 80

$script:tabs = New-Object System.Collections.Generic.List[object]
$script:activeIdx = -1

function Snap-ChromeAppWindow([IntPtr]$hwnd) {
  if ($hwnd -eq [IntPtr]::Zero) { return }
  # Tuck Chrome's 32px native titlebar right behind our 80px custom Studio Tab+URL header!
  [void][PxBrowserWin]::ShowWindow($hwnd, 9)
  [void][PxBrowserWin]::SetWindowPos($hwnd, [IntPtr]::Zero, ($wx - 7), ($wy + $headerH - 32), ($ww + 14), ($wh - $headerH + 39), 0x0040)
}

function Launch-AppHwnd([string]$url) {
  $before = New-Object "System.Collections.Generic.HashSet[IntPtr]"
  foreach ($h in [PxBrowserWin]::GetChromeWindows()) { [void]$before.Add($h) }

  Start-Process -FilePath $chromeExe -ArgumentList "--app=`"$url`"" | Out-Null

  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ([DateTime]::UtcNow -lt $deadline) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 60
    foreach ($h in [PxBrowserWin]::GetChromeWindows()) {
      if (-not $before.Contains($h)) {
        Snap-ChromeAppWindow $h
        return $h
      }
    }
  }
  return [IntPtr]::Zero
}

# Build Sleek Studio Browser Header (Tab Strip + Clean URL Bar)
$header = New-Object System.Windows.Forms.Form
$header.Text = "Pixopik Clean Browser"
$header.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$header.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
$header.Bounds          = [System.Drawing.Rectangle]::new($wx, $wy, $ww, $headerH)
$header.TopMost         = $true
$header.ShowInTaskbar   = $true
$header.BackColor       = [System.Drawing.Color]::FromArgb(17, 24, 39)

# Row 1: Tab Bar Panel (0..38px)
$tabStrip = New-Object System.Windows.Forms.Panel
$tabStrip.Left = 0; $tabStrip.Top = 0; $tabStrip.Width = $ww; $tabStrip.Height = 38
$tabStrip.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 25)
$header.Controls.Add($tabStrip)

# macOS Window Dots (Left)
$dotPanel = New-Object System.Windows.Forms.Panel
$dotPanel.Left = 12; $dotPanel.Top = 0; $dotPanel.Width = 66; $dotPanel.Height = 38
$dotPanel.Add_Paint({
  param($s, $e)
  $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $cols = @(
    [System.Drawing.Color]::FromArgb(255, 95, 86),
    [System.Drawing.Color]::FromArgb(255, 189, 46),
    [System.Drawing.Color]::FromArgb(39, 201, 63)
  )
  for ($i = 0; $i -lt 3; $i++) {
    $br = New-Object System.Drawing.SolidBrush($cols[$i])
    $e.Graphics.FillEllipse($br, ($i * 20) + 4, 13, 12, 12)
    $br.Dispose()
  }
})
$tabStrip.Controls.Add($dotPanel)

$tabsHost = New-Object System.Windows.Forms.Panel
$tabsHost.Left = 82; $tabsHost.Top = 4; $tabsHost.Width = ($ww - 134); $tabsHost.Height = 34
$tabsHost.BackColor = [System.Drawing.Color]::Transparent
$tabStrip.Controls.Add($tabsHost)

# Close Browser Button (Far Top-Right)
$btnQuit = New-Object System.Windows.Forms.Button
$btnQuit.Text = "X"
$btnQuit.Left = ($ww - 44); $btnQuit.Top = 4; $btnQuit.Width = 36; $btnQuit.Height = 28
$btnQuit.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnQuit.FlatAppearance.BorderSize = 0
$btnQuit.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnQuit.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$btnQuit.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$btnQuit.Add_Click({
  foreach ($t in $script:tabs) {
    if ($t.hwnd -ne [IntPtr]::Zero -and [PxBrowserWin]::IsWindow($t.hwnd)) {
      [void][PxBrowserWin]::PostMessage($t.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    }
  }
  $header.Close()
})
$tabStrip.Controls.Add($btnQuit)

# Row 2: Clean Navigation & URL Bar (38..80px)
$navRow = New-Object System.Windows.Forms.Panel
$navRow.Left = 0; $navRow.Top = 38; $navRow.Width = $ww; $navRow.Height = 42
$navRow.BackColor = [System.Drawing.Color]::FromArgb(20, 27, 45)
$header.Controls.Add($navRow)

function New-NavBtn([string]$txt, [int]$x) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $txt; $b.Left = $x; $b.Top = 6; $b.Width = 32; $b.Height = 30
  $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $b.FlatAppearance.BorderSize = 0
  $b.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
  $b.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
  $b.Font = New-Object System.Drawing.Font("Segoe UI Symbol", 9.5, [System.Drawing.FontStyle]::Bold)
  $b.Cursor = [System.Windows.Forms.Cursors]::Hand
  $navRow.Controls.Add($b)
  return $b
}

$btnBack   = New-NavBtn "<" 12
$btnFwd    = New-NavBtn ">" 48
$btnReload = New-NavBtn "R" 84

# Pill URL Container
$urlWrap = New-Object System.Windows.Forms.Panel
$urlWrap.Left = 128; $urlWrap.Top = 6; $urlWrap.Width = ($ww - 216); $urlWrap.Height = 30
$urlWrap.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 25)
$navRow.Controls.Add($urlWrap)

$lockLbl = New-Object System.Windows.Forms.Label
$lockLbl.Text = "HTTPS"
$lockLbl.Left = 8; $lockLbl.Top = 0; $lockLbl.Width = 44; $lockLbl.Height = 30
$lockLbl.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
$lockLbl.Font = New-Object System.Drawing.Font("Segoe UI", 7.8, [System.Drawing.FontStyle]::Bold)
$lockLbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$urlWrap.Controls.Add($lockLbl)

$urlBox = New-Object System.Windows.Forms.TextBox
$urlBox.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$urlBox.BackColor   = [System.Drawing.Color]::FromArgb(11, 15, 25)
$urlBox.ForeColor   = [System.Drawing.Color]::FromArgb(241, 245, 249)
$urlBox.Font        = New-Object System.Drawing.Font("Segoe UI", 10.0)
$urlBox.Left = 56; $urlBox.Top = 6; $urlBox.Width = ($urlWrap.Width - 68)
$urlWrap.Controls.Add($urlBox)

$btnGo = New-Object System.Windows.Forms.Button
$btnGo.Text = "Go"
$btnGo.Left = ($ww - 80); $btnGo.Top = 6; $btnGo.Width = 64; $btnGo.Height = 30
$btnGo.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnGo.FlatAppearance.BorderSize = 0
$btnGo.BackColor = [System.Drawing.Color]::FromArgb(79, 70, 229)
$btnGo.ForeColor = [System.Drawing.Color]::White
$btnGo.Font = New-Object System.Drawing.Font("Segoe UI", 8.8, [System.Drawing.FontStyle]::Bold)
$btnGo.Cursor = [System.Windows.Forms.Cursors]::Hand
$navRow.Controls.Add($btnGo)

function Send-KeyToActive([string]$keys) {
  if ($script:activeIdx -lt 0 -or $script:activeIdx -ge $script:tabs.Count) { return }
  $h = $script:tabs[$script:activeIdx].hwnd
  if ($h -ne [IntPtr]::Zero -and [PxBrowserWin]::IsWindow($h)) {
    [void][PxBrowserWin]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 40
    [System.Windows.Forms.SendKeys]::SendWait($keys)
  }
}

$btnBack.Add_Click({ Send-KeyToActive "%{LEFT}" })
$btnFwd.Add_Click({ Send-KeyToActive "%{RIGHT}" })
$btnReload.Add_Click({ Send-KeyToActive "{F5}" })

function Render-TabStrip {
  $tabsHost.Controls.Clear()
  $x = 0
  for ($i = 0; $i -lt $script:tabs.Count; $i++) {
    $t = $script:tabs[$i]
    $isAct = ($i -eq $script:activeIdx)
    $tabPnl = New-Object System.Windows.Forms.Panel
    $tabPnl.Left = $x; $tabPnl.Top = 2; $tabPnl.Width = 204; $tabPnl.Height = 32
    $tabPnl.BackColor = if ($isAct) { [System.Drawing.Color]::FromArgb(20, 27, 45) } else { [System.Drawing.Color]::FromArgb(15, 20, 34) }
    $tabPnl.Tag = $i

    $tLbl = New-Object System.Windows.Forms.Label
    $shortT = if ($t.title.Length -gt 22) { $t.title.Substring(0, 21) + "..." } else { $t.title }
    $tLbl.Text = $shortT
    $tLbl.Left = 10; $tLbl.Top = 0; $tLbl.Width = 162; $tLbl.Height = 32
    $tLbl.ForeColor = if ($isAct) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(148, 163, 184) }
    $tLbl.Font = New-Object System.Drawing.Font("Segoe UI", 8.8, $(if ($isAct) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }))
    $tLbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $tLbl.Cursor = [System.Windows.Forms.Cursors]::Hand
    $tLbl.Tag = $i
    $tLbl.Add_Click({ param($s, $e) Switch-ToTab ([int]$s.Tag) })
    $tabPnl.Controls.Add($tLbl)

    $xBtn = New-Object System.Windows.Forms.Label
    $xBtn.Text = "x"
    $xBtn.Left = 176; $xBtn.Top = 6; $xBtn.Width = 22; $xBtn.Height = 20
    $xBtn.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
    $xBtn.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
    $xBtn.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $xBtn.Cursor = [System.Windows.Forms.Cursors]::Hand
    $xBtn.Tag = $i
    $xBtn.Add_Click({ param($s, $e) Close-TabAt ([int]$s.Tag) })
    $tabPnl.Controls.Add($xBtn)

    $tabsHost.Controls.Add($tabPnl)
    $x += 208
  }

  $plusBtn = New-Object System.Windows.Forms.Button
  $plusBtn.Text = "+"
  $plusBtn.Left = $x + 4; $plusBtn.Top = 3; $plusBtn.Width = 32; $plusBtn.Height = 28
  $plusBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $plusBtn.FlatAppearance.BorderSize = 0
  $plusBtn.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
  $plusBtn.ForeColor = [System.Drawing.Color]::White
  $plusBtn.Font = New-Object System.Drawing.Font("Segoe UI", 11.0, [System.Drawing.FontStyle]::Bold)
  $plusBtn.Cursor = [System.Windows.Forms.Cursors]::Hand
  $plusBtn.Add_Click({ Open-NewTab "https://www.google.com" })
  $tabsHost.Controls.Add($plusBtn)
}

function Switch-ToTab([int]$idx) {
  if ($idx -lt 0 -or $idx -ge $script:tabs.Count) { return }
  $script:activeIdx = $idx
  for ($i = 0; $i -lt $script:tabs.Count; $i++) {
    $h = $script:tabs[$i].hwnd
    if ($h -ne [IntPtr]::Zero -and [PxBrowserWin]::IsWindow($h)) {
      if ($i -eq $idx) {
        Snap-ChromeAppWindow $h
        [void][PxBrowserWin]::SetForegroundWindow($h)
      } else {
        [void][PxBrowserWin]::ShowWindow($h, 6) # Minimize inactive tab cleanly
      }
    }
  }
  $urlBox.Text = $script:tabs[$idx].url
  Render-TabStrip
}

function Open-NewTab([string]$rawUrl) {
  $u = Normalize-InputUrl $rawUrl
  foreach ($existing in $script:tabs) {
    if ($existing.hwnd -ne [IntPtr]::Zero -and [PxBrowserWin]::IsWindow($existing.hwnd)) {
      [void][PxBrowserWin]::ShowWindow($existing.hwnd, 6)
    }
  }
  $h = Launch-AppHwnd $u
  $title = if ($h -ne [IntPtr]::Zero) { [PxBrowserWin]::GetTitle($h) } else { $u }
  if (-not $title) { $title = $u }
  $script:tabs.Add(@{ url = $u; title = $title; hwnd = $h })
  $script:activeIdx = $script:tabs.Count - 1
  $urlBox.Text = $u
  Render-TabStrip
}

function Navigate-ActiveTab([string]$rawUrl) {
  $u = Normalize-InputUrl $rawUrl
  if ($script:activeIdx -lt 0 -or $script:activeIdx -ge $script:tabs.Count) {
    Open-NewTab $u
    return
  }
  $oldH = $script:tabs[$script:activeIdx].hwnd
  $newH = Launch-AppHwnd $u
  if ($oldH -ne [IntPtr]::Zero -and [PxBrowserWin]::IsWindow($oldH)) {
    [void][PxBrowserWin]::PostMessage($oldH, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  $script:tabs[$script:activeIdx].url = $u
  $script:tabs[$script:activeIdx].hwnd = $newH
  $t = if ($newH -ne [IntPtr]::Zero) { [PxBrowserWin]::GetTitle($newH) } else { $u }
  if ($t) { $script:tabs[$script:activeIdx].title = $t }
  $urlBox.Text = $u
  Render-TabStrip
}

function Close-TabAt([int]$idx) {
  if ($idx -lt 0 -or $idx -ge $script:tabs.Count) { return }
  $h = $script:tabs[$idx].hwnd
  if ($h -ne [IntPtr]::Zero -and [PxBrowserWin]::IsWindow($h)) {
    [void][PxBrowserWin]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  $script:tabs.RemoveAt($idx)
  if ($script:tabs.Count -eq 0) {
    $header.Close()
    return
  }
  if ($script:activeIdx -ge $script:tabs.Count) { $script:activeIdx = $script:tabs.Count - 1 }
  Switch-ToTab $script:activeIdx
}

$btnGo.Add_Click({ Navigate-ActiveTab $urlBox.Text })
$urlBox.Add_KeyDown({
  param($s, $e)
  if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
    $e.SuppressKeyPress = $true
    Navigate-ActiveTab $urlBox.Text
  }
})

# Live Sync Timer: updates tab titles automatically as you browse inside Chrome!
$syncTimer = New-Object System.Windows.Forms.Timer
$syncTimer.Interval = 600
$syncTimer.Add_Tick({
  if ($script:activeIdx -ge 0 -and $script:activeIdx -lt $script:tabs.Count) {
    $cur = $script:tabs[$script:activeIdx]
    if ($cur.hwnd -ne [IntPtr]::Zero -and [PxBrowserWin]::IsWindow($cur.hwnd)) {
      $liveTitle = [PxBrowserWin]::GetTitle($cur.hwnd)
      if ($liveTitle -and $liveTitle -ne $cur.title) {
        $cur.title = $liveTitle
        Render-TabStrip
      }
    }
  }
})
$syncTimer.Start()

$header.Add_Shown({
  Open-NewTab $StartUrl
})

[System.Windows.Forms.Application]::Run($header)
