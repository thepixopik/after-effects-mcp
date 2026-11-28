using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Globalization;

public class PixopikRecorderApp : Form {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
  [DllImport("user32.dll")] public static extern bool ReleaseCapture();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public string recRoot, ffmpegExe, signalFile, prefsFile, bdDataDir;
  string capMode = "fullscreen";
  int cropX = 160, cropY = 120, cropW = 1280, cropH = 720;
  string selectedBgPath = "";

  bool isRecording = false, isPaused = false, hasDdaGrab = false;
  Process ffProc = null;
  Stopwatch recSw = new Stopwatch();
  Timer tickTimer = new Timer();
  string curSessDir = "", curMp4Path = "";
  List<string> sampleJson = new List<string>();
  List<string> clickJson = new List<string>();
  bool wasL = false, wasR = false;

  Label lblTimer, lblSub, lblFooter;
  Button btnRec, btnPause;
  ComboBox cmbMode, cmbCam, cmbZoom, cmbDead, cmbPreset, cmbAspect, cmbBg, cmbWin;
  CheckBox chkSfx, chkRip, chkAutoRig, chkHideOnRec;
  Panel paneHome, paneVideos, paneImages, paneAe;
  ListBox lstVideos, lstImages;
  HollowFrameForm rectFrame = null;
  MiniGhostBar miniBar = null;

  public PixopikRecorderApp() {
    recRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Videos", "PixopikRecordings");
    Directory.CreateDirectory(recRoot);
    Directory.CreateDirectory(Path.Combine(recRoot, "Screenshots"));
    signalFile = Path.Combine(recRoot, "native_done.signal");
    prefsFile  = Path.Combine(recRoot, "studio_v2_prefs.json");
    bdDataDir  = Directory.Exists(@"C:\Program Files\Bandicam\data") ? @"C:\Program Files\Bandicam\data" : @"C:\Program Files (x86)\Bandicam\data";
    ffmpegExe  = FindFfmpeg();
    DetectDdaGrab();

    Text = "Pixopik Screen Recorder Pro v3.1 (Bandicam Engine)";
    ClientSize = new Size(860, 520);
    MinimumSize = new Size(780, 480);
    StartPosition = FormStartPosition.CenterScreen;
    BackColor = Color.FromArgb(24, 30, 42);
    ForeColor = Color.FromArgb(236, 242, 250);
    Font = new Font("Segoe UI", 9.0f);

    BuildBandicamUI();
    RegisterHotKey(Handle, 9001, 0, 0x7B); // F12 = REC / STOP
    RegisterHotKey(Handle, 9002, 4, 0x7B); // Shift+F12 = PAUSE
    RegisterHotKey(Handle, 9003, 0, 0x7A); // F11 = SCREENSHOT

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
    if (miniBar != null && !miniBar.IsDisposed) miniBar.Close();
    UnregisterHotKey(Handle, 9001); UnregisterHotKey(Handle, 9002); UnregisterHotKey(Handle, 9003);
    base.OnFormClosing(e);
  }

  void DetectDdaGrab() {
    try {
      var psi = new ProcessStartInfo { FileName = ffmpegExe, Arguments = "-hide_banner -filters", RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
      using (var p = Process.Start(psi)) {
        string o = p.StandardOutput.ReadToEnd();
        p.WaitForExit(2000);
        hasDdaGrab = o.Contains("ddagrab");
      }
    } catch { hasDdaGrab = false; }
  }

  void BuildBandicamUI() {
    // 1. RESPONSIVE BANDICAM TOP ACTION BAR (Dock-based: NEVER clips on any DPI!)
    Panel top = new Panel { Dock = DockStyle.Top, Height = 68, BackColor = Color.FromArgb(16, 20, 29), Padding = new Padding(12, 10, 12, 10) };

    // Right-docked REC / Pause / Shot / Timer cluster (Guaranteed visible!)
    FlowLayoutPanel rightCluster = new FlowLayoutPanel {
      Dock = DockStyle.Right, AutoSize = true, WrapContents = false,
      FlowDirection = FlowDirection.LeftToRight, BackColor = Color.Transparent
    };

    Panel timerStack = new Panel { Width = 165, Height = 48 };
    lblTimer = new Label { Text = "00:00:00", Dock = DockStyle.Top, Height = 28, TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.White, Font = new Font("Consolas", 14.0f, FontStyle.Bold) };
    lblSub   = new Label { Text = "F12: REC/Stop • F11: Shot", Dock = DockStyle.Bottom, Height = 18, TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 7.8f, FontStyle.Bold) };
    timerStack.Controls.Add(lblTimer); timerStack.Controls.Add(lblSub);

    btnPause = new Button { Text = "⏸", Width = 44, Height = 44, Margin = new Padding(6, 2, 4, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnPause.FlatAppearance.BorderColor = Color.FromArgb(51, 65, 85);
    btnPause.Click += (s, e) => TogglePause();

    btnRec = new Button {
      Text = "● REC", Width = 88, Height = 44, Margin = new Padding(4, 2, 4, 0),
      FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(225, 29, 72), ForeColor = Color.White,
      Font = new Font("Segoe UI", 10.0f, FontStyle.Bold), Cursor = Cursors.Hand
    };
    btnRec.FlatAppearance.BorderColor = Color.FromArgb(253, 164, 175);
    btnRec.Click += (s, e) => ToggleRecord();

    Button btnShot = new Button { Text = "📷", Width = 44, Height = 44, Margin = new Padding(4, 2, 0, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnShot.FlatAppearance.BorderColor = Color.FromArgb(51, 65, 85);
    btnShot.Click += (s, e) => TakeScreenshot();

    rightCluster.Controls.AddRange(new Control[] { timerStack, btnPause, btnRec, btnShot });

    // Left-docked Mode Selector + Quick Tools
    FlowLayoutPanel leftCluster = new FlowLayoutPanel {
      Dock = DockStyle.Left, AutoSize = true, WrapContents = false,
      FlowDirection = FlowDirection.LeftToRight, BackColor = Color.Transparent
    };

    cmbMode = new ComboBox {
      Width = 220, Margin = new Padding(0, 8, 8, 0), DropDownStyle = ComboBoxStyle.DropDownList,
      BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.FromArgb(56, 189, 248),
      Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), FlatStyle = FlatStyle.Flat
    };
    cmbMode.Items.AddRange(new object[] {
      "⛶  Fullscreen (Display 1)",
      "▭  Rectangle on a screen",
      "✛  Select a recording area",
      "🗔  Specific window",
      "🖱️  Around mouse (1280x720)"
    });
    cmbMode.SelectedIndex = 0;
    cmbMode.SelectedIndexChanged += (s, e) => OnModeChanged();

    Button btnDraw = new Button { Text = "✏️ Draw", Width = 74, Height = 38, Margin = new Padding(2, 5, 4, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnDraw.Click += (s, e) => SendCmdToAe("OPEN_GHOST");

    Button btnChr = new Button { Text = "🧼 Chrome", Width = 84, Height = 38, Margin = new Padding(2, 5, 0, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnChr.Click += (s, e) => SendCmdToAe("OPEN_CHROME");

    leftCluster.Controls.AddRange(new Control[] { cmbMode, btnDraw, btnChr });
    top.Controls.Add(rightCluster);
    top.Controls.Add(leftCluster);

    // 2. FOOTER BAR
    lblFooter = new Label {
      Dock = DockStyle.Bottom, Height = 28, BackColor = Color.FromArgb(14, 18, 26),
      ForeColor = Color.FromArgb(148, 163, 184), TextAlign = ContentAlignment.MiddleLeft,
      Text = "  Engine: " + (hasDdaGrab ? "DXGI Desktop Duplication 60 FPS (GPU)" : "GDI 60 FPS") + "  •  Output: " + recRoot
    };

    // 3. BANDICAM LEFT SIDEBAR RAIL (Home | Videos | Images | AE & Wallpapers)
    Panel nav = new Panel { Dock = DockStyle.Left, Width = 168, BackColor = Color.FromArgb(19, 24, 34), Padding = new Padding(8, 12, 8, 12) };
    Button bHome = MakeNav("🏠  Get Started", 12);
    Button bVids = MakeNav("🎬  Videos", 54);
    Button bImgs = MakeNav("🖼️  Images", 96);
    Button bAe   = MakeNav("🎥  AE & Wallpapers", 138);
    Button bOpen = MakeNav("📂  Output Folder", 180);

    bHome.Click += (s, e) => ShowPane(paneHome);
    bVids.Click += (s, e) => { RefreshMediaLists(); ShowPane(paneVideos); };
    bImgs.Click += (s, e) => { RefreshMediaLists(); ShowPane(paneImages); };
    bAe.Click   += (s, e) => ShowPane(paneAe);
    bOpen.Click += (s, e) => Process.Start("explorer.exe", "\"" + recRoot + "\"");

    chkHideOnRec = new CheckBox { Text = "Minimize on REC", Checked = true, Dock = DockStyle.Bottom, Height = 28, ForeColor = Color.FromArgb(165, 180, 205) };
    nav.Controls.AddRange(new Control[] { bHome, bVids, bImgs, bAe, bOpen, chkHideOnRec });

    // 4. CONTENT WORKSPACE (Dock Fill)
    Panel body = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16) };

    // PANE A: GET STARTED (Bandicam 4 Visual Cards + Window Picker + Quick AE Camera)
    paneHome = new Panel { Dock = DockStyle.Fill };
    TableLayoutPanel cardsGrid = new TableLayoutPanel { Dock = DockStyle.Top, Height = 122, ColumnCount = 4, RowCount = 1 };
    for (int c = 0; c < 4; c++) cardsGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25f));
    cardsGrid.Controls.Add(MakeCard("✛ Select Area", "Drag crosshair box", () => { cmbMode.SelectedIndex = 2; PickCrosshairArea(); }), 0, 0);
    cardsGrid.Controls.Add(MakeCard("▭ Rectangle Bar", "Floating target frame", () => { cmbMode.SelectedIndex = 1; ShowHollowFrame(); }), 1, 0);
    cardsGrid.Controls.Add(MakeCard("⛶ Fullscreen", "Entire monitor 60fps", () => { cmbMode.SelectedIndex = 0; }), 2, 0);
    cardsGrid.Controls.Add(MakeCard("🖱️ Around Mouse", "Follow cursor 1280x720", () => { cmbMode.SelectedIndex = 4; }), 3, 0);

    Panel winPanel = new Panel { Dock = DockStyle.Top, Height = 82, BackColor = Color.FromArgb(18, 23, 33), Padding = new Padding(12, 8, 12, 8) };
    Label lWin = new Label { Text = "🗔 SPECIFIC WINDOW TARGET (Select Window Mode):", Dock = DockStyle.Top, Height = 20, ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 8.2f, FontStyle.Bold) };
    Panel winRow = new Panel { Dock = DockStyle.Top, Height = 34 };
    Button bRefW = new Button { Text = "↻ Refresh", Dock = DockStyle.Right, Width = 100, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(2, 132, 199), ForeColor = Color.White };
    bRefW.Click += (s, e) => RefreshWindows();
    cmbWin = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White };
    winRow.Controls.Add(cmbWin); winRow.Controls.Add(bRefW);
    winPanel.Controls.Add(winRow); winPanel.Controls.Add(lWin);

    Panel camPanel = new Panel { Dock = DockStyle.Top, Height = 112, BackColor = Color.FromArgb(18, 23, 33), Padding = new Padding(12, 10, 12, 8) };
    Label lCam = new Label { Text = "🎥 AFTER EFFECTS AUTO-RIG & ZERO-SHAKE CAMERA:", Dock = DockStyle.Top, Height = 22, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 8.6f, FontStyle.Bold) };
    FlowLayoutPanel camRow1 = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 38, WrapContents = false };
    cmbCam = MakeCombo(new[] { "🎥 Pro Dolly Travel (65% Safe-Box, Zero Shake)", "🎯 Classic Click Zoom In / Out", "📌 Static Locked Camera (0% Move)" }, 0, 310);
    cmbZoom = MakeCombo(new[] { "135% Gentle", "150% Balanced", "175% Close-Up" }, 1, 135);
    chkAutoRig = new CheckBox { Text = "⚡ Auto-Rig AE", Checked = true, AutoSize = true, Margin = new Padding(10, 6, 0, 0), ForeColor = Color.White };
    camRow1.Controls.AddRange(new Control[] { cmbCam, cmbZoom, chkAutoRig });

    FlowLayoutPanel camRow2 = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 32, WrapContents = false };
    chkSfx = new CheckBox { Text = "🔊 Bandicam Click Sounds (lclick/rclick.wav)", Checked = true, AutoSize = true, ForeColor = Color.FromArgb(203, 213, 225) };
    chkRip = new CheckBox { Text = "💫 Vector Cursor + Click Ripples", Checked = true, AutoSize = true, Margin = new Padding(18, 3, 0, 0), ForeColor = Color.FromArgb(203, 213, 225) };
    camRow2.Controls.AddRange(new Control[] { chkSfx, chkRip });
    camPanel.Controls.Add(camRow2); camPanel.Controls.Add(camRow1); camPanel.Controls.Add(lCam);

    paneHome.Controls.Add(camPanel);
    paneHome.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 10 });
    paneHome.Controls.Add(winPanel);
    paneHome.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 10 });
    paneHome.Controls.Add(cardsGrid);

    // PANE B: VIDEOS TAB (Bandicam Recorded Videos Manager!)
    paneVideos = new Panel { Dock = DockStyle.Fill, Visible = false };
    lstVideos = new ListBox { Dock = DockStyle.Fill, BackColor = Color.FromArgb(17, 21, 30), ForeColor = Color.White, Font = new Font("Consolas", 9.5f) };
    FlowLayoutPanel vidBtns = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 42 };
    Button bPlayVid = new Button { Text = "▶ Play Selected", Width = 135, Height = 34, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White };
    bPlayVid.Click += (s, e) => { if (lstVideos.SelectedItem != null) Process.Start("\"" + Path.Combine(recRoot, lstVideos.SelectedItem.ToString().Split('|')[0].Trim(), "screen.mp4") + "\""); };
    Button bRigVid = new Button { Text = "⚡ Send Selected to After Effects", Width = 225, Height = 34, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(79, 70, 229), ForeColor = Color.White };
    bRigVid.Click += (s, e) => {
      if (lstVideos.SelectedItem != null) {
        SavePrefsJson();
        string dir = Path.Combine(recRoot, lstVideos.SelectedItem.ToString().Split('|')[0].Trim());
        File.WriteAllText(signalFile, dir, new UTF8Encoding(false));
        lblSub.Text = "⚡ Sent to AE!";
      }
    };
    vidBtns.Controls.AddRange(new Control[] { bPlayVid, bRigVid });
    paneVideos.Controls.Add(lstVideos); paneVideos.Controls.Add(vidBtns);

    // PANE C: IMAGES TAB (Bandicam Screenshots Manager!)
    paneImages = new Panel { Dock = DockStyle.Fill, Visible = false };
    lstImages = new ListBox { Dock = DockStyle.Fill, BackColor = Color.FromArgb(17, 21, 30), ForeColor = Color.White, Font = new Font("Consolas", 9.5f) };
    paneImages.Controls.Add(lstImages);

    // PANE D: AE & BANDICAM 31 HD WALLPAPERS
    paneAe = new Panel { Dock = DockStyle.Fill, Visible = false };
    FlowLayoutPanel aeStack = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false };
    aeStack.Controls.Add(new Label { Text = "ANTI-SHAKE SAFE-ZONE BOX:", AutoSize = true, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 9f, FontStyle.Bold) });
    cmbDead = MakeCombo(new[] { "🛡️ Strict 65% Safe-Box (Zero Hover Drift)", "⚖️ Medium 45% Safe-Box", "🎯 Pan Every Click" }, 0, 420);
    aeStack.Controls.Add(cmbDead);

    aeStack.Controls.Add(new Label { Text = "AFTER EFFECTS LAYOUT & ASPECT:", AutoSize = true, Margin = new Padding(0, 12, 0, 0), ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 9f, FontStyle.Bold) });
    cmbPreset = MakeCombo(new[] { "🎓 YouTube Tutorial (95% Big Screen)", "🚀 SaaS Promo (84% macOS Glass)" }, 0, 420);
    cmbAspect = MakeCombo(new[] { "16:9 YouTube (1920x1080)", "9:16 Vertical Shorts (1080x1920)", "1:1 Square" }, 0, 420);
    aeStack.Controls.Add(cmbPreset); aeStack.Controls.Add(cmbAspect);

    aeStack.Controls.Add(new Label { Text = "BANDICAM HD STUDIO WALLPAPERS (bg1.jpg - bg31.jpg):", AutoSize = true, Margin = new Padding(0, 12, 0, 0), ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 9f, FontStyle.Bold) });
    cmbBg = MakeCombo(new[] { "🖤 Default Dark Carbon Gradient", "🌌 Cosmic Indigo Gradient", "🌊 Ocean Breeze Gradient", "🔥 Sunset Coral Gradient" }, 0, 420);
    if (Directory.Exists(Path.Combine(bdDataDir, "bg"))) {
      foreach (var f in Directory.GetFiles(Path.Combine(bdDataDir, "bg"), "bg*.jpg")) cmbBg.Items.Add("🖼️ Bandicam HD: " + Path.GetFileName(f));
    }
    cmbBg.SelectedIndexChanged += (s, e) => {
      string txt = cmbBg.SelectedItem.ToString();
      selectedBgPath = txt.StartsWith("🖼️") ? Path.Combine(bdDataDir, "bg", txt.Replace("🖼️ Bandicam HD: ", "").Trim()).Replace("\\", "/") : "";
    };
    aeStack.Controls.Add(cmbBg);
    paneAe.Controls.Add(aeStack);

    body.Controls.AddRange(new Control[] { paneHome, paneVideos, paneImages, paneAe });
    Controls.Add(body);
    Controls.Add(nav);
    Controls.Add(lblFooter);
    Controls.Add(top);

    RefreshWindows();
  }

  void ShowPane(Panel target) {
    paneHome.Visible = (target == paneHome);
    paneVideos.Visible = (target == paneVideos);
    paneImages.Visible = (target == paneImages);
    paneAe.Visible = (target == paneAe);
  }

  Button MakeNav(string txt, int y) {
    var b = new Button { Text = txt, Dock = DockStyle.Top, Height = 40, FlatStyle = FlatStyle.Flat, TextAlign = ContentAlignment.MiddleLeft, BackColor = Color.Transparent, ForeColor = Color.FromArgb(203, 213, 225), Cursor = Cursors.Hand };
    b.FlatAppearance.BorderSize = 0;
    return b;
  }

  ComboBox MakeCombo(string[] items, int sel, int w) {
    var c = new ComboBox { Width = w, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
    c.Items.AddRange(items); c.SelectedIndex = sel;
    return c;
  }

  Panel MakeCard(string title, string sub, Action onClick) {
    var p = new Panel { Dock = DockStyle.Fill, Margin = new Padding(5), BackColor = Color.FromArgb(33, 42, 58), Cursor = Cursors.Hand };
    var l1 = new Label { Text = title, Dock = DockStyle.Top, Height = 52, TextAlign = ContentAlignment.BottomCenter, ForeColor = Color.White, Font = new Font("Segoe UI", 10.0f, FontStyle.Bold), Cursor = Cursors.Hand };
    var l2 = new Label { Text = sub, Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopCenter, Padding = new Padding(4, 6, 4, 0), ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 8.2f), Cursor = Cursors.Hand };
    EventHandler h = (s, e) => onClick();
    p.Click += h; l1.Click += h; l2.Click += h;
    p.Controls.Add(l2); p.Controls.Add(l1);
    return p;
  }

  void SendCmdToAe(string cmd) {
    try { File.WriteAllText(Path.Combine(recRoot, "native_cmd.txt"), cmd, new UTF8Encoding(false)); } catch {}
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

  void RefreshMediaLists() {
    lstVideos.Items.Clear();
    var dirs = Directory.GetDirectories(recRoot, "rec_*");
    Array.Sort(dirs); Array.Reverse(dirs);
    foreach (var d in dirs) {
      string mp4 = Path.Combine(d, "screen.mp4");
      if (File.Exists(mp4)) {
        var fi = new FileInfo(mp4);
        lstVideos.Items.Add(Path.GetFileName(d) + "  |  " + (fi.Length / 1024 / 1024.0).ToString("0.1") + " MB  |  " + fi.LastWriteTime.ToShortTimeString());
      }
    }
    if (lstVideos.Items.Count > 0) lstVideos.SelectedIndex = 0;

    lstImages.Items.Clear();
    foreach (var img in Directory.GetFiles(Path.Combine(recRoot, "Screenshots"), "*.png")) {
      lstImages.Items.Add(Path.GetFileName(img));
    }
  }

  void OnModeChanged() {
    string[] modes = { "fullscreen", "rectangle", "select_area", "specific_window", "around_mouse" };
    capMode = modes[cmbMode.SelectedIndex];
    if (capMode == "rectangle") ShowHollowFrame();
    else if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.Hide();
    if (capMode == "specific_window") RefreshWindows();
  }

  void ShowHollowFrame() {
    if (rectFrame == null || rectFrame.IsDisposed) rectFrame = new HollowFrameForm(this);
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

  public void TogglePause() {
    if (!isRecording) return;
    isPaused = !isPaused;
    lblSub.Text = isPaused ? "⏸ PAUSED (Shift+F12)" : "● REC LIVE 60 FPS";
  }

  public void TakeScreenshot() {
    try {
      var b = Screen.PrimaryScreen.Bounds;
      string fn = Path.Combine(recRoot, "Screenshots", "shot_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".png");
      using (var bmp = new Bitmap(b.Width, b.Height))
      using (var g = Graphics.FromImage(bmp)) {
        g.CopyFromScreen(0, 0, 0, 0, bmp.Size);
        bmp.Save(fn);
      }
      PlayWav(Path.Combine(bdDataDir, "camera.wav"));
      lblSub.Text = "📷 Saved Screenshot!";
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

  bool LaunchFfmpegProcess(bool tryDda, bool useCrop, int rx, int ry, int rw, int rh, string mp4) {
    string inputArgs = tryDda
      ? "-f lavfi -i \"ddagrab=framerate=60:draw_mouse=0,hwdownload,format=bgra\""
      : "-f gdigrab -framerate 60 -draw_mouse 0 -i desktop";

    // Guaranteed EVEN width & height so libx264 yuv420p NEVER fails on 2054x1285 odd monitors!
    string vf = useCrop
      ? string.Format("crop={0}:{1}:{2}:{3},scale=trunc(iw/2)*2:trunc(ih/2)*2", rw, rh, rx, ry)
      : "scale=trunc(iw/2)*2:trunc(ih/2)*2";

    var psi = new ProcessStartInfo {
      FileName = ffmpegExe,
      Arguments = string.Format("-y -loglevel error {0} -an -vf \"{1}\" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -movflags +faststart \"{2}\"", inputArgs, vf, mp4),
      RedirectStandardInput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true
    };
    ffProc = Process.Start(psi);
    System.Threading.Thread.Sleep(650);
    return (ffProc != null && !ffProc.HasExited);
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
        System.Threading.Thread.Sleep(150);
        RECT wr;
        if (GetWindowRect(wp.MainWindowHandle, out wr)) {
          rx = Math.Max(0, wr.Left + 7); ry = Math.Max(0, wr.Top);
          rw = (wr.Right - wr.Left) - 14; rh = (wr.Bottom - wr.Top) - 7; useCrop = true;
        }
      } catch {}
    }

    // Strict even clamping inside physical screen bounds (Fixes 2054x1285 -> 2054x1284!)
    if (useCrop) {
      rx = Math.Max(0, Math.Min(sb.Width - 80, rx));
      ry = Math.Max(0, Math.Min(sb.Height - 80, ry));
      rw = Math.Min(sb.Width - rx, Math.Max(80, (rw / 2) * 2));
      rh = Math.Min(sb.Height - ry, Math.Max(80, (rh / 2) * 2));
    } else {
      rx = 0; ry = 0;
      rw = (sb.Width / 2) * 2;
      rh = (sb.Height / 2) * 2;
    }
    cropX = rx; cropY = ry; cropW = rw; cropH = rh;

    SavePrefsJson();
    curSessDir = Path.Combine(recRoot, "rec_" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffZ"));
    Directory.CreateDirectory(curSessDir);
    curMp4Path = Path.Combine(curSessDir, "screen.mp4");

    if (chkHideOnRec.Checked && capMode != "rectangle") {
      WindowState = FormWindowState.Minimized;
      if (miniBar == null || miniBar.IsDisposed) miniBar = new MiniGhostBar(this);
      miniBar.Show();
    }
    PlayWav(Path.Combine(bdDataDir, "start.wav"));

    bool ok = hasDdaGrab && LaunchFfmpegProcess(true, useCrop, rx, ry, rw, rh, curMp4Path);
    if (!ok) ok = LaunchFfmpegProcess(false, useCrop, rx, ry, rw, rh, curMp4Path);

    if (!ok) {
      WindowState = FormWindowState.Normal;
      string err = ffProc != null ? ffProc.StandardError.ReadToEnd() : "FFmpeg failed to start";
      MessageBox.Show("FFmpeg Capture Error:\n" + err, "Pixopik Recorder");
      return;
    }

    sampleJson.Clear(); clickJson.Clear();
    wasL = false; wasR = false; isPaused = false; isRecording = true;
    btnRec.Text = "■ STOP"; btnRec.BackColor = Color.FromArgb(185, 28, 28);
    lblSub.Text = "● REC " + rw + "x" + rh + " (F12 Stop)";
    recSw.Restart();
    tickTimer.Start();
  }

  void OnCaptureTick(object sender, EventArgs e) {
    if (!isRecording || isPaused) return;
    if (ffProc != null && ffProc.HasExited) { StopRecording(); return; }

    double t = Math.Round(recSw.Elapsed.TotalSeconds, 3);
    TimeSpan ts = TimeSpan.FromSeconds(t);
    string tStr = string.Format("{0:D2}:{1:D2}:{2:D2}", (int)ts.TotalHours, ts.Minutes, ts.Seconds);
    lblTimer.Text = tStr;
    if (rectFrame != null && !rectFrame.IsDisposed && rectFrame.Visible) rectFrame.UpdateTimerText(tStr);
    if (miniBar != null && !miniBar.IsDisposed && miniBar.Visible) miniBar.UpdateTimer(tStr, cropW + "x" + cropH);

    Point p = Cursor.Position;
    int rx = Math.Max(0, Math.Min(cropW, p.X - cropX));
    int ry = Math.Max(0, Math.Min(cropH, p.Y - cropY));
    bool inside = (p.X >= cropX && p.X <= cropX + cropW && p.Y >= cropY && p.Y <= cropY + cropH);

    string tsInv = t.ToString(CultureInfo.InvariantCulture);
    sampleJson.Add("{\"t\":" + tsInv + ",\"x\":" + rx + ",\"y\":" + ry + "}");

    bool lDown = (Control.MouseButtons & MouseButtons.Left) != 0;
    bool rDown = (Control.MouseButtons & MouseButtons.Right) != 0;
    if (inside) {
      if (lDown && !wasL) clickJson.Add("{\"t\":" + tsInv + ",\"x\":" + rx + ",\"y\":" + ry + ",\"button\":\"left\"}");
      if (rDown && !wasR) clickJson.Add("{\"t\":" + tsInv + ",\"x\":" + rx + ",\"y\":" + ry + ",\"button\":\"right\"}");
    }
    wasL = lDown; wasR = rDown;
  }

  void StopRecording() {
    tickTimer.Stop();
    if (!isRecording) return;
    isRecording = false;
    recSw.Stop();
    PlayWav(Path.Combine(bdDataDir, "stop.wav"));
    if (miniBar != null && !miniBar.IsDisposed) miniBar.Hide();

    if (ffProc != null && !ffProc.HasExited) {
      try { ffProc.StandardInput.WriteLine("q"); ffProc.StandardInput.Flush(); ffProc.StandardInput.Close(); ffProc.WaitForExit(5000); } catch {}
      if (!ffProc.HasExited) { try { ffProc.Kill(); } catch {} }
    }

    string durStr = Math.Round(recSw.Elapsed.TotalSeconds, 3).ToString(CultureInfo.InvariantCulture);
    string mot = "{\"version\":\"3.1.0\",\"fps\":60,\"captureMode\":\"" + capMode + "\",\"screenWidth\":" + cropW + ",\"screenHeight\":" + cropH + ",\"duration\":" + durStr + ",\"samples\":[" + string.Join(",", sampleJson) + "],\"clicks\":[" + string.Join(",", clickJson) + "]}";
    File.WriteAllText(Path.Combine(curSessDir, "motion.json"), mot, new UTF8Encoding(false));
    File.WriteAllText(Path.Combine(curSessDir, "done.signal"), "OK", new UTF8Encoding(false));

    if (chkAutoRig.Checked && File.Exists(curMp4Path) && new FileInfo(curMp4Path).Length > 1024) {
      File.WriteAllText(signalFile, curSessDir, new UTF8Encoding(false));
    }

    btnRec.Text = "● REC"; btnRec.BackColor = Color.FromArgb(225, 29, 72);
    lblSub.Text = "✅ Saved! Sent to After Effects";
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
    int wallIdx = Math.Min(3, cmbBg.SelectedIndex);

    string json = string.Format(
      "{{\"captureMode\":\"{0}\",\"bgImagePath\":\"{1}\",\"editMode\":\"{2}\",\"aspectPreset\":\"{3}\",\"cameraMode\":\"{4}\",\"zoomPercent\":{5},\"deadZoneRatio\":{6},\"cursorSmooth\":\"high\",\"wallpaper\":\"{7}\",\"frameStyle\":\"{8}\",\"clickSfx\":{9},\"clickRipples\":{10},\"autoRig\":{11},\"autoZoom\":{12}}}",
      capMode, selectedBgPath, presetVals[cmbPreset.SelectedIndex], aspectVals[cmbAspect.SelectedIndex],
      camVals[cmbCam.SelectedIndex], zoomVals[cmbZoom.SelectedIndex], deadVals[cmbDead.SelectedIndex],
      wallVals[wallIdx], cmbPreset.SelectedIndex == 0 ? "minimal_rounded" : "macos_glass",
      chkSfx.Checked ? "true" : "false", chkRip.Checked ? "true" : "false",
      chkAutoRig.Checked ? "true" : "false", cmbCam.SelectedIndex != 2 ? "true" : "false"
    );
    File.WriteAllText(prefsFile, json, new UTF8Encoding(false));
  }

  [STAThread]
  public static void Main(string[] args) {
    try { SetProcessDPIAware(); } catch {}
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new PixopikRecorderApp());
  }
}

// ============================================================================
// BANDICAM FULLSCREEN FLOATING MINI-BAR (100% Invisible in MP4!)
// ============================================================================
public class MiniGhostBar : Form {
  Label lblInfo;
  public MiniGhostBar(PixopikRecorderApp app) {
    FormBorderStyle = FormBorderStyle.None;
    TopMost = true; ShowInTaskbar = false;
    Size = new Size(360, 42);
    StartPosition = FormStartPosition.Manual;
    Location = new Point((Screen.PrimaryScreen.Bounds.Width - 360) / 2, 8);
    BackColor = Color.FromArgb(16, 20, 29); Opacity = 0.95;

    lblInfo = new Label { Text = "● 00:00:00", Left = 12, Top = 0, Width = 175, Height = 42, ForeColor = Color.White, TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Consolas", 10f, FontStyle.Bold), Cursor = Cursors.SizeAll };
    lblInfo.MouseDown += (s, e) => { PixopikRecorderApp.ReleaseCapture(); PixopikRecorderApp.SendMessage(Handle, 0xA1, 0x2, 0); };
    Controls.Add(lblInfo);

    Button bPause = new Button { Text = "⏸", Left = 192, Top = 6, Width = 38, Height = 30, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White };
    bPause.Click += (s, e) => app.TogglePause();
    Controls.Add(bPause);

    Button bStop = new Button { Text = "■ STOP (F12)", Left = 236, Top = 6, Width = 114, Height = 30, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(225, 29, 72), ForeColor = Color.White, Font = new Font("Segoe UI", 8.5f, FontStyle.Bold) };
    bStop.Click += (s, e) => app.ToggleRecord();
    Controls.Add(bStop);

    Shown += (s, e) => { try { PixopikRecorderApp.SetWindowDisplayAffinity(Handle, 0x00000011); } catch {} };
  }
  public void UpdateTimer(string t, string res) { lblInfo.Text = "● " + t + " (" + res + ")"; }
}

// ============================================================================
// BANDICAM HOLLOW TARGET RECTANGLE WINDOW (Invisible in MP4!)
// ============================================================================
public class HollowFrameForm : Form {
  PixopikRecorderApp parentApp;
  Label lblDim; Button btnRecBar;
  Color borderCol = Color.FromArgb(56, 189, 248);

  public HollowFrameForm(PixopikRecorderApp app) {
    parentApp = app;
    FormBorderStyle = FormBorderStyle.None;
    StartPosition = FormStartPosition.CenterScreen;
    Size = new Size(1288, 762);
    TopMost = true; BackColor = Color.Magenta; TransparencyKey = Color.Magenta;

    Panel topBar = new Panel { Dock = DockStyle.Top, Height = 38, BackColor = Color.FromArgb(17, 21, 30), Cursor = Cursors.SizeAll };
    topBar.MouseDown += (s, e) => { PixopikRecorderApp.ReleaseCapture(); PixopikRecorderApp.SendMessage(Handle, 0xA1, 0x2, 0); };
    Controls.Add(topBar);

    ComboBox cmbSz = new ComboBox { Left = 8, Top = 7, Width = 145, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White };
    cmbSz.Items.AddRange(new object[] { "1280 x 720 (HD)", "1600 x 900", "1920 x 1080", "608 x 1080 (Short)" });
    cmbSz.SelectedIndex = 0;
    cmbSz.SelectedIndexChanged += (s, e) => {
      int[][] sz = { new[]{1280,720}, new[]{1600,900}, new[]{1920,1080}, new[]{608,1080} };
      var d = sz[cmbSz.SelectedIndex];
      Size = new Size(d[0] + 8, d[1] + 42);
      Invalidate();
    };
    topBar.Controls.Add(cmbSz);

    lblDim = new Label { Text = "1280 x 720 • Drag Bar • F12 REC", Left = 162, Top = 10, Width = 260, ForeColor = Color.FromArgb(165, 243, 252), Font = new Font("Segoe UI", 9f, FontStyle.Bold) };
    lblDim.MouseDown += (s, e) => { PixopikRecorderApp.ReleaseCapture(); PixopikRecorderApp.SendMessage(Handle, 0xA1, 0x2, 0); };
    topBar.Controls.Add(lblDim);

    Button btnX = new Button { Text = "✕", Dock = DockStyle.Right, Width = 38, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(51, 65, 85), ForeColor = Color.White };
    btnX.Click += (s, e) => Hide();
    btnRecBar = new Button { Text = "● REC (F12)", Dock = DockStyle.Right, Width = 110, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(225, 29, 72), ForeColor = Color.White, Font = new Font("Segoe UI", 8.8f, FontStyle.Bold) };
    btnRecBar.Click += (s, e) => parentApp.ToggleRecord();
    topBar.Controls.Add(btnRecBar); topBar.Controls.Add(btnX);

    Shown += (s, e) => { try { PixopikRecorderApp.SetWindowDisplayAffinity(Handle, 0x00000011); } catch {} };
    Move += (s, e) => parentApp.UpdateRectFromFrame(GetInnerScreenRect());
    Resize += (s, e) => { parentApp.UpdateRectFromFrame(GetInnerScreenRect()); Invalidate(); };
  }

  public Rectangle GetInnerScreenRect() {
    Point tl = PointToScreen(new Point(4, 38));
    return new Rectangle(tl.X, tl.Y, Width - 8, Height - 42);
  }
  public void SetRecState(bool rec) { borderCol = rec ? Color.FromArgb(239, 68, 68) : Color.FromArgb(56, 189, 248); btnRecBar.Text = rec ? "■ STOP" : "● REC (F12)"; Invalidate(); }
  public void UpdateTimerText(string t) { lblDim.Text = "● REC " + t; }
  protected override void OnPaint(PaintEventArgs e) { using (var pen = new Pen(borderCol, 4)) e.Graphics.DrawRectangle(pen, 2, 38, Width - 4, Height - 40); }
}
