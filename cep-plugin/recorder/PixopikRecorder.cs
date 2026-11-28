using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class PixopikRecorderApp : Form {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
  [DllImport("user32.dll")] public static extern bool ReleaseCapture();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  string recRoot, ffmpegExe, signalFile, prefsFile;
  string capMode = "fullscreen";
  int cropX = 160, cropY = 120, cropW = 1280, cropH = 720, winPid = 0;

  bool isRecording = false, isPaused = false;
  Process ffProc = null;
  Stopwatch recSw = new Stopwatch();
  Timer tickTimer = new Timer();
  string curSessDir = "";
  List<string> sampleJson = new List<string>();
  List<string> clickJson = new List<string>();
  bool wasL = false, wasR = false;

  Label lblTimer, lblSub;
  Button btnRec, btnPause;
  ComboBox cmbMode, cmbCam, cmbZoom, cmbDead, cmbPreset, cmbAspect, cmbWall, cmbWin;
  CheckBox chkSfx, chkRip, chkAutoRig, chkHideOnRec;
  Panel paneHome, paneAe;
  HollowFrameForm rectFrame = null;

  public PixopikRecorderApp(string rootDir) {
    recRoot = rootDir;
    Directory.CreateDirectory(recRoot);
    signalFile = Path.Combine(recRoot, "native_done.signal");
    prefsFile  = Path.Combine(recRoot, "studio_v2_prefs.json");
    ffmpegExe  = FindFfmpeg();

    Text = "Pixopik Screen Recorder Pro (Native v3.0)";
    Size = new Size(740, 475);
    FormBorderStyle = FormBorderStyle.FixedSingle;
    MaximizeBox = false;
    StartPosition = FormStartPosition.CenterScreen;
    BackColor = Color.FromArgb(24, 30, 42);
    ForeColor = Color.FromArgb(236, 242, 250);
    Font = new Font("Segoe UI", 9.2f);

    BuildUI();
    RegisterHotKey(Handle, 9001, 0, 0x7B); // F12 = Start / Stop
    RegisterHotKey(Handle, 9002, 4, 0x7B); // Shift + F12 = Pause / Resume
    RegisterHotKey(Handle, 9003, 0, 0x7A); // F11 = Screenshot

    tickTimer.Interval = 28;
    tickTimer.Tick += OnCaptureTick;
  }

  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0312) {
      int id = m.WParam.ToInt32();
      if (id == 9001) ToggleRecord();
      else if (id == 9002) TogglePause();
      else if (id == 9003) TakeScreenshot();
    }
    base.WndProc(ref m);
  }

  protected override void OnFormClosing(FormClosingEventArgs e) {
    if (isRecording) StopRecording();
    if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.Close();
    UnregisterHotKey(Handle, 9001); UnregisterHotKey(Handle, 9002); UnregisterHotKey(Handle, 9003);
    base.OnFormClosing(e);
  }

  void BuildUI() {
    // BANDICAM DARK TOP ACTION BAR
    Panel top = new Panel { Dock = DockStyle.Top, Height = 64, BackColor = Color.FromArgb(17, 21, 30) };
    Controls.Add(top);

    cmbMode = new ComboBox {
      Left = 14, Top = 16, Width = 225, DropDownStyle = ComboBoxStyle.DropDownList,
      BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.FromArgb(56, 189, 248),
      Font = new Font("Segoe UI", 9.8f, FontStyle.Bold), FlatStyle = FlatStyle.Flat
    };
    cmbMode.Items.AddRange(new object[] {
      "⛶  Fullscreen (Display 1)",
      "▭  Rectangle Frame (Bandicam Bar)",
      "✛  Select Area (Crosshair Drag)",
      "🗔  Specific App Window"
    });
    cmbMode.SelectedIndex = 0;
    cmbMode.SelectedIndexChanged += (s, e) => OnModeChanged();
    top.Controls.Add(cmbMode);

    Button btnDraw = MakeTopBtn("✏️ Draw", 250, 72);
    btnDraw.Click += (s, e) => SendCmdToAe("OPEN_GHOST");
    top.Controls.Add(btnDraw);

    Button btnChrome = MakeTopBtn("🧼 Chrome", 328, 82);
    btnChrome.Click += (s, e) => SendCmdToAe("OPEN_CHROME");
    top.Controls.Add(btnChrome);

    lblTimer = new Label {
      Text = "00:00:00", Left = 425, Top = 10, Width = 135, Height = 26,
      TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.White,
      Font = new Font("Consolas", 14.5f, FontStyle.Bold)
    };
    top.Controls.Add(lblTimer);

    lblSub = new Label {
      Text = "F12: REC/Stop • F11: Shot", Left = 415, Top = 36, Width = 145, Height = 18,
      TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.FromArgb(56, 189, 248),
      Font = new Font("Segoe UI", 7.8f, FontStyle.Bold)
    };
    top.Controls.Add(lblSub);

    btnPause = MakeTopBtn("⏸", 568, 40);
    btnPause.Click += (s, e) => TogglePause();
    top.Controls.Add(btnPause);

    btnRec = new Button {
      Text = "● REC", Left = 614, Top = 10, Width = 64, Height = 44,
      FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(225, 29, 72), ForeColor = Color.White,
      Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), Cursor = Cursors.Hand
    };
    btnRec.FlatAppearance.BorderColor = Color.FromArgb(251, 113, 133);
    btnRec.Click += (s, e) => ToggleRecord();
    top.Controls.Add(btnRec);

    Button btnShot = MakeTopBtn("📷", 684, 38);
    btnShot.Click += (s, e) => TakeScreenshot();
    top.Controls.Add(btnShot);

    // LEFT NAVIGATION RAIL
    Panel nav = new Panel { Dock = DockStyle.Left, Width = 152, BackColor = Color.FromArgb(20, 25, 35) };
    Controls.Add(nav);

    Button navHome = MakeNavBtn("🏠  Get Started", 14, true);
    Button navAe   = MakeNavBtn("🎥  Camera & AE", 56, false);
    Button navDir  = MakeNavBtn("📂  Output Folder", 98, false);
    navHome.Click += (s, e) => { paneHome.Visible = true; paneAe.Visible = false; };
    navAe.Click   += (s, e) => { paneHome.Visible = false; paneAe.Visible = true; };
    navDir.Click  += (s, e) => Process.Start("explorer.exe", recRoot);
    nav.Controls.AddRange(new Control[] { navHome, navAe, navDir });

    chkHideOnRec = new CheckBox {
      Text = "Minimize on REC", Checked = true, Left = 14, Top = 330, Width = 130,
      ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 8.5f)
    };
    nav.Controls.Add(chkHideOnRec);

    // FOOTER STATUS
    Label footer = new Label {
      Dock = DockStyle.Bottom, Height = 26, BackColor = Color.FromArgb(15, 19, 27),
      ForeColor = Color.FromArgb(148, 163, 184), TextAlign = ContentAlignment.MiddleLeft,
      Text = "  100% Native Pixopik Engine • 0% Watermark • Unlimited 60 FPS • F12 Global Hotkey"
    };
    Controls.Add(footer);

    // PANE 1: GET STARTED (4 BANDICAM MODE CARDS + TARGET STRIP)
    paneHome = new Panel { Left = 160, Top = 72, Width = 560, Height = 335 };
    Controls.Add(paneHome);

    paneHome.Controls.Add(MakeModeCard("✛ Select Area", "Drag crosshair box", 6, 6, () => { cmbMode.SelectedIndex = 2; PickCrosshairArea(); }));
    paneHome.Controls.Add(MakeModeCard("▭ Rectangle Bar", "Floating Bandicam frame", 144, 6, () => { cmbMode.SelectedIndex = 1; ShowHollowFrame(); }));
    paneHome.Controls.Add(MakeModeCard("⛶ Fullscreen", "Entire monitor 60 FPS", 282, 6, () => { cmbMode.SelectedIndex = 0; }));
    paneHome.Controls.Add(MakeModeCard("🗔 App Window", "Lock specific window", 420, 6, () => { cmbMode.SelectedIndex = 3; RefreshWindows(); }));

    Panel targetBox = new Panel { Left = 6, Top = 128, Width = 546, Height = 86, BackColor = Color.FromArgb(18, 23, 33) };
    paneHome.Controls.Add(targetBox);
    targetBox.Controls.Add(new Label { Text = "TARGET WINDOW (For App Window Mode):", Left = 12, Top = 10, Width = 280, ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 8.2f, FontStyle.Bold) });
    cmbWin = new ComboBox { Left = 12, Top = 32, Width = 415, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White };
    targetBox.Controls.Add(cmbWin);
    Button btnRefWin = new Button { Text = "↻ Refresh", Left = 435, Top = 31, Width = 96, Height = 28, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(37, 99, 235), ForeColor = Color.White };
    btnRefWin.Click += (s, e) => RefreshWindows();
    targetBox.Controls.Add(btnRefWin);

    Panel camQuick = new Panel { Left = 6, Top = 224, Width = 546, Height = 96, BackColor = Color.FromArgb(18, 23, 33) };
    paneHome.Controls.Add(camQuick);
    camQuick.Controls.Add(new Label { Text = "AFTER EFFECTS AUTO-RIG & ZERO-SHAKE CAMERA:", Left = 12, Top = 10, Width = 340, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 8.5f, FontStyle.Bold) });

    cmbCam = MakeCombo(new[] { "🎥 Pro Dolly Travel (65% Safe-Box, Zero Shake)", "🎯 Classic Click Zoom In / Out", "📌 Static Locked Camera (0% Move)" }, 0, 12, 34, 300);
    cmbZoom = MakeCombo(new[] { "135% Gentle", "150% Balanced", "175% Close-Up" }, 1, 322, 34, 115);
    chkAutoRig = new CheckBox { Text = "⚡ Auto-Rig AE", Checked = true, Left = 446, Top = 36, Width = 96, ForeColor = Color.White };
    chkSfx = new CheckBox { Text = "🔊 Bandicam Click SFX", Checked = true, Left = 14, Top = 66, Width = 170, ForeColor = Color.FromArgb(203, 213, 225) };
    chkRip = new CheckBox { Text = "💫 Click Ripples", Checked = true, Left = 200, Top = 66, Width = 140, ForeColor = Color.FromArgb(203, 213, 225) };
    camQuick.Controls.AddRange(new Control[] { cmbCam, cmbZoom, chkAutoRig, chkSfx, chkRip });

    // PANE 2: CAMERA & AE SETTINGS
    paneAe = new Panel { Left = 160, Top = 72, Width = 560, Height = 335, Visible = false };
    Controls.Add(paneAe);
    paneAe.Controls.Add(new Label { Text = "ANTI-SHAKE SAFE-ZONE & STUDIO PRESETS", Left = 8, Top = 8, Width = 350, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) });
    paneAe.Controls.Add(new Label { Text = "Anti-Shake Safe-Box:", Left = 8, Top = 42, Width = 180 });
    cmbDead = MakeCombo(new[] { "🛡️ Strict 65% Safe-Box (No Drift)", "⚖️ Medium 45% Safe-Box", "🎯 Pan Every Click" }, 0, 8, 64, 255);
    paneAe.Controls.Add(cmbDead);

    paneAe.Controls.Add(new Label { Text = "Layout Style:", Left = 280, Top = 42, Width = 180 });
    cmbPreset = MakeCombo(new[] { "🎓 YouTube Tutorial (95% Big Screen)", "🚀 SaaS Promo (84% macOS Glass)" }, 0, 280, 64, 265);
    paneAe.Controls.Add(cmbPreset);

    paneAe.Controls.Add(new Label { Text = "Video Aspect Ratio:", Left = 8, Top = 110, Width = 180 });
    cmbAspect = MakeCombo(new[] { "16:9 YouTube (1920x1080)", "9:16 Vertical Shorts", "1:1 Square" }, 0, 8, 132, 255);
    paneAe.Controls.Add(cmbAspect);

    paneAe.Controls.Add(new Label { Text = "Studio Backdrop:", Left = 280, Top = 110, Width = 180 });
    cmbWall = MakeCombo(new[] { "🖤 Dark Carbon", "🌌 Cosmic Indigo", "🌊 Ocean Breeze", "🔥 Sunset Coral" }, 0, 280, 132, 265);
    paneAe.Controls.Add(cmbWall);

    RefreshWindows();
  }

  Button MakeTopBtn(string txt, int x, int w) {
    var b = new Button { Text = txt, Left = x, Top = 14, Width = w, Height = 36, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    b.FlatAppearance.BorderColor = Color.FromArgb(51, 65, 85);
    return b;
  }

  Button MakeNavBtn(string txt, int y, bool active) {
    var b = new Button { Text = txt, Left = 8, Top = y, Width = 136, Height = 36, FlatStyle = FlatStyle.Flat, TextAlign = ContentAlignment.MiddleLeft, BackColor = active ? Color.FromArgb(37, 50, 72) : Color.Transparent, ForeColor = active ? Color.FromArgb(56, 189, 248) : Color.FromArgb(180, 192, 210), Cursor = Cursors.Hand };
    b.FlatAppearance.BorderSize = 0;
    return b;
  }

  ComboBox MakeCombo(string[] items, int sel, int x, int y, int w) {
    var c = new ComboBox { Left = x, Top = y, Width = w, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
    c.Items.AddRange(items); c.SelectedIndex = sel;
    return c;
  }

  Panel MakeModeCard(string title, string sub, int x, int y, Action onClick) {
    var p = new Panel { Left = x, Top = y, Width = 130, Height = 110, BackColor = Color.FromArgb(34, 43, 60), Cursor = Cursors.Hand };
    var l1 = new Label { Text = title, Left = 6, Top = 28, Width = 118, Height = 26, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.White, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), Cursor = Cursors.Hand };
    var l2 = new Label { Text = sub, Left = 6, Top = 58, Width = 118, Height = 32, TextAlign = ContentAlignment.TopCenter, ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 8.0f), Cursor = Cursors.Hand };
    EventHandler h = (s, e) => onClick();
    p.Click += h; l1.Click += h; l2.Click += h;
    p.Controls.AddRange(new Control[] { l1, l2 });
    return p;
  }

  void SendCmdToAe(string cmd) {
    try { File.WriteAllText(Path.Combine(recRoot, "native_cmd.txt"), cmd, Encoding.UTF8); } catch {}
  }

  void RefreshWindows() {
    cmbWin.Items.Clear();
    foreach (var p in Process.GetProcesses()) {
      try {
        if (!string.IsNullOrWhiteSpace(p.MainWindowTitle) && !p.MainWindowTitle.Contains("Pixopik Screen Recorder")) {
          cmbWin.Items.Add(p.Id + " | " + p.MainWindowTitle);
        }
      } catch {}
    }
    if (cmbWin.Items.Count > 0) cmbWin.SelectedIndex = 0;
  }

  void OnModeChanged() {
    int idx = cmbMode.SelectedIndex;
    if (idx == 0) { capMode = "fullscreen"; if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.Hide(); }
    else if (idx == 1) { capMode = "rectangle"; ShowHollowFrame(); }
    else if (idx == 2) { capMode = "select_area"; if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.Hide(); }
    else if (idx == 3) { capMode = "specific_window"; if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.Hide(); RefreshWindows(); }
  }

  void ShowHollowFrame() {
    if (rectFrame == null || rectFrame.IsDisposed) {
      rectFrame = new HollowFrameForm(this);
    }
    rectFrame.Show();
  }

  public void UpdateRectFromFrame(Rectangle r) {
    cropX = Math.Max(0, r.X); cropY = Math.Max(0, r.Y);
    cropW = (r.Width / 2) * 2; cropH = (r.Height / 2) * 2;
    lblSub.Text = cropW + "x" + cropH + " Frame Ready";
  }

  void PickCrosshairArea() {
    Hide();
    using (var ov = new Form { FormBorderStyle = FormBorderStyle.None, Bounds = Screen.PrimaryScreen.Bounds, TopMost = true, BackColor = Color.Black, Opacity = 0.45, Cursor = Cursors.Cross }) {
      Point st = Point.Empty; Rectangle rc = Rectangle.Empty; bool drag = false;
      ov.MouseDown += (s, e) => { drag = true; st = e.Location; };
      ov.MouseMove += (s, e) => { if (drag) { rc = new Rectangle(Math.Min(st.X, e.X), Math.Min(st.Y, e.Y), Math.Abs(e.X - st.X), Math.Abs(e.Y - st.Y)); ov.Invalidate(); } };
      ov.MouseUp += (s, e) => { drag = false; if (rc.Width >= 80 && rc.Height >= 80) { cropX = rc.X; cropY = rc.Y; cropW = (rc.Width / 2) * 2; cropH = (rc.Height / 2) * 2; } ov.Close(); };
      ov.Paint += (s, e) => { if (rc.Width > 4) e.Graphics.DrawRectangle(new Pen(Color.FromArgb(244, 63, 94), 3), rc); };
      ov.ShowDialog();
    }
    Show();
    lblSub.Text = "Area: " + cropW + "x" + cropH;
  }

  public void ToggleRecord() {
    if (!isRecording) StartRecording();
    else StopRecording();
  }

  void TogglePause() {
    if (!isRecording) return;
    isPaused = !isPaused;
    lblSub.Text = isPaused ? "⏸ PAUSED (Shift+F12)" : "● RECORDING 60 FPS";
  }

  void TakeScreenshot() {
    try {
      string dir = Path.Combine(recRoot, "Screenshots");
      Directory.CreateDirectory(dir);
      var b = Screen.PrimaryScreen.Bounds;
      using (var bmp = new Bitmap(b.Width, b.Height))
      using (var g = Graphics.FromImage(bmp)) {
        g.CopyFromScreen(0, 0, 0, 0, bmp.Size);
        bmp.Save(Path.Combine(dir, "shot_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".png"));
      }
      PlayWav(@"C:\Program Files\Bandicam\data\camera.wav");
      lblSub.Text = "📷 Screenshot Saved!";
    } catch {}
  }

  void PlayWav(string p) {
    try { if (File.Exists(p)) new System.Media.SoundPlayer(p).Play(); } catch {}
  }

  static string FindFfmpeg() {
    string wg = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\WinGet\Packages");
    if (Directory.Exists(wg)) {
      var f = Directory.GetFiles(wg, "ffmpeg.exe", SearchOption.AllDirectories);
      if (f.Length > 0) return f[0];
    }
    foreach (var c in new[] { @"C:\ffmpeg\bin\ffmpeg.exe", @"C:\Program Files\ffmpeg\bin\ffmpeg.exe" }) if (File.Exists(c)) return c;
    return "ffmpeg";
  }

  void StartRecording() {
    Rectangle sb = Screen.PrimaryScreen.Bounds;
    int rx = 0, ry = 0, rw = sb.Width, rh = sb.Height;
    bool useCrop = false;

    if (capMode == "rectangle" && rectFrame != null && !rectFrame.IsDisposed) {
      Rectangle fr = rectFrame.GetInnerScreenRect();
      rx = fr.X; ry = fr.Y; rw = fr.Width; rh = fr.Height; useCrop = true;
      rectFrame.SetRecState(true);
    } else if (capMode == "select_area") {
      rx = cropX; ry = cropY; rw = cropW; rh = cropH; useCrop = true;
    } else if (capMode == "specific_window" && cmbWin.SelectedItem != null) {
      int pid = int.Parse(cmbWin.SelectedItem.ToString().Split('|')[0].Trim());
      try {
        var wp = Process.GetProcessById(pid);
        SetForegroundWindow(wp.MainWindowHandle);
        RECT wr;
        if (GetWindowRect(wp.MainWindowHandle, out wr)) {
          rx = Math.Max(0, wr.Left + 7); ry = Math.Max(0, wr.Top);
          rw = (wr.Right - wr.Left) - 14; rh = (wr.Bottom - wr.Top) - 7; useCrop = true;
        }
      } catch {}
    }

    if (useCrop) {
      rx = Math.Max(0, Math.Min(sb.Width - 80, rx));
      ry = Math.Max(0, Math.Min(sb.Height - 80, ry));
      rw = Math.Min(sb.Width - rx, Math.Max(80, (rw / 2) * 2));
      rh = Math.Min(sb.Height - ry, Math.Max(80, (rh / 2) * 2));
    } else { rx = 0; ry = 0; rw = (sb.Width / 2) * 2; rh = (sb.Height / 2) * 2; }
    cropX = rx; cropY = ry; cropW = rw; cropH = rh;

    SavePrefsJson();
    curSessDir = Path.Combine(recRoot, "rec_" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffZ"));
    Directory.CreateDirectory(curSessDir);
    string mp4 = Path.Combine(curSessDir, "screen.mp4");

    if (chkHideOnRec.Checked && capMode != "rectangle") WindowState = FormWindowState.Minimized;
    PlayWav(@"C:\Program Files\Bandicam\data\start.wav");

    string vf = useCrop ? string.Format("crop={0}:{1}:{2}:{3},scale=trunc(iw/2)*2:trunc(ih/2)*2", rw, rh, rx, ry) : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    var psi = new ProcessStartInfo {
      FileName = ffmpegExe,
      Arguments = string.Format("-y -loglevel error -f gdigrab -framerate 60 -draw_mouse 0 -i desktop -an -vf \"{0}\" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -movflags +faststart \"{1}\"", vf, mp4),
      RedirectStandardInput = true, UseShellExecute = false, CreateNoWindow = true
    };
    ffProc = Process.Start(psi);

    sampleJson.Clear(); clickJson.Clear();
    wasL = false; wasR = false; isPaused = false; isRecording = true;
    btnRec.Text = "■ STOP"; btnRec.BackColor = Color.FromArgb(185, 28, 28);
    lblSub.Text = "● REC (" + rw + "x" + rh + ") • F12 Stop";
    recSw.Restart();
    tickTimer.Start();
  }

  void OnCaptureTick(object sender, EventArgs e) {
    if (!isRecording || isPaused) return;
    double t = Math.Round(recSw.Elapsed.TotalSeconds, 3);
    TimeSpan ts = TimeSpan.FromSeconds(t);
    lblTimer.Text = string.Format("{0:D2}:{1:D2}:{2:D2}", (int)ts.TotalHours, ts.Minutes, ts.Seconds);
    if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.UpdateTimerText(lblTimer.Text);

    Point p = Cursor.Position;
    int rx = Math.Max(0, Math.Min(cropW, p.X - cropX));
    int ry = Math.Max(0, Math.Min(cropH, p.Y - cropY));
    bool inside = (p.X >= cropX && p.X <= cropX + cropW && p.Y >= cropY && p.Y <= cropY + cropH);

    sampleJson.Add(string.Format("{{\"t\":{0},\"x\":{1},\"y\":{2}}}", t.ToString(System.Globalization.CultureInfo.InvariantCulture), rx, ry));
    bool lDown = (Control.MouseButtons & MouseButtons.Left) != 0;
    bool rDown = (Control.MouseButtons & MouseButtons.Right) != 0;
    if (inside) {
      if (lDown && !wasL) clickJson.Add(string.Format("{{\"t\":{0},\"x\":{1},\"y\":{2},\"button\":\"left\"}}", t.ToString(System.Globalization.CultureInfo.InvariantCulture), rx, ry));
      if (rDown && !wasR) clickJson.Add(string.Format("{{\"t\":{0},\"x\":{1},\"y\":{2},\"button\":\"right\"}}", t.ToString(System.Globalization.CultureInfo.InvariantCulture), rx, ry));
    }
    wasL = lDown; wasR = rDown;
  }

  void StopRecording() {
    tickTimer.Stop();
    isRecording = false;
    recSw.Stop();
    PlayWav(@"C:\Program Files\Bandicam\data\stop.wav");

    if (ffProc != null && !ffProc.HasExited) {
      try { ffProc.StandardInput.WriteLine("q"); ffProc.StandardInput.Flush(); ffProc.WaitForExit(4500); } catch {}
      if (!ffProc.HasExited) { try { ffProc.Kill(); } catch {} }
    }

    string durStr = Math.Round(recSw.Elapsed.TotalSeconds, 3).ToString(System.Globalization.CultureInfo.InvariantCulture);
    string mot = "{\"version\":\"3.0.0\",\"fps\":60,\"screenWidth\":" + cropW + ",\"screenHeight\":" + cropH + ",\"duration\":" + durStr + ",\"samples\":[" + string.Join(",", sampleJson) + "],\"clicks\":[" + string.Join(",", clickJson) + "]}";
    File.WriteAllText(Path.Combine(curSessDir, "motion.json"), mot, new UTF8Encoding(false));
    File.WriteAllText(Path.Combine(curSessDir, "done.signal"), "OK", new UTF8Encoding(false));
    if (chkAutoRig.Checked) File.WriteAllText(signalFile, curSessDir, new UTF8Encoding(false));

    btnRec.Text = "● REC"; btnRec.BackColor = Color.FromArgb(225, 29, 72);
    lblSub.Text = "✅ Saved & Sent to AE!";
    if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.SetRecState(false);
    WindowState = FormWindowState.Normal;
  }

  void SavePrefsJson() {
    string[] camVals = { "dolly_steady", "click_bounce", "static_lock" };
    int[] zoomVals = { 135, 150, 175 };
    string[] deadVals = { "0.65", "0.45", "0.18" };
    string[] presetVals = { "youtube_tutorial", "saas_promo" };
    string[] aspectVals = { "youtube_16_9", "shorts_9_16", "square_1_1" };
    string[] wallVals = { "dark_carbon", "cosmic_indigo", "ocean_breeze", "sunset_saas" };

    string json = string.Format(
      "{{\"editMode\":\"{0}\",\"aspectPreset\":\"{1}\",\"cameraMode\":\"{2}\",\"zoomPercent\":{3},\"deadZoneRatio\":{4},\"cursorSmooth\":\"high\",\"wallpaper\":\"{5}\",\"frameStyle\":\"{6}\",\"clickSfx\":{7},\"clickRipples\":{8},\"autoRig\":{9},\"autoZoom\":{10}}}",
      presetVals[cmbPreset.SelectedIndex], aspectVals[cmbAspect.SelectedIndex], camVals[cmbCam.SelectedIndex],
      zoomVals[cmbZoom.SelectedIndex], deadVals[cmbDead.SelectedIndex], wallVals[cmbWall.SelectedIndex],
      cmbPreset.SelectedIndex == 0 ? "minimal_rounded" : "macos_glass",
      chkSfx.Checked ? "true" : "false", chkRip.Checked ? "true" : "false",
      chkAutoRig.Checked ? "true" : "false", cmbCam.SelectedIndex != 2 ? "true" : "false"
    );
    File.WriteAllText(prefsFile, json, new UTF8Encoding(false));
  }

  [STAThread]
  public static void Main(string[] args) {
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    string root = args.Length > 0 ? args[0] : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "PixopikRecordings");
    Application.Run(new PixopikRecorderApp(root));
  }
}

// ============================================================================
// BANDICAM-STYLE FLOATING HOLLOW RECTANGLE FRAME WINDOW (Invisible in MP4!)
// ============================================================================
public class HollowFrameForm : Form {
  PixopikRecorderApp parentApp;
  Panel topBar;
  Label lblDim;
  Button btnRecBar;
  Color borderCol = Color.FromArgb(56, 189, 248);

  public HollowFrameForm(PixopikRecorderApp app) {
    parentApp = app;
    Text = "Pixopik Recording Frame";
    FormBorderStyle = FormBorderStyle.None;
    StartPosition = FormStartPosition.CenterScreen;
    Size = new Size(1288, 760);
    TopMost = true;
    BackColor = Color.Magenta;
    TransparencyKey = Color.Magenta;

    topBar = new Panel { Dock = DockStyle.Top, Height = 36, BackColor = Color.FromArgb(17, 21, 30), Cursor = Cursors.SizeAll };
    topBar.MouseDown += (s, e) => { PixopikRecorderApp.ReleaseCapture(); PixopikRecorderApp.SendMessage(Handle, 0xA1, 0x2, 0); };
    Controls.Add(topBar);

    ComboBox cmbSz = new ComboBox { Left = 8, Top = 6, Width = 135, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White };
    cmbSz.Items.AddRange(new object[] { "1280 x 720 (HD)", "1600 x 900", "1080 x 1920 (Short)", "1080 x 1080 (1:1)" });
    cmbSz.SelectedIndex = 0;
    cmbSz.SelectedIndexChanged += (s, e) => {
      int[][] sz = { new[]{1280,720}, new[]{1600,900}, new[]{608,1080}, new[]{900,900} };
      var d = sz[cmbSz.SelectedIndex];
      Size = new Size(d[0] + 8, d[1] + 40);
      Invalidate();
    };
    topBar.Controls.Add(cmbSz);

    lblDim = new Label { Text = "1280 x 720 • Drag Bar to Move • F12 REC", Left = 152, Top = 9, Width = 280, ForeColor = Color.FromArgb(165, 243, 252), Font = new Font("Segoe UI", 8.8f, FontStyle.Bold) };
    lblDim.MouseDown += (s, e) => { PixopikRecorderApp.ReleaseCapture(); PixopikRecorderApp.SendMessage(Handle, 0xA1, 0x2, 0); };
    topBar.Controls.Add(lblDim);

    btnRecBar = new Button { Text = "● REC (F12)", Left = Width - 140, Top = 4, Width = 96, Height = 28, Anchor = AnchorStyles.Top | AnchorStyles.Right, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(225, 29, 72), ForeColor = Color.White, Font = new Font("Segoe UI", 8.5f, FontStyle.Bold) };
    btnRecBar.Click += (s, e) => parentApp.ToggleRecord();
    topBar.Controls.Add(btnRecBar);

    Button btnX = new Button { Text = "✕", Left = Width - 38, Top = 4, Width = 30, Height = 28, Anchor = AnchorStyles.Top | AnchorStyles.Right, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(51, 65, 85), ForeColor = Color.White };
    btnX.Click += (s, e) => Hide();
    topBar.Controls.Add(btnX);

    Shown += (s, e) => { try { PixopikRecorderApp.SetWindowDisplayAffinity(Handle, 0x00000011); } catch {} };
    Move += (s, e) => parentApp.UpdateRectFromFrame(GetInnerScreenRect());
    Resize += (s, e) => { parentApp.UpdateRectFromFrame(GetInnerScreenRect()); Invalidate(); };
  }

  public Rectangle GetInnerScreenRect() {
    Point tl = PointToScreen(new Point(4, 36));
    return new Rectangle(tl.X, tl.Y, Width - 8, Height - 40);
  }

  public void SetRecState(bool rec) {
    borderCol = rec ? Color.FromArgb(239, 68, 68) : Color.FromArgb(56, 189, 248);
    btnRecBar.Text = rec ? "■ STOP" : "● REC (F12)";
    Invalidate();
  }

  public void UpdateTimerText(string t) { lblDim.Text = "● REC " + t + "  (" + (Width - 8) + "x" + (Height - 40) + ")"; }

  protected override void OnPaint(PaintEventArgs e) {
    using (var pen = new Pen(borderCol, 4)) {
      e.Graphics.DrawRectangle(pen, 2, 36, Width - 4, Height - 38);
    }
  }
}
