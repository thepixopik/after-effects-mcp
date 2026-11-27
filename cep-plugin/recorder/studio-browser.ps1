param(
  [string]$StartUrl = "https://pixopik.com"
)

$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

try {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PxRealChrome {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

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

if ($StartUrl -notmatch "^https?://") { $StartUrl = "https://$StartUrl" }

# 1. Capture existing Chrome windows, then launch 100% REAL Google Chrome (--new-window)
$before = New-Object "System.Collections.Generic.HashSet[IntPtr]"
foreach ($h in [PxRealChrome]::GetChromeWindows()) { [void]$before.Add($h) }

Start-Process -FilePath $chromeExe -ArgumentList "--new-window `"$StartUrl`"" | Out-Null

$targetHwnd = [IntPtr]::Zero
$deadline = [DateTime]::UtcNow.AddSeconds(6)
while ([DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 70
  foreach ($h in [PxRealChrome]::GetChromeWindows()) {
    if (-not $before.Contains($h)) {
      $targetHwnd = $h
      break
    }
  }
  if ($targetHwnd -ne [IntPtr]::Zero) { break }
}

if ($targetHwnd -eq [IntPtr]::Zero) { exit 0 }

# Maximize Real Chrome cleanly
[void][PxRealChrome]::ShowWindow($targetHwnd, 3)
[void][PxRealChrome]::SetForegroundWindow($targetHwnd)
Start-Sleep -Milliseconds 450

# Shallow UIA Finder (skips webpage Document so it runs in < 2ms with zero lag!)
function Get-ChromeToolbarGeometry([IntPtr]$hwnd) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if (-not $root) { return $null }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@{ el = $root; depth = 0 })

    $navToolbarRect = [System.Windows.Rect]::Empty
    $omniboxRect    = [System.Windows.Rect]::Empty
    $hasBookmarksBar = $false

    while ($queue.Count -gt 0) {
      $item = $queue.Dequeue()
      $el = $item.el
      $d  = $item.depth
      if ($d -gt 6) { continue }

      $ct = $el.Current.ControlType
      if ($ct -eq [System.Windows.Automation.ControlType]::Document) { continue }

      if ($ct -eq [System.Windows.Automation.ControlType]::ToolBar) {
        $nm = $el.Current.Name
        $rc = $el.Current.BoundingRectangle
        if ($nm -match "Bookmark|Saved") {
          if ($rc.Height -gt 14) { $hasBookmarksBar = $true }
        } elseif ($navToolbarRect.IsEmpty -and $rc.Width -gt 300 -and $rc.Height -ge 28 -and $rc.Height -le 64) {
          $navToolbarRect = $rc
        }
      }
      elseif ($ct -eq [System.Windows.Automation.ControlType]::Edit) {
        $rcE = $el.Current.BoundingRectangle
        if ($omniboxRect.IsEmpty -and $rcE.Width -gt 140 -and $rcE.Height -ge 20 -and $rcE.Height -le 52) {
          $omniboxRect = $rcE
        }
      }

      if ($d -lt 6) {
        $child = $walker.GetFirstChild($el)
        while ($child -ne $null) {
          $queue.Enqueue(@{ el = $child; depth = ($d + 1) })
          $child = $walker.GetNextSibling($child)
        }
      }
    }

    return @{
      toolbarRect  = $navToolbarRect
      omniboxRect  = $omniboxRect
      bookmarksOn  = $hasBookmarksBar
    }
  } catch {
    return $null
  }
}

# Auto-hide Saved Bookmarks Bar if currently visible in Real Chrome
$initGeo = Get-ChromeToolbarGeometry $targetHwnd
if ($initGeo -and $initGeo.bookmarksOn) {
  [void][PxRealChrome]::SetForegroundWindow($targetHwnd)
  Start-Sleep -Milliseconds 60
  [System.Windows.Forms.SendKeys]::SendWait("^+b")
}

function Sample-ScreenColor([int]$x, [int]$y) {
  try {
    $bmp = New-Object System.Drawing.Bitmap(1, 1)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, [System.Drawing.Size]::new(1, 1))
    $col = $bmp.GetPixel(0, 0)
    $g.Dispose(); $bmp.Dispose()
    return $col
  } catch {
    return [System.Drawing.Color]::FromArgb(32, 33, 36)
  }
}

# Seamless Click-Through Patch ONLY over Chrome's Extension Icons Strip!
$extMask = New-Object System.Windows.Forms.Form
$extMask.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$extMask.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
$extMask.ShowInTaskbar   = $false
$extMask.TopMost         = $true
$extMask.Width           = 10
$extMask.Height          = 10
$extMask.Left            = -2000
$extMask.Top             = -2000
$extMask.BackColor       = [System.Drawing.Color]::FromArgb(32, 33, 36)

$extMask.Add_Shown({
  try {
    $ex = [PxRealChrome]::GetWindowLong($extMask.Handle, -20)
    # WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE
    [void][PxRealChrome]::SetWindowLong($extMask.Handle, -20, ($ex -bor 0x80000 -bor 0x20 -bor 0x08000000))
  } catch {}
})
$extMask.Show()

$script:tickCount = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 110
$timer.Add_Tick({
  # Exit automatically as soon as the user closes that Real Chrome window!
  if (-not [PxRealChrome]::IsWindow($targetHwnd)) {
    $timer.Stop()
    $extMask.Close()
    [System.Windows.Forms.Application]::Exit()
    return
  }

  $fg = [PxRealChrome]::GetForegroundWindow()
  if ([PxRealChrome]::IsIconic($targetHwnd) -or $fg -ne $targetHwnd) {
    if ($extMask.Visible) { $extMask.Hide() }
    return
  }

  $geo = Get-ChromeToolbarGeometry $targetHwnd
  if (-not $geo -or $geo.toolbarRect.IsEmpty -or $geo.omniboxRect.IsEmpty) {
    if ($extMask.Visible) { $extMask.Hide() }
    return
  }

  $tb = $geo.toolbarRect
  $om = $geo.omniboxRect

  # Cover ONLY the extension icons + puzzle strip to the right of the real URL omnibox (leave 3-dot menu intact!)
  $mx = [int][Math]::Round($om.Right + 6)
  $my = [int][Math]::Round($tb.Top + 2)
  $mw = [int][Math]::Round(($tb.Right - 38) - $mx)
  $mh = [int][Math]::Round($tb.Height - 4)

  if ($mw -le 12 -or $mh -le 12) {
    if ($extMask.Visible) { $extMask.Hide() }
    return
  }

  if (($script:tickCount % 5) -eq 0) {
    $sx = [int][Math]::Round($tb.Left + 3)
    $sy = [int][Math]::Round($tb.Top + 4)
    $extMask.BackColor = Sample-ScreenColor $sx $sy
  }
  $script:tickCount++

  $extMask.SetBounds($mx, $my, $mw, $mh)
  if (-not $extMask.Visible) { $extMask.Show() }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
