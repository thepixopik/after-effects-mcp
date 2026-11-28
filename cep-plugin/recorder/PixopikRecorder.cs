using System;
using System.IO;
using System.Net;
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
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public string recRoot, ffmpegExe, signalFile, prefsFile, portFile, bdDataDir;
  string capMode = "fullscreen";
  int cropX = 160, cropY = 120, cropW = 1280, cropH = 720;
  string selectedBgPath = "";

  bool isRecording = false, isPaused = false;
  Process ffProc = null;
  Stopwatch recSw = new Stopwatch();
  Timer tickTimer = new Timer();
  string curSessDir = "", curMp4Path = "";
  List<string> sampleJson = new List<string>();
  List<string> clickJson = new List<string>();
  List<double> keyStrokeTimes = new List<double>();
  bool wasL = false, wasR = false, wasAnyTypingKey = false;

  static readonly int[] TYPING_VKEYS = new int[] {
    0x08, 0x0D, 0x20,
    0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,
    0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,
    0x4E,0x4F,0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,
    0xBA,0xBB,0xBC,0xBD,0xBE,0xBF,0xDB,0xDC,0xDD,0xDE
  };

  Label lblTimer, lblSub, lblFooter;
  Button btnRec, btnPause;
  ComboBox cmbMode, cmbCam, cmbZoom, cmbMinDist, cmbPreset, cmbAspect, cmbBg, cmbWin;
  CheckBox chkSfx, chkRip, chkAutoRig, chkBlur3Way, chkTypingRamp, chkHideOnRec;
  Panel paneHome, paneVideos, paneImages, paneAe;
  ListBox lstVideos, lstImages;
  HollowFrameForm rectFrame = null;
  MiniGhostBar miniBar = null;

  public PixopikRecorderApp(string customRoot) {
    recRoot = !string.IsNullOrWhiteSpace(customRoot)
      ? customRoot
      : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Videos", "PixopikRecordings");
    Directory.CreateDirectory(recRoot);
    Directory.CreateDirectory(Path.Combine(recRoot, "Screenshots"));
    signalFile = Path.Combine(recRoot, "native_done.signal");
    prefsFile  = Path.Combine(recRoot, "studio_v2_prefs.json");
    portFile   = Path.Combine(recRoot, "ae_bridge_port.txt");
    bdDataDir  = Directory.Exists(@"C:\Program Files\Bandicam\data") ? @"C:\Program Files\Bandicam\data" : @"C:\Program Files (x86)\Bandicam\data";
    ffmpegExe  = FindFfmpegSafe();

    Text = "Pixopik Screen Recorder Pro v4.0 (FocuSee Cinema Edition)";
    ClientSize = new Size(860, 535);
    MinimumSize = new Size(780, 495);
    StartPosition = FormStartPosition.CenterScreen;
    BackColor = Color.FromArgb(24, 30, 42);
    ForeColor = Color.FromArgb(236, 242, 250);
    Font = new Font("Segoe UI", 9.0f);

    BuildBandicamUI();
    RegisterHotKey(Handle, 9001, 0, 0x7B);
    RegisterHotKey(Handle, 9002, 4, 0x7B);
    RegisterHotKey(Handle, 9003, 0, 0x7A);

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

  static string FindFfmpegSafe() {
    string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    string linkExe = Path.Combine(localApp, @"Microsoft\WinGet\Links\ffmpeg.exe");
    if (File.Exists(linkExe)) return linkExe;
    string wg = Path.Combine(localApp, @"Microsoft\WinGet\Packages");
    if (Directory.Exists(wg)) {
      foreach (var pkg in Directory.GetDirectories(wg)) {
        try {
          var found = Directory.GetFiles(pkg, "ffmpeg.exe", SearchOption.AllDirectories);
          if (found.Length > 0) return found[0];
        } catch {}
      }
    }
    foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
      try { if (!string.IsNullOrWhiteSpace(dir)) { string p = Path.Combine(dir.Trim(), "ffmpeg.exe"); if (File.Exists(p)) return p; } } catch {}
    }
    foreach (var c in new[] { @"C:\ffmpeg\bin\ffmpeg.exe", @"C:\Program Files\ffmpeg\bin\ffmpeg.exe" }) if (File.Exists(c)) return c;
    return "";
  }

  void NotifyAeInstant(string action, string sessionDir) {
    try {
      if (action == "auto_rig" && !string.IsNullOrEmpty(sessionDir)) File.WriteAllText(signalFile, sessionDir, new UTF8Encoding(false));
      else File.WriteAllText(Path.Combine(recRoot, "native_cmd.txt"), action, new UTF8Encoding(false));
      if (File.Exists(portFile)) {
        int pNum;
        if (int.TryParse(File.ReadAllText(portFile).Trim(), out pNum) && pNum > 0) {
          var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + pNum + "/bridge");
          req.Method = "POST"; req.ContentType = "application/json"; req.Timeout = 1500;
          string safeSess = (sessionDir ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
          byte[] bytes = Encoding.UTF8.GetBytes("{\"action\":\"" + action + "\",\"sessionDir\":\"" + safeSess + "\"}");
          req.ContentLength = bytes.Length;
          using (var st = req.GetRequestStream()) st.Write(bytes, 0, bytes.Length);
          using (var resp = req.GetResponse()) {}
        }
      }
    } catch {}
  }

  void BringAfterEffectsToFront() {
    try {
      foreach (var p in Process.GetProcesses()) {
        try {
          if (p.ProcessName.IndexOf("AfterFX", StringComparison.OrdinalIgnoreCase) >= 0 && p.MainWindowHandle != IntPtr.Zero) {
            ShowWindow(p.MainWindowHandle, 9); SetForegroundWindow(p.MainWindowHandle); break;
          }
        } catch {}
      }
    } catch {}
  }

  void BuildBandicamUI() {
    Panel top = new Panel { Dock = DockStyle.Top, Height = 68, BackColor = Color.FromArgb(16, 20, 29), Padding = new Padding(12, 10, 12, 10) };

    FlowLayoutPanel rightCluster = new FlowLayoutPanel { Dock = DockStyle.Right, AutoSize = true, WrapContents = false };
    Panel timerStack = new Panel { Width = 185, Height = 48 };
    lblTimer = new Label { Text = "00:00:00", Dock = DockStyle.Top, Height = 28, TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.White, Font = new Font("Consolas", 14.0f, FontStyle.Bold) };
    lblSub   = new Label { Text = "F12: REC/Stop • F11: Shot", Dock = DockStyle.Bottom, Height = 18, TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 7.8f, FontStyle.Bold) };
    timerStack.Controls.Add(lblTimer); timerStack.Controls.Add(lblSub);

    btnPause = new Button { Text = "⏸", Width = 44, Height = 44, Margin = new Padding(6, 2, 4, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnPause.Click += (s, e) => TogglePause();

    btnRec = new Button { Text = "● REC", Width = 92, Height = 44, Margin = new Padding(4, 2, 4, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(225, 29, 72), ForeColor = Color.White, Font = new Font("Segoe UI", 10.0f, FontStyle.Bold), Cursor = Cursors.Hand };
    btnRec.Click += (s, e) => ToggleRecord();

    Button btnShot = new Button { Text = "📷", Width = 44, Height = 44, Margin = new Padding(4, 2, 0, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnShot.Click += (s, e) => TakeScreenshot();
    rightCluster.Controls.AddRange(new Control[] { timerStack, btnPause, btnRec, btnShot });

    FlowLayoutPanel leftCluster = new FlowLayoutPanel { Dock = DockStyle.Left, AutoSize = true, WrapContents = false };
    cmbMode = new ComboBox { Width = 220, Margin = new Padding(0, 8, 8, 0), DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), FlatStyle = FlatStyle.Flat };
    cmbMode.Items.AddRange(new object[] { "⛶  Fullscreen (Display 1)", "▭  Rectangle on a screen", "✛  Select a recording area", "🗔  Specific window", "🖱️  Around mouse (1280x720)" });
    cmbMode.SelectedIndex = 0;
    cmbMode.SelectedIndexChanged += (s, e) => OnModeChanged();

    Button btnDraw = new Button { Text = "✏️ Draw", Width = 74, Height = 38, Margin = new Padding(2, 5, 4, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnDraw.Click += (s, e) => NotifyAeInstant("OPEN_GHOST", "");
    Button btnChr = new Button { Text = "🧼 Chrome", Width = 84, Height = 38, Margin = new Padding(2, 5, 0, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnChr.Click += (s, e) => NotifyAeInstant("OPEN_CHROME", "");
    leftCluster.Controls.AddRange(new Control[] { cmbMode, btnDraw, btnChr });
    top.Controls.Add(rightCluster); top.Controls.Add(leftCluster);

    lblFooter = new Label { Dock = DockStyle.Bottom, Height = 28, BackColor = Color.FromArgb(14, 18, 26), ForeColor = Color.FromArgb(148, 163, 184), TextAlign = ContentAlignment.MiddleLeft, Text = "  v4.0 FocuSee Engine  •  Click = Zoom  •  Cursor >=550px = Dolly  •  Typing = Hide Cursor + Speed Motion Blur!" };

    Panel nav = new Panel { Dock = DockStyle.Left, Width = 170, BackColor = Color.FromArgb(19, 24, 34), Padding = new Padding(8, 12, 8, 12) };
    FlowLayoutPanel navFlow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false };
    Button bHome = MakeNav("🏠  Get Started");
    Button bVids = MakeNav("🎬  Videos");
    Button bImgs = MakeNav("🖼️  Images");
    Button bAe   = MakeNav("🎥  AE & Wallpapers");
    Button bOpen = MakeNav("📂  Output Folder");
    bHome.Click += (s, e) => ShowPane(paneHome);
    bVids.Click += (s, e) => { RefreshMediaLists(); ShowPane(paneVideos); };
    bImgs.Click += (s, e) => { RefreshMediaLists(); ShowPane(paneImages); };
    bAe.Click   += (s, e) => ShowPane(paneAe);
    bOpen.Click += (s, e) => Process.Start("explorer.exe", "\"" + recRoot + "\"");
    navFlow.Controls.AddRange(new Control[] { bHome, bVids, bImgs, bAe, bOpen });

    chkHideOnRec = new CheckBox { Text = "Minimize on REC", Checked = true, Dock = DockStyle.Bottom, Height = 28, ForeColor = Color.FromArgb(165, 180, 205) };
    nav.Controls.Add(navFlow); nav.Controls.Add(chkHideOnRec);

    Panel body = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16) };

    paneHome = new Panel { Dock = DockStyle.Fill };
    TableLayoutPanel cardsGrid = new TableLayoutPanel { Dock = DockStyle.Top, Height = 110, ColumnCount = 4, RowCount = 1 };
    for (int c = 0; c < 4; c++) cardsGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25f));
    cardsGrid.Controls.Add(MakeCard("✛ Select Area", "Drag crosshair box", () => { cmbMode.SelectedIndex = 2; PickCrosshairArea(); }), 0, 0);
    cardsGrid.Controls.Add(MakeCard("▭ Rectangle Bar", "Floating target frame", () => { cmbMode.SelectedIndex = 1; ShowHollowFrame(); }), 1, 0);
    cardsGrid.Controls.Add(MakeCard("⛶ Fullscreen", "Entire monitor 60fps", () => { cmbMode.SelectedIndex = 0; }), 2, 0);
    cardsGrid.Controls.Add(MakeCard("🖱️ Around Mouse", "Follow cursor 1280x720", () => { cmbMode.SelectedIndex = 4; }), 3, 0);

    Panel winPanel = new Panel { Dock = DockStyle.Top, Height = 72, BackColor = Color.FromArgb(18, 23, 33), Padding = new Padding(12, 6, 12, 6) };
    Label lWin = new Label { Text = "🗔 SPECIFIC WINDOW TARGET:", Dock = DockStyle.Top, Height = 18, ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 8.0f, FontStyle.Bold) };
    Panel winRow = new Panel { Dock = DockStyle.Top, Height = 30 };
    Button bRefW = new Button { Text = "↻ Refresh", Dock = DockStyle.Right, Width = 100, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(2, 132, 199), ForeColor = Color.White };
    bRefW.Click += (s, e) => RefreshWindows();
    cmbWin = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White };
    winRow.Controls.Add(cmbWin); winRow.Controls.Add(bRefW);
    winPanel.Controls.Add(winRow); winPanel.Controls.Add(lWin);

    Panel camPanel = new Panel { Dock = DockStyle.Top, Height = 152, BackColor = Color.FromArgb(18, 23, 33), Padding = new Padding(12, 8, 12, 8) };
    Label lCam = new Label { Text = "🌀 FOCUSEE 3-LAYER ENGINE (CLICK ZOOM + CURSOR DOLLY + TYPING BLUR):", Dock = DockStyle.Top, Height = 22, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 8.5f, FontStyle.Bold) };
    FlowLayoutPanel camRow1 = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 36, WrapContents = false };
    cmbCam = MakeCombo(new[] { "🌀 FocuSee 3-Layer (Click Zoom + Dolly)", "🎯 Classic Click Zoom In/Out", "📌 Static Locked (0% Move)" }, 0, 240);
    cmbMinDist = MakeCombo(new[] { "📏 Move >= 350 px", "📏 Move >= 550 px (Pro)", "📏 Move >= 800 px", "📏 Move >= 1050 px" }, 1, 165);
    cmbZoom = MakeCombo(new[] { "135% Zoom", "148% Balanced", "170% Close" }, 1, 120);
    camRow1.Controls.AddRange(new Control[] { cmbCam, cmbMinDist, cmbZoom });

    FlowLayoutPanel camRow2 = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 30, WrapContents = false };
    chkBlur3Way = new CheckBox { Text = "🌀 3-Way Optical Motion Blur (190°)", Checked = true, AutoSize = true, ForeColor = Color.FromArgb(165, 243, 252) };
    chkTypingRamp = new CheckBox { Text = "⌨️ Typing (>2.5s): Hide Cursor + 1.85x Blur Ramp", Checked = true, AutoSize = true, Margin = new Padding(14, 3, 0, 0), ForeColor = Color.FromArgb(165, 243, 252) };
    camRow2.Controls.AddRange(new Control[] { chkBlur3Way, chkTypingRamp });

    FlowLayoutPanel camRow3 = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 30, WrapContents = false };
    chkAutoRig = new CheckBox { Text = "⚡ Auto-Rig AE on Stop", Checked = true, AutoSize = true, ForeColor = Color.White };
    chkSfx = new CheckBox { Text = "🔊 Click SFX", Checked = true, AutoSize = true, Margin = new Padding(16, 3, 0, 0), ForeColor = Color.FromArgb(203, 213, 225) };
    chkRip = new CheckBox { Text = "💫 Click Ripples", Checked = true, AutoSize = true, Margin = new Padding(16, 3, 0, 0), ForeColor = Color.FromArgb(203, 213, 225) };
    camRow3.Controls.AddRange(new Control[] { chkAutoRig, chkSfx, chkRip });

    camPanel.Controls.Add(camRow3); camPanel.Controls.Add(camRow2); camPanel.Controls.Add(camRow1); camPanel.Controls.Add(lCam);

    paneHome.Controls.Add(camPanel);
    paneHome.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 8 });
    paneHome.Controls.Add(winPanel);
    paneHome.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 8 });
    paneHome.Controls.Add(cardsGrid);

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
        NotifyAeInstant("auto_rig", dir); BringAfterEffectsToFront();
      }
    };
    vidBtns.Controls.AddRange(new Control[] { bPlayVid, bRigVid });
    paneVideos.Controls.Add(lstVideos); paneVideos.Controls.Add(vidBtns);

    paneImages = new Panel { Dock = DockStyle.Fill, Visible = false };
    lstImages = new ListBox { Dock = DockStyle.Fill, BackColor = Color.FromArgb(17, 21, 30), ForeColor = Color.White, Font = new Font("Consolas", 9.5f) };
    paneImages.Controls.Add(lstImages);

    paneAe = new Panel { Dock = DockStyle.Fill, Visible = false };
    FlowLayoutPanel aeStack = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false };
    aeStack.Controls.Add(new Label { Text = "AFTER EFFECTS LAYOUT & ASPECT:", AutoSize = true, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 9f, FontStyle.Bold) });
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
    Controls.Add(body); Controls.Add(nav); Controls.Add(lblFooter); Controls.Add(top);
    RefreshWindows();
  }

  void ShowPane(Panel target) {
    paneHome.Visible = (target == paneHome); paneVideos.Visible = (target == paneVideos);
    paneImages.Visible = (target == paneImages); paneAe.Visible = (target == paneAe);
  }

  Button MakeNav(string txt) {
    var b = new Button { Text = txt, Width = 152, Height = 38, Margin = new Padding(0, 0, 0, 4), FlatStyle = FlatStyle.Flat, TextAlign = ContentAlignment.MiddleLeft, BackColor = Color.Transparent, ForeColor = Color.FromArgb(203, 213, 225), Cursor = Cursors.Hand };
    b.FlatAppearance.BorderSize = 0; return b;
  }

  ComboBox MakeCombo(string[] items, int sel, int w) {
    var c = new ComboBox { Width = w, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
    c.Items.AddRange(items); c.SelectedIndex = sel; return c;
  }

  Panel MakeCard(string title, string sub, Action onClick) {
    var p = new Panel { Dock = DockStyle.Fill, Margin = new Padding(5), BackColor = Color.FromArgb(33, 42, 58), Cursor = Cursors.Hand };
    var l1 = new Label { Text = title, Dock = DockStyle.Top, Height = 46, TextAlign = ContentAlignment.BottomCenter, ForeColor = Color.White, Font = new Font("Segoe UI", 9.8f, FontStyle.Bold), Cursor = Cursors.Hand };
    var l2 = new Label { Text = sub, Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopCenter, Padding = new Padding(4, 5, 4, 0), ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 8.0f), Cursor = Cursors.Hand };
    EventHandler h = (s, e) => onClick(); p.Click += h; l1.Click += h; l2.Click += h;
    p.Controls.Add(l2); p.Controls.Add(l1); return p;
  }

  void RefreshWindows() {
    cmbWin.Items.Clear();
    foreach (var p in Process.GetProcesses()) {
      try { if (!string.IsNullOrWhiteSpace(p.MainWindowTitle) && !p.MainWindowTitle.Contains("Pixopik Screen Recorder")) cmbWin.Items.Add(p.Id + " | " + p.MainWindowTitle); } catch {}
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
        lstVideos.Items.Add(Path.GetFileName(d) + "  |  " + (fi.Length / 1048576.0).ToString("0.1") + " MB  |  " + fi.LastWriteTime.ToShortTimeString());
      }
    }
    if (lstVideos.Items.Count > 0) lstVideos.SelectedIndex = 0;
    lstImages.Items.Clear();
    foreach (var img in Directory.GetFiles(Path.Combine(recRoot, "Screenshots"), "*.png")) lstImages.Items.Add(Path.GetFileName(img));
  }

  void OnModeChanged() {
    string[] modes = { "fullscreen", "rectangle", "select_area", "specific_window", "around_mouse" };
    capMode = modes[cmbMode.SelectedIndex];
    if (capMode == "rectangle") ShowHollowFrame(); else if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.Hide();
    if (capMode == "specific_window") RefreshWindows();
  }

  void ShowHollowFrame() { if (rectFrame == null || rectFrame.IsDisposed) rectFrame = new HollowFrameForm(this); rectFrame.Show(); }
  public void UpdateRectFromFrame(Rectangle r) { cropX = Math.Max(0, r.X); cropY = Math.Max(0, r.Y); cropW = (r.Width / 2) * 2; cropH = (r.Height / 2) * 2; lblSub.Text = cropW + "x" + cropH + " Frame Ready"; }

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
    Show(); lblSub.Text = "Area: " + cropW + "x" + cropH;
  }

  public void ToggleRecord() { if (!isRecording) StartRecording(); else StopRecording(); }
  public void TogglePause() { if (!isRecording) return; isPaused = !isPaused; lblSub.Text = isPaused ? "⏸ PAUSED (Shift+F12)" : "● REC LIVE 60 FPS"; }

  public void TakeScreenshot() {
    try {
      var b = Screen.PrimaryScreen.Bounds;
      string fn = Path.Combine(recRoot, "Screenshots", "shot_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".png");
      using (var bmp = new Bitmap(b.Width, b.Height)) using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(0, 0, 0, 0, bmp.Size); bmp.Save(fn); }
      PlayWav(Path.Combine(bdDataDir, "camera.wav")); lblSub.Text = "📷 Saved Screenshot!";
    } catch {}
  }

  void PlayWav(string p) { try { if (File.Exists(p)) new System.Media.SoundPlayer(p).Play(); } catch {} }

  bool CheckAnyTypingKeyDown() {
    for (int i = 0; i < TYPING_VKEYS.Length; i++) {
      if ((GetAsyncKeyState(TYPING_VKEYS[i]) & 0x8000) != 0) return true;
    }
    return false;
  }

  string BuildTypingBurstsJson() {
    if (keyStrokeTimes.Count < 4) return "";
    var outList = new List<string>();
    double bStart = keyStrokeTimes[0], bPrev = keyStrokeTimes[0];
    int count = 1;
    for (int i = 1; i < keyStrokeTimes.Count; i++) {
      double kt = keyStrokeTimes[i];
      if ((kt - bPrev) <= 1.35) {
        bPrev = kt; count++;
      } else {
        if (count >= 4 && (bPrev - bStart) >= 0.75) {
          outList.Add("{\"tStart\":" + bStart.ToString(CultureInfo.InvariantCulture) + ",\"tEnd\":" + bPrev.ToString(CultureInfo.InvariantCulture) + ",\"keys\":" + count + "}");
        }
        bStart = kt; bPrev = kt; count = 1;
      }
    }
    if (count >= 4 && (bPrev - bStart) >= 0.75) {
      outList.Add("{\"tStart\":" + bStart.ToString(CultureInfo.InvariantCulture) + ",\"tEnd\":" + bPrev.ToString(CultureInfo.InvariantCulture) + ",\"keys\":" + count + "}");
    }
    return string.Join(",", outList);
  }

  void StartRecording() {
    try {
      if (string.IsNullOrEmpty(ffmpegExe) || !File.Exists(ffmpegExe)) {
        ffmpegExe = FindFfmpegSafe();
        if (string.IsNullOrEmpty(ffmpegExe)) { MessageBox.Show("FFmpeg not found!", "Pixopik Recorder"); return; }
      }

      Rectangle sb = Screen.PrimaryScreen.Bounds;
      int rx = 0, ry = 0, rw = sb.Width, rh = sb.Height; bool useCrop = false;

      if (capMode == "rectangle" && rectFrame != null && !rectFrame.IsDisposed) {
        Rectangle fr = rectFrame.GetInnerScreenRect(); rx = fr.X; ry = fr.Y; rw = fr.Width; rh = fr.Height; useCrop = true; rectFrame.SetRecState(true);
      } else if (capMode == "select_area") { rx = cropX; ry = cropY; rw = cropW; rh = cropH; useCrop = true; }
      else if (capMode == "specific_window" && cmbWin.SelectedItem != null) {
        int pid = int.Parse(cmbWin.SelectedItem.ToString().Split('|')[0].Trim());
        try {
          var wp = Process.GetProcessById(pid); SetForegroundWindow(wp.MainWindowHandle); System.Threading.Thread.Sleep(150);
          RECT wr; if (GetWindowRect(wp.MainWindowHandle, out wr)) { rx = Math.Max(0, wr.Left + 7); ry = Math.Max(0, wr.Top); rw = (wr.Right - wr.Left) - 14; rh = (wr.Bottom - wr.Top) - 7; useCrop = true; }
        } catch {}
      }

      if (useCrop) {
        rx = Math.Max(0, Math.Min(sb.Width - 80, rx)); ry = Math.Max(0, Math.Min(sb.Height - 80, ry));
        rw = Math.Min(sb.Width - rx, Math.Max(80, (rw / 2) * 2)); rh = Math.Min(sb.Height - ry, Math.Max(80, (rh / 2) * 2));
      } else { rx = 0; ry = 0; rw = (sb.Width / 2) * 2; rh = (sb.Height / 2) * 2; }
      cropX = rx; cropY = ry; cropW = rw; cropH = rh;

      SavePrefsJson();
      curSessDir = Path.Combine(recRoot, "rec_" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffZ"));
      Directory.CreateDirectory(curSessDir);
      curMp4Path = Path.Combine(curSessDir, "screen.mp4");

      string vf = useCrop ? string.Format("crop={0}:{1}:{2}:{3},scale=trunc(iw/2)*2:trunc(ih/2)*2", rw, rh, rx, ry) : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
      var errSb = new StringBuilder();
      var psi = new ProcessStartInfo {
        FileName = ffmpegExe,
        Arguments = string.Format("-y -nostats -loglevel error -f gdigrab -framerate 60 -draw_mouse 0 -i desktop -an -vf \"{0}\" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -movflags +faststart \"{1}\"", vf, curMp4Path),
        RedirectStandardInput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true
      };

      ffProc = new Process { StartInfo = psi };
      ffProc.ErrorDataReceived += (s, ev) => { if (ev.Data != null) errSb.AppendLine(ev.Data); };
      ffProc.Start(); ffProc.BeginErrorReadLine();

      System.Threading.Thread.Sleep(550);
      if (ffProc.HasExited) { MessageBox.Show("FFmpeg exited early:\n" + errSb.ToString(), "Pixopik Recorder"); return; }

      PlayWav(Path.Combine(bdDataDir, "start.wav"));
      sampleJson.Clear(); clickJson.Clear(); keyStrokeTimes.Clear();
      wasL = false; wasR = false; wasAnyTypingKey = false; isPaused = false; isRecording = true;
      btnRec.Text = "■ STOP"; btnRec.BackColor = Color.FromArgb(185, 28, 28);
      lblSub.Text = "● REC " + rw + "x" + rh + " (F12 Stop)";

      if (chkHideOnRec.Checked && capMode != "rectangle") {
        if (miniBar == null || miniBar.IsDisposed) miniBar = new MiniGhostBar(this);
        miniBar.Show(); WindowState = FormWindowState.Minimized;
      }
      recSw.Restart(); tickTimer.Start();
    } catch (Exception ex) { MessageBox.Show("Start Error:\n" + ex.Message, "Pixopik Recorder"); }
  }

  void OnCaptureTick(object sender, EventArgs e) {
    if (!isRecording || isPaused) return;
    if (ffProc != null && ffProc.HasExited) { StopRecording(); return; }

    double t = Math.Round(recSw.Elapsed.TotalSeconds, 3);
    TimeSpan ts = TimeSpan.FromSeconds(t);
    string tStr = string.Format("{0:D2}:{1:D2}:{2:D2}", (int)ts.TotalHours, ts.Minutes, ts.Seconds);
    lblTimer.Text = tStr;

    string mbTxt = "";
    if (((int)(t * 10)) % 10 == 0 && File.Exists(curMp4Path)) { try { mbTxt = " • " + (new FileInfo(curMp4Path).Length / 1048576.0).ToString("0.1") + " MB"; } catch {} }
    if (rectFrame != null && !rectFrame.IsDisposed && rectFrame.Visible) rectFrame.UpdateTimerText(tStr + mbTxt);
    if (miniBar != null && !miniBar.IsDisposed && miniBar.Visible) miniBar.UpdateTimer(tStr, cropW + "x" + cropH + mbTxt);

    Point p = Cursor.Position;
    int rx = Math.Max(0, Math.Min(cropW, p.X - cropX)), ry = Math.Max(0, Math.Min(cropH, p.Y - cropY));
    bool inside = (p.X >= cropX && p.X <= cropX + cropW && p.Y >= cropY && p.Y <= cropY + cropH);
    string tsInv = t.ToString(CultureInfo.InvariantCulture);
    sampleJson.Add("{\"t\":" + tsInv + ",\"x\":" + rx + ",\"y\":" + ry + "}");

    bool lDown = (Control.MouseButtons & MouseButtons.Left) != 0, rDown = (Control.MouseButtons & MouseButtons.Right) != 0;
    if (inside) {
      if (lDown && !wasL) clickJson.Add("{\"t\":" + tsInv + ",\"x\":" + rx + ",\"y\":" + ry + ",\"button\":\"left\"}");
      if (rDown && !wasR) clickJson.Add("{\"t\":" + tsInv + ",\"x\":" + rx + ",\"y\":" + ry + ",\"button\":\"right\"}");
    }
    wasL = lDown; wasR = rDown;

    /* Privacy-safe Typing Burst Timing (never stores what character was typed!) */
    bool keyDown = CheckAnyTypingKeyDown();
    if (keyDown && !wasAnyTypingKey) keyStrokeTimes.Add(t);
    wasAnyTypingKey = keyDown;
  }

  void StopRecording() {
    tickTimer.Stop(); if (!isRecording) return;
    isRecording = false; recSw.Stop();
    PlayWav(Path.Combine(bdDataDir, "stop.wav"));
    if (miniBar != null && !miniBar.IsDisposed) miniBar.Hide();

    if (ffProc != null && !ffProc.HasExited) {
      try { ffProc.StandardInput.WriteLine("q"); ffProc.StandardInput.Flush(); ffProc.StandardInput.Close(); ffProc.WaitForExit(5000); } catch {}
      if (!ffProc.HasExited) { try { ffProc.Kill(); } catch {} }
    }

    string durStr = Math.Round(recSw.Elapsed.TotalSeconds, 3).ToString(CultureInfo.InvariantCulture);
    string burstsJson = BuildTypingBurstsJson();
    string mot = "{\"version\":\"4.0.0\",\"fps\":60,\"captureMode\":\"" + capMode + "\",\"screenWidth\":" + cropW + ",\"screenHeight\":" + cropH + ",\"duration\":" + durStr + ",\"samples\":[" + string.Join(",", sampleJson) + "],\"clicks\":[" + string.Join(",", clickJson) + "],\"typingBursts\":[" + burstsJson + "]}";
    File.WriteAllText(Path.Combine(curSessDir, "motion.json"), mot, new UTF8Encoding(false));
    File.WriteAllText(Path.Combine(curSessDir, "done.signal"), "OK", new UTF8Encoding(false));

    btnRec.Text = "● REC"; btnRec.BackColor = Color.FromArgb(225, 29, 72);
    if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.SetRecState(false);

    bool validMp4 = File.Exists(curMp4Path) && new FileInfo(curMp4Path).Length > 1024;
    if (chkAutoRig.Checked && validMp4) {
      lblSub.Text = "⚡ Opening in After Effects...";
      WindowState = FormWindowState.Minimized;
      BringAfterEffectsToFront();
      NotifyAeInstant("auto_rig", curSessDir);
    } else {
      lblSub.Text = validMp4 ? "✅ Saved in Videos Tab!" : "⚠️ Capture too short";
      WindowState = FormWindowState.Normal;
    }
  }

  void SavePrefsJson() {
    string[] camVals = { "dolly_steady", "click_bounce", "static_lock" };
    int[] zoomVals = { 135, 148, 170 };
    int[] minDistVals = { 350, 550, 800, 1050 };
    string[] presetVals = { "youtube_tutorial", "saas_promo" };
    string[] aspectVals = { "youtube_16_9", "shorts_9_16", "square_1_1" };
    string[] wallVals = { "dark_carbon", "cosmic_indigo", "ocean_breeze", "sunset_saas" };
    int wallIdx = Math.Max(0, Math.Min(3, cmbBg.SelectedIndex));

    string json = string.Format(
      "{{\"captureMode\":\"{0}\",\"bgImagePath\":\"{1}\",\"editMode\":\"{2}\",\"aspectPreset\":\"{3}\",\"cameraMode\":\"{4}\",\"zoomPercent\":{5},\"minDollyPx\":{6},\"threeWayBlur\":{7},\"typingRamp\":{8},\"cursorSmooth\":\"high\",\"wallpaper\":\"{9}\",\"frameStyle\":\"{10}\",\"clickSfx\":{11},\"clickRipples\":{12},\"autoRig\":{13},\"autoZoom\":{14}}}",
      capMode, selectedBgPath, presetVals[Math.Max(0, cmbPreset.SelectedIndex)], aspectVals[Math.Max(0, cmbAspect.SelectedIndex)],
      camVals[Math.Max(0, cmbCam.SelectedIndex)], zoomVals[Math.Max(0, cmbZoom.SelectedIndex)], minDistVals[Math.Max(0, cmbMinDist.SelectedIndex)],
      chkBlur3Way.Checked ? "true" : "false", chkTypingRamp.Checked ? "true" : "false",
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
    string envRoot = Environment.GetEnvironmentVariable("PIXOPIK_REC_ROOT") ?? "";
    Application.Run(new PixopikRecorderApp(envRoot));
  }
}

public class MiniGhostBar : Form {
  Label lblInfo;
  public MiniGhostBar(PixopikRecorderApp app) {
    FormBorderStyle = FormBorderStyle.None; TopMost = true; ShowInTaskbar = false;
    Size = new Size(410, 42); StartPosition = FormStartPosition.Manual;
    Location = new Point((Screen.PrimaryScreen.Bounds.Width - 410) / 2, 8);
    BackColor = Color.FromArgb(16, 20, 29); Opacity = 0.95;

    lblInfo = new Label { Text = "● 00:00:00", Left = 12, Top = 0, Width = 225, Height = 42, ForeColor = Color.White, TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Consolas", 9.5f, FontStyle.Bold), Cursor = Cursors.SizeAll };
    lblInfo.MouseDown += (s, e) => { PixopikRecorderApp.ReleaseCapture(); PixopikRecorderApp.SendMessage(Handle, 0xA1, 0x2, 0); };
    Controls.Add(lblInfo);

    Button bPause = new Button { Text = "⏸", Left = 242, Top = 6, Width = 38, Height = 30, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White };
    bPause.Click += (s, e) => app.TogglePause(); Controls.Add(bPause);

    Button bStop = new Button { Text = "■ STOP (F12)", Left = 286, Top = 6, Width = 114, Height = 30, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(225, 29, 72), ForeColor = Color.White, Font = new Font("Segoe UI", 8.5f, FontStyle.Bold) };
    bStop.Click += (s, e) => app.ToggleRecord(); Controls.Add(bStop);

    Shown += (s, e) => { try { PixopikRecorderApp.SetWindowDisplayAffinity(Handle, 0x00000011); } catch {} };
  }
  public void UpdateTimer(string t, string res) { lblInfo.Text = "● " + t + " (" + res + ")"; }
}

public class HollowFrameForm : Form {
  PixopikRecorderApp parentApp;
  Label lblDim; Button btnRecBar;
  Color borderCol = Color.FromArgb(56, 189, 248);

  public HollowFrameForm(PixopikRecorderApp app) {
    parentApp = app; FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen;
    Size = new Size(1288, 762); TopMost = true; BackColor = Color.Magenta; TransparencyKey = Color.Magenta;

    Panel topBar = new Panel { Dock = DockStyle.Top, Height = 38, BackColor = Color.FromArgb(17, 21, 30), Cursor = Cursors.SizeAll };
    topBar.MouseDown += (s, e) => { PixopikRecorderApp.ReleaseCapture(); PixopikRecorderApp.SendMessage(Handle, 0xA1, 0x2, 0); };
    Controls.Add(topBar);

    ComboBox cmbSz = new ComboBox { Left = 8, Top = 7, Width = 145, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White };
    cmbSz.Items.AddRange(new object[] { "1280 x 720 (HD)", "1600 x 900", "1920 x 1080", "608 x 1080 (Short)" });
    cmbSz.SelectedIndex = 0;
    cmbSz.SelectedIndexChanged += (s, e) => {
      int[][] sz = { new[]{1280,720}, new[]{1600,900}, new[]{1920,1080}, new[]{608,1080} };
      var d = sz[cmbSz.SelectedIndex]; Size = new Size(d[0] + 8, d[1] + 42); Invalidate();
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

  public Rectangle GetInnerScreenRect() { Point tl = PointToScreen(new Point(4, 38)); return new Rectangle(tl.X, tl.Y, Width - 8, Height - 42); }
  public void SetRecState(bool rec) { borderCol = rec ? Color.FromArgb(239, 68, 68) : Color.FromArgb(56, 189, 248); btnRecBar.Text = rec ? "■ STOP" : "● REC (F12)"; Invalidate(); }
  public void UpdateTimerText(string t) { lblDim.Text = "● REC " + t; }
  protected override void OnPaint(PaintEventArgs e) { using (var pen = new Pen(borderCol, 4)) e.Graphics.DrawRectangle(pen, 2, 38, Width - 4, Height - 40); }
}
