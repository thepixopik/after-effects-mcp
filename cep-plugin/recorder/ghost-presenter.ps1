$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PxGhostNative {
  [DllImport("user32.dll")]
  public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
  [DllImport("user32.dll")]
  public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")]
  public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
}
"@ -ErrorAction SilentlyContinue
} catch {}

function Set-InvisibleInCapture([System.Windows.Forms.Form]$f) {
  try { [void][PxGhostNative]::SetWindowDisplayAffinity($f.Handle, 0x00000011) } catch {}
}

function Set-ClickThrough([System.Windows.Forms.Form]$f) {
  try {
    $ex = [PxGhostNative]::GetWindowLong($f.Handle, -20)
    [void][PxGhostNative]::SetWindowLong($f.Handle, -20, ($ex -bor 0x80000 -bor 0x20))
  } catch {}
}

$bounds  = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$work    = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$screenW = $bounds.Width
$screenH = $bounds.Height
$keyColor = [System.Drawing.Color]::FromArgb(12, 16, 27)

$script:activeTool = "cursor"
$script:shapes     = New-Object System.Collections.Generic.List[object]
$script:stepNum    = 1
$script:isDrawing  = $false
$script:ptStart    = [System.Drawing.Point]::Empty
$script:ptCurr     = [System.Drawing.Point]::Empty
$script:penPts     = $null

$spotForm = New-Object System.Windows.Forms.Form
$spotForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$spotForm.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
$spotForm.Bounds          = $bounds
$spotForm.TopMost         = $true
$spotForm.ShowInTaskbar   = $false
$spotForm.BackColor       = [System.Drawing.Color]::FromArgb(8, 12, 24)
$spotForm.Opacity         = 0.66

$canvas = New-Object System.Windows.Forms.Form
$canvas.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$canvas.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
$canvas.Bounds          = $bounds
$canvas.TopMost         = $true
$canvas.ShowInTaskbar   = $false
$canvas.BackColor       = $keyColor
$canvas.TransparencyKey = $keyColor
$propDb = $canvas.GetType().GetProperty("DoubleBuffered", [System.Reflection.BindingFlags]"Instance,NonPublic")
if ($propDb) { $propDb.SetValue($canvas, $true, $null) }

$catcher = New-Object System.Windows.Forms.Form
$catcher.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$catcher.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
$catcher.Bounds          = $bounds
$catcher.TopMost         = $true
$catcher.ShowInTaskbar   = $false
$catcher.BackColor       = [System.Drawing.Color]::Black
$catcher.Opacity         = 0.012
$catcher.Cursor          = [System.Windows.Forms.Cursors]::Cross

# Dock Ghost Bar at Bottom-Center so Top Browser Tabs + URL Bar stay 100% clear!
$bar = New-Object System.Windows.Forms.Form
$bar.Text            = "Pixopik Ghost Toolbar"
$bar.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$bar.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
$bar.TopMost         = $true
$bar.ShowInTaskbar   = $false
$bar.Height          = 44
$bar.Top             = [Math]::Max(90, $work.Bottom - 56)
$bar.BackColor       = [System.Drawing.Color]::FromArgb(13, 18, 30)
$bar.Opacity         = 0.96

function Update-CatcherSafeRegion {
  $reg = New-Object System.Drawing.Region([System.Drawing.Rectangle]::new(0, 0, $screenW, $screenH))
  $reg.Exclude([System.Drawing.Rectangle]::Inflate($bar.Bounds, 6, 6))
  # Never block Top 82px Studio Browser Tabs/URL Bar or Top-Right Stop Pill!
  $reg.Exclude([System.Drawing.Rectangle]::new(0, 0, $screenW, 82))
  $catcher.Region = $reg
}

function Add-RoundedRect([System.Drawing.Drawing2D.GraphicsPath]$gp, [System.Drawing.Rectangle]$rc, [int]$rad) {
  $d = [Math]::Min($rad * 2, [Math]::Min($rc.Width, $rc.Height))
  if ($d -le 2) { $gp.AddRectangle($rc); return }
  $gp.AddArc($rc.X, $rc.Y, $d, $d, 180, 90)
  $gp.AddArc($rc.Right - $d, $rc.Y, $d, $d, 270, 90)
  $gp.AddArc($rc.Right - $d, $rc.Bottom - $d, $d, $d, 0, 90)
  $gp.AddArc($rc.X, $rc.Bottom - $d, $d, $d, 90, 90)
  $gp.CloseFigure()
}

$canvas.Add_Paint({
  param($s, $e)
  $g = $e.Graphics
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $now = [DateTime]::UtcNow

  if ($script:activeTool -eq "spotlight") {
    $mp = [System.Windows.Forms.Cursor]::Position
    $sr = [System.Drawing.Rectangle]::new($mp.X - 150, $mp.Y - 92, 300, 184)
    $gpS = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect $gpS $sr 22
    $penGlow = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(99, 102, 241), 3.5)
    $g.DrawPath($penGlow, $gpS)
    $penGlow.Dispose(); $gpS.Dispose()
  }

  if ($script:activeTool -eq "laser") {
    $mp = [System.Windows.Forms.Cursor]::Position
    $brOuter = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(239, 68, 68))
    $brInner = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillEllipse($brOuter, $mp.X - 11, $mp.Y - 11, 22, 22)
    $g.FillEllipse($brInner, $mp.X - 4, $mp.Y - 4, 8, 8)
    $brOuter.Dispose(); $brInner.Dispose()
  }

  for ($i = $script:shapes.Count - 1; $i -ge 0; $i--) {
    $sh = $script:shapes[$i]
    if ($sh.type -eq "pen" -and ($now - $sh.created).TotalSeconds -gt 3.8) {
      $script:shapes.RemoveAt($i)
      continue
    }
    Draw-ShapeItem $g $sh
  }

  if ($script:isDrawing) {
    Draw-ShapeItem $g @{ type = $script:activeTool; p1 = $script:ptStart; p2 = $script:ptCurr; pts = $script:penPts }
  }
})

function Draw-ShapeItem($g, $sh) {
  if ($sh.type -eq "box") {
    $x = [Math]::Min($sh.p1.X, $sh.p2.X); $y = [Math]::Min($sh.p1.Y, $sh.p2.Y)
    $w = [Math]::Max(8, [Math]::Abs($sh.p2.X - $sh.p1.X))
    $h = [Math]::Max(8, [Math]::Abs($sh.p2.Y - $sh.p1.Y))
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect $gp ([System.Drawing.Rectangle]::new($x, $y, $w, $h)) 14
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(99, 102, 241), 4.0)
    $g.DrawPath($pen, $gp)
    $pen.Dispose(); $gp.Dispose()
  }
  elseif ($sh.type -eq "hide") {
    $x = [Math]::Min($sh.p1.X, $sh.p2.X); $y = [Math]::Min($sh.p1.Y, $sh.p2.Y)
    $w = [Math]::Max(24, [Math]::Abs($sh.p2.X - $sh.p1.X))
    $h = [Math]::Max(18, [Math]::Abs($sh.p2.Y - $sh.p1.Y))
    $rc = [System.Drawing.Rectangle]::new($x, $y, $w, $h)
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect $gp $rc 10
    $br = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(17, 24, 39))
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(71, 85, 105), 2.0)
    $g.FillPath($br, $gp); $g.DrawPath($pen, $gp)
    if ($w -gt 70 -and $h -gt 22) {
      $fnt = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
      $tBr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(148, 163, 184))
      $sf  = New-Object System.Drawing.StringFormat
      $sf.Alignment = [System.Drawing.StringAlignment]::Center
      $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
      $g.DrawString("HIDDEN", $fnt, $tBr, [System.Drawing.RectangleF]$rc, $sf)
      $fnt.Dispose(); $tBr.Dispose(); $sf.Dispose()
    }
    $br.Dispose(); $pen.Dispose(); $gp.Dispose()
  }
  elseif ($sh.type -eq "arrow") {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(99, 102, 241), 4.5)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap(6.5, 6.5, $true)
    $pen.CustomEndCap = $cap
    $g.DrawLine($pen, $sh.p1, $sh.p2)
    $cap.Dispose(); $pen.Dispose()
  }
  elseif ($sh.type -eq "pen" -and $sh.pts -and $sh.pts.Count -gt 1) {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(236, 72, 153), 4.5)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawLines($pen, $sh.pts.ToArray())
    $pen.Dispose()
  }
  elseif ($sh.type -eq "step") {
    $cx = $sh.p1.X; $cy = $sh.p1.Y
    $rc = [System.Drawing.Rectangle]::new($cx - 17, $cy - 17, 34, 34)
    $br = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(99, 102, 241))
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 2.5)
    $g.FillEllipse($br, $rc); $g.DrawEllipse($pen, $rc)
    $fnt = New-Object System.Drawing.Font("Segoe UI", 11.5, [System.Drawing.FontStyle]::Bold)
    $tBr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf  = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString([string]$sh.num, $fnt, $tBr, [System.Drawing.RectangleF]$rc, $sf)
    $fnt.Dispose(); $tBr.Dispose(); $sf.Dispose(); $br.Dispose(); $pen.Dispose()
  }
}

$script:toolBtns = @{}
function Set-PresenterTool([string]$tid) {
  if ($tid -eq "clear") {
    $script:shapes.Clear(); $script:stepNum = 1; $canvas.Invalidate(); return
  }
  if ($script:activeTool -eq $tid -and $tid -ne "cursor") { $tid = "cursor" }
  $script:activeTool = $tid

  foreach ($k in $script:toolBtns.Keys) {
    $b = $script:toolBtns[$k]
    if ($k -eq $tid) {
      $b.BackColor = [System.Drawing.Color]::FromArgb(79, 70, 229)
      $b.ForeColor = [System.Drawing.Color]::White
    } else {
      $b.BackColor = [System.Drawing.Color]::FromArgb(26, 35, 52)
      $b.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
    }
  }

  if ($tid -eq "spotlight") { $spotForm.Show(); Set-ClickThrough $spotForm } else { $spotForm.Hide() }

  $needsCatcher = $tid -in @("box", "arrow", "pen", "step", "hide")
  if ($needsCatcher) { Update-CatcherSafeRegion; $catcher.Show() } else { $catcher.Hide() }

  $canvas.BringToFront()
  if ($needsCatcher) { $catcher.BringToFront() }
  $bar.BringToFront()
  $canvas.Invalidate()
}

$catcher.Add_MouseDown({
  param($s, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) { Set-PresenterTool "cursor"; return }
  if ($e.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
  $p = [System.Windows.Forms.Cursor]::Position
  if ($script:activeTool -eq "step") {
    $script:shapes.Add(@{ type = "step"; p1 = $p; num = $script:stepNum; created = [DateTime]::UtcNow })
    $script:stepNum++; $canvas.Invalidate(); return
  }
  $script:isDrawing = $true; $script:ptStart = $p; $script:ptCurr = $p
  if ($script:activeTool -eq "pen") {
    $script:penPts = New-Object System.Collections.Generic.List[System.Drawing.Point]
    $script:penPts.Add($p)
  }
})

$catcher.Add_MouseMove({
  param($s, $e)
  if (-not $script:isDrawing) { return }
  $p = [System.Windows.Forms.Cursor]::Position
  $script:ptCurr = $p
  if ($script:activeTool -eq "pen" -and $script:penPts) {
    $last = $script:penPts[$script:penPts.Count - 1]
    if ([Math]::Abs($p.X - $last.X) + [Math]::Abs($p.Y - $last.Y) -ge 3) { $script:penPts.Add($p) }
  }
  $canvas.Invalidate()
})

$catcher.Add_MouseUp({
  param($s, $e)
  if (-not $script:isDrawing) { return }
  $script:isDrawing = $false
  $p = [System.Windows.Forms.Cursor]::Position
  $script:shapes.Add(@{ type = $script:activeTool; p1 = $script:ptStart; p2 = $p; pts = $script:penPts; created = [DateTime]::UtcNow })
  $script:penPts = $null; $canvas.Invalidate()
})

$drag = New-Object System.Windows.Forms.Label
$drag.Text = "GHOST BAR"; $drag.ForeColor = [System.Drawing.Color]::FromArgb(129, 140, 248)
$drag.Font = New-Object System.Drawing.Font("Segoe UI", 8.0, [System.Drawing.FontStyle]::Bold)
$drag.Left = 10; $drag.Top = 0; $drag.Width = 74; $drag.Height = 44
$drag.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$drag.Cursor = [System.Windows.Forms.Cursors]::SizeAll

$script:draggingBar = $false; $script:dragOff = [System.Drawing.Point]::Empty
$drag.Add_MouseDown({ param($s, $e) $script:draggingBar = $true; $script:dragOff = $e.Location })
$drag.Add_MouseMove({
  param($s, $e)
  if ($script:draggingBar) {
    $mp = [System.Windows.Forms.Cursor]::Position
    $bar.Left = $mp.X - $script:dragOff.X - 10; $bar.Top = $mp.Y - $script:dragOff.Y
    Update-CatcherSafeRegion
  }
})
$drag.Add_MouseUp({ $script:draggingBar = $false })
$bar.Controls.Add($drag)

$defs = @(
  @{ id = "cursor";    txt = "Cursor"; w = 58 },
  @{ id = "spotlight"; txt = "Spot";   w = 54 },
  @{ id = "box";       txt = "Box";    w = 50 },
  @{ id = "arrow";     txt = "Arrow";  w = 58 },
  @{ id = "pen";       txt = "Pen";    w = 50 },
  @{ id = "step";      txt = "1-2-3";  w = 56 },
  @{ id = "laser";     txt = "Laser";  w = 56 },
  @{ id = "hide";      txt = "Hide";   w = 54 },
  @{ id = "clear";     txt = "Clear";  w = 54 }
)

$cx = 88
foreach ($d in $defs) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $d.txt; $b.Tag = $d.id
  $b.Left = $cx; $b.Top = 7; $b.Width = $d.w; $b.Height = 30
  $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $b.FlatAppearance.BorderSize = 1
  $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
  $b.Font = New-Object System.Drawing.Font("Segoe UI", 8.2, [System.Drawing.FontStyle]::Bold)
  $b.Cursor = [System.Windows.Forms.Cursors]::Hand
  $b.Add_Click({ param($sender, $ev) Set-PresenterTool ([string]$sender.Tag) })
  $bar.Controls.Add($b)
  $script:toolBtns[$d.id] = $b
  $cx += ($d.w + 5)
}

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "X"; $btnClose.Left = $cx + 2; $btnClose.Top = 7; $btnClose.Width = 30; $btnClose.Height = 30
$btnClose.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat; $btnClose.FlatAppearance.BorderSize = 0
$btnClose.BackColor = [System.Drawing.Color]::FromArgb(153, 27, 27); $btnClose.ForeColor = [System.Drawing.Color]::White
$btnClose.Font = New-Object System.Drawing.Font("Segoe UI", 8.2, [System.Drawing.FontStyle]::Bold)
$btnClose.Add_Click({ $spotForm.Close(); $catcher.Close(); $canvas.Close(); $bar.Close() })
$bar.Controls.Add($btnClose)

$bar.Width = $cx + 42
$bar.Left  = [Math]::Max(16, [int](($screenW - $bar.Width) / 2))

$canvas.Show(); Set-ClickThrough $canvas
$bar.Show(); Set-InvisibleInCapture $bar
Set-PresenterTool "cursor"

$tick = New-Object System.Windows.Forms.Timer
$tick.Interval = 24
$script:lastMp = [System.Drawing.Point]::Empty
$tick.Add_Tick({
  $mp = [System.Windows.Forms.Cursor]::Position
  if ($script:activeTool -eq "spotlight") {
    $full = New-Object System.Drawing.Region([System.Drawing.Rectangle]::new(0, 0, $screenW, $screenH))
    $gpHole = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect $gpHole ([System.Drawing.Rectangle]::new($mp.X - 150, $mp.Y - 92, 300, 184)) 22
    $full.Exclude($gpHole)
    $spotForm.Region = $full
    $gpHole.Dispose()
    $canvas.Invalidate()
  }
  elseif ($script:activeTool -eq "laser" -and $mp -ne $script:lastMp) {
    $canvas.Invalidate()
  }
  elseif ($script:shapes.Count -gt 0) {
    foreach ($sh in $script:shapes) {
      if ($sh.type -eq "pen" -and ([DateTime]::UtcNow - $sh.created).TotalSeconds -gt 3.8) {
        $canvas.Invalidate(); break
      }
    }
  }
  $script:lastMp = $mp
})
$tick.Start()

[System.Windows.Forms.Application]::Run($bar)
