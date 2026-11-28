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

  public string recRoot, ffmpegExe, signalFile, portFile, bdDataDir;
  string capMode = "fullscreen";
  int cropX = 160, cropY = 120, cropW = 1280, cropH = 720;

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

  Label lblTimer, lblSub;
  Button btnRec, btnPause;
  ComboBox cmbMode, cmbWin;
  CheckBox chkSendRawToAe, chkHideOnRec;
  Panel winBar;
  ListBox lstClips;
  HollowFrameForm rectFrame = null;
  MiniGhostBar miniBar = null;

  public PixopikRecorderApp(string customRoot) {
    recRoot = !string.IsNullOrWhiteSpace(customRoot)
      ? customRoot
      : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Videos", "PixopikRecordings");
    Directory.CreateDirectory(recRoot);
    Directory.CreateDirectory(Path.Combine(recRoot, "Screenshots"));
    signalFile = Path.Combine(recRoot, "native_done.signal");
    portFile   = Path.Combine(recRoot, "ae_bridge_port.txt");
    bdDataDir  = Directory.Exists(@"C:\Program Files\Bandicam\data") ? @"C:\Program Files\Bandicam\data" : @"C:\Program Files (x86)\Bandicam\data";
    ffmpegExe  = FindFfmpegSafe();

    Text = "Pixopik Simple Raw Recorder v5.0 (Clean Capture Only)";
    ClientSize = new Size(690, 360);
    MinimumSize = new Size(650, 340);
    StartPosition = FormStartPosition.CenterScreen;
    BackColor = Color.FromArgb(20, 25, 35);
    ForeColor = Color.FromArgb(236, 242, 250);
    Font = new Font("Segoe UI", 9.0f);

    BuildCleanRawUI();
    RegisterHotKey(Handle, 9001, 0, 0x7B); // F12
    RegisterHotKey(Handle, 9002, 4, 0x7B); // Shift+F12
    RegisterHotKey(Handle, 9003, 0, 0x7A); // F11

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
      if (action == "raw_ready" && !string.IsNullOrEmpty(sessionDir)) File.WriteAllText(signalFile, sessionDir, new UTF8Encoding(false));
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

  void BuildCleanRawUI() {
    /* 1. TOP RECORD BAR */
    Panel top = new Panel { Dock = DockStyle.Top, Height = 68, BackColor = Color.FromArgb(14, 18, 26), Padding = new Padding(12, 10, 12, 10) };

    FlowLayoutPanel rightCluster = new FlowLayoutPanel { Dock = DockStyle.Right, AutoSize = true, WrapContents = false };
    Panel timerStack = new Panel { Width = 175, Height = 48 };
    lblTimer = new Label { Text = "00:00:00", Dock = DockStyle.Top, Height = 28, TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.White, Font = new Font("Consolas", 14.0f, FontStyle.Bold) };
    lblSub   = new Label { Text = "F12: REC / Stop", Dock = DockStyle.Bottom, Height = 18, TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 7.8f, FontStyle.Bold) };
    timerStack.Controls.Add(lblTimer); timerStack.Controls.Add(lblSub);

    btnPause = new Button { Text = "⏸", Width = 42, Height = 44, Margin = new Padding(6, 2, 4, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnPause.Click += (s, e) => TogglePause();

    btnRec = new Button { Text = "● REC", Width = 96, Height = 44, Margin = new Padding(4, 2, 4, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(225, 29, 72), ForeColor = Color.White, Font = new Font("Segoe UI", 10.2f, FontStyle.Bold), Cursor = Cursors.Hand };
    btnRec.Click += (s, e) => ToggleRecord();

    Button btnShot = new Button { Text = "📷", Width = 42, Height = 44, Margin = new Padding(4, 2, 0, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnShot.Click += (s, e) => TakeScreenshot();
    rightCluster.Controls.AddRange(new Control[] { timerStack, btnPause, btnRec, btnShot });

    FlowLayoutPanel leftCluster = new FlowLayoutPanel { Dock = DockStyle.Left, AutoSize = true, WrapContents = false };
    cmbMode = new ComboBox { Width = 195, Margin = new Padding(0, 8, 6, 0), DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), FlatStyle = FlatStyle.Flat };
    cmbMode.Items.AddRange(new object[] {
      "⛶  Fullscreen (60 FPS)",
      "▭  Rectangle Frame",
      "✛  Select Area",
      "🗔  Specific Window"
    });
    cmbMode.SelectedIndex = 0;
    cmbMode.SelectedIndexChanged += (s, e) => OnModeChanged();

    Button btnChr = new Button { Text = "🧼 Chrome", Width = 78, Height = 38, Margin = new Padding(2, 5, 4, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnChr.Click += (s, e) => NotifyAeInstant("OPEN_CHROME", "");
    Button btnDraw = new Button { Text = "✏️ Draw", Width = 68, Height = 38, Margin = new Padding(2, 5, 0, 0), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White, Cursor = Cursors.Hand };
    btnDraw.Click += (s, e) => NotifyAeInstant("OPEN_GHOST", "");
    leftCluster.Controls.AddRange(new Control[] { cmbMode, btnChr, btnDraw });

    top.Controls.Add(rightCluster); top.Controls.Add(leftCluster);

    /* 2. FOOTER */
    Label footer = new Label {
      Dock = DockStyle.Bottom, Height = 26, BackColor = Color.FromArgb(13, 16, 23),
      ForeColor = Color.FromArgb(148, 163, 184), TextAlign = ContentAlignment.MiddleLeft,
      Text = "  Pure Raw 60 FPS Capture + Silent Telemetry  •  Apply Zoom, Dolly, Blur & SFX later inside AE Panel!"
    };

    /* 3. SIMPLE BODY */
    Panel body = new Panel { Dock = DockStyle.Fill, Padding = new Padding(14) };

    winBar = new Panel { Dock = DockStyle.Top, Height = 38, Visible = false };
    Button bRefW = new Button { Text = "↻ Refresh", Dock = DockStyle.Right, Width = 90, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(2, 132, 199), ForeColor = Color.White };
    bRefW.Click += (s, e) => RefreshWindows();
    cmbWin = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Color.FromArgb(30, 38, 54), ForeColor = Color.White };
    winBar.Controls.Add(cmbWin); winBar.Controls.Add(bRefW);

    FlowLayoutPanel optsRow = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 34, WrapContents = false };
    chkSendRawToAe = new CheckBox { Text = "📥 Send Raw Clip (Flat 100%) to After Effects on Stop", Checked = true, AutoSize = true, ForeColor = Color.White };
    chkHideOnRec   = new CheckBox { Text = "Minimize Recorder while capturing", Checked = true, AutoSize = true, Margin = new Padding(20, 3, 0, 0), ForeColor = Color.FromArgb(165, 180, 205) };
    optsRow.Controls.AddRange(new Control[] { chkSendRawToAe, chkHideOnRec });

    Label lClips = new Label { Text = "🎬 RECENT RAW RECORDINGS:", Dock = DockStyle.Top, Height = 22, ForeColor = Color.FromArgb(56, 189, 248), Font = new Font("Segoe UI", 8.5f, FontStyle.Bold) };
    lstClips = new ListBox { Dock = DockStyle.Fill, BackColor = Color.FromArgb(15, 19, 28), ForeColor = Color.White, Font = new Font("Consolas", 9.2f) };

    FlowLayoutPanel clipBtns = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 38 };
    Button bSend = new Button { Text = "📥 Send Selected Raw Clip to AE", Width = 215, Height = 32, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(79, 70, 229), ForeColor = Color.White };
    bSend.Click += (s, e) => {
      if (lstClips.SelectedItem != null) {
        string dir = Path.Combine(recRoot, lstClips.SelectedItem.ToString().Split('|')[0].Trim());
        NotifyAeInstant("raw_ready", dir); BringAfterEffectsToFront();
      }
    };
    Button bPlay = new Button { Text = "▶ Preview MP4", Width = 120, Height = 32, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White };
    bPlay.Click += (s, e) => { if (lstClips.SelectedItem != null) Process.Start("\"" + Path.Combine(recRoot, lstClips.SelectedItem.ToString().Split('|')[0].Trim(), "screen.mp4") + "\""); };
    Button bFold = new Button { Text = "📂 Open Folder", Width = 120, Height = 32, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White };
    bFold.Click += (s, e) => Process.Start("explorer.exe", "\"" + recRoot + "\"");
    clipBtns.Controls.AddRange(new Control[] { bSend, bPlay, bFold });

    body.Controls.Add(lstClips);
    body.Controls.Add(clipBtns);
    body.Controls.Add(lClips);
    body.Controls.Add(optsRow);
    body.Controls.Add(winBar);

    Controls.Add(body); Controls.Add(footer); Controls.Add(top);
    RefreshWindows(); RefreshClips();
  }

  void RefreshWindows() {
    cmbWin.Items.Clear();
    foreach (var p in Process.GetProcesses()) {
      try { if (!string.IsNullOrWhiteSpace(p.MainWindowTitle) && !p.MainWindowTitle.Contains("Pixopik")) cmbWin.Items.Add(p.Id + " | " + p.MainWindowTitle); } catch {}
    }
    if (cmbWin.Items.Count > 0) cmbWin.SelectedIndex = 0;
  }

  void RefreshClips() {
    lstClips.Items.Clear();
    var dirs = Directory.GetDirectories(recRoot, "rec_*");
    Array.Sort(dirs); Array.Reverse(dirs);
    foreach (var d in dirs) {
      string mp4 = Path.Combine(d, "screen.mp4");
      if (File.Exists(mp4)) {
        var fi = new FileInfo(mp4);
        lstClips.Items.Add(Path.GetFileName(d) + "  |  " + (fi.Length / 1048576.0).ToString("0.1") + " MB  |  " + fi.LastWriteTime.ToShortTimeString());
      }
    }
    if (lstClips.Items.Count > 0) lstClips.SelectedIndex = 0;
  }

  void OnModeChanged() {
    string[] modes = { "fullscreen", "rectangle", "select_area", "specific_window" };
    capMode = modes[cmbMode.SelectedIndex];
    winBar.Visible = (capMode == "specific_window");
    if (capMode == "rectangle") { if (rectFrame == null || rectFrame.IsDisposed) rectFrame = new HollowFrameForm(this); rectFrame.Show(); }
    else if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.Hide();
    if (capMode == "select_area") PickCrosshairArea();
    if (capMode == "specific_window") RefreshWindows();
  }

  public void UpdateRectFromFrame(Rectangle r) { cropX = Math.Max(0, r.X); cropY = Math.Max(0, r.Y); cropW = (r.Width / 2) * 2; cropH = (r.Height / 2) * 2; lblSub.Text = cropW + "x" + cropH + " Frame"; }

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
  public void TogglePause() { if (!isRecording) return; isPaused = !isPaused; lblSub.Text = isPaused ? "⏸ PAUSED" : "● REC 60 FPS"; }

  public void TakeScreenshot() {
    try {
      var b = Screen.PrimaryScreen.Bounds;
      string fn = Path.Combine(recRoot, "Screenshots", "shot_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".png");
      using (var bmp = new Bitmap(b.Width, b.Height)) using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(0, 0, 0, 0, bmp.Size); bmp.Save(fn); }
      PlayWav(Path.Combine(bdDataDir, "camera.wav")); lblSub.Text = "📷 Saved!";
    } catch {}
  }

  void PlayWav(string p) { try { if (File.Exists(p)) new System.Media.SoundPlayer(p).Play(); } catch {} }

  bool CheckAnyTypingKeyDown() {
    for (int i = 0; i < TYPING_VKEYS.Length; i++) if ((GetAsyncKeyState(TYPING_VKEYS[i]) & 0x8000) != 0) return true;
    return false;
  }

  string BuildTypingBurstsJson() {
    if (keyStrokeTimes.Count < 4) return "";
    var outList = new List<string>();
    double bStart = keyStrokeTimes[0], bPrev = keyStrokeTimes[0]; int count = 1;
    for (int i = 1; i < keyStrokeTimes.Count; i++) {
      double kt = keyStrokeTimes[i];
      if ((kt - bPrev) <= 1.35) { bPrev = kt; count++; }
      else {
        if (count >= 4 && (bPrev - bStart) >= 0.75) outList.Add("{\"tStart\":" + bStart.ToString(CultureInfo.InvariantCulture) + ",\"tEnd\":" + bPrev.ToString(CultureInfo.InvariantCulture) + ",\"keys\":" + count + "}");
        bStart = kt; bPrev = kt; count = 1;
      }
    }
    if (count >= 4 && (bPrev - bStart) >= 0.75) outList.Add("{\"tStart\":" + bStart.ToString(CultureInfo.InvariantCulture) + ",\"tEnd\":" + bPrev.ToString(CultureInfo.InvariantCulture) + ",\"keys\":" + count + "}");
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
      lblSub.Text = "● REC " + rw + "x" + rh;

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
    string mot = "{\"version\":\"5.0.0\",\"fps\":60,\"captureMode\":\"" + capMode + "\",\"screenWidth\":" + cropW + ",\"screenHeight\":" + cropH + ",\"duration\":" + durStr + ",\"samples\":[" + string.Join(",", sampleJson) + "],\"clicks\":[" + string.Join(",", clickJson) + "],\"typingBursts\":[" + burstsJson + "]}";
    File.WriteAllText(Path.Combine(curSessDir, "motion.json"), mot, new UTF8Encoding(false));
    File.WriteAllText(Path.Combine(curSessDir, "done.signal"), "OK", new UTF8Encoding(false));

    btnRec.Text = "● REC"; btnRec.BackColor = Color.FromArgb(225, 29, 72);
    if (rectFrame != null && !rectFrame.IsDisposed) rectFrame.SetRecState(false);
    RefreshClips();

    bool validMp4 = File.Exists(curMp4Path) && new FileInfo(curMp4Path).Length > 1024;
    if (chkSendRawToAe.Checked && validMp4) {
      lblSub.Text = "📥 Raw Clip Sent to AE!";
      WindowState = FormWindowState.Minimized;
      BringAfterEffectsToFront();
      NotifyAeInstant("raw_ready", curSessDir);
    } else {
      lblSub.Text = validMp4 ? "✅ Raw Clip Saved!" : "⚠️ Capture too short";
      WindowState = FormWindowState.Normal;
    }
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
