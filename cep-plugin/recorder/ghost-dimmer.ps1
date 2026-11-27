param(
  [int]$DimPercent = 50
)

$ErrorActionPreference = "SilentlyContinue"
if ($DimPercent -le 0) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PxEyeDim {
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
}
"@ -ErrorAction SilentlyContinue
} catch {}

# Auto-close external DimScreen.exe if running so two dimmers NEVER stack!
Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match "(?i)^(dimscreen|dimmer)$"
} | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
}

$opacity = [Math]::Max(0.05, [Math]::Min(0.88, [Math]::Round($DimPercent / 100.0, 2)))
$allScreens = [System.Windows.Forms.Screen]::AllScreens
$forms = New-Object System.Collections.Generic.List[System.Windows.Forms.Form]

foreach ($scr in $allScreens) {
  $f = New-Object System.Windows.Forms.Form
  $f.Text            = "PixopikGhostEyeDimmer"
  $f.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $f.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
  $f.Bounds          = $scr.Bounds
  $f.TopMost         = $true
  $f.ShowInTaskbar   = $false
  $f.BackColor       = [System.Drawing.Color]::Black
  $f.Opacity         = $opacity
  $f.Show()

  try {
    $ex = [PxEyeDim]::GetWindowLong($f.Handle, -20)
    # Click-through + NoActivate + ExcludeFromCapture (100% invisible in MP4 & screenshots!)
    [void][PxEyeDim]::SetWindowLong($f.Handle, -20, ($ex -bor 0x80000 -bor 0x20 -bor 0x08000000))
    [void][PxEyeDim]::SetWindowDisplayAffinity($f.Handle, 0x00000011)
  } catch {}

  $forms.Add($f)
}

if ($forms.Count -gt 0) {
  [System.Windows.Forms.Application]::Run($forms[0])
}
