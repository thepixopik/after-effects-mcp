(function () {
  var fs   = require("fs");
  var path = require("path");
  var os   = require("os");
  var cp   = require("child_process");
  var http = require("http");

  function getExtRoot() {
    var raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath)
      ? window.__adobe_cep__.getSystemPath("extension")
      : decodeURI(window.location.pathname || "");
    raw = raw.replace(/^file:\/+/i, "");
    if (/^\/[A-Za-z]:/.test(raw)) raw = raw.slice(1);
    return path.normalize(decodeURIComponent(raw));
  }

  var EXT_ROOT    = getExtRoot();
  var STEADY_JSX  = path.join(EXT_ROOT, "jsx", "steady-camera-v2.jsx");
  var CS_SRC      = path.join(EXT_ROOT, "recorder", "PixopikRecorder.cs");
  var REC_ROOT    = path.join(process.env.USERPROFILE || os.homedir(), "Videos", "PixopikRecordings");
  var NATIVE_EXE  = path.join(REC_ROOT, "PixopikRecorder_v33.exe");
  var DONE_SIG    = path.join(REC_ROOT, "native_done.signal");
  var PORT_FILE   = path.join(REC_ROOT, "ae_bridge_port.txt");
  var PREFS_FILE  = path.join(REC_ROOT, "studio_v2_prefs.json");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

  function syncBadges() {
    var pill = document.getElementById("verPill") || document.querySelector(".pro-pill");
    if (pill) pill.textContent = "v3.3 EXE";
    var verSub = document.getElementById("verSubtitle");
    if (verSub) verSub.textContent = "Instant Auto-Rig • v3.3";
    var qBan = document.getElementById("quickBanner");
    if (qBan) qBan.textContent = "v3.3 Ready • Stop (F12) Instantly Opens AE Composition!";
  }
  syncBadges();
  setTimeout(syncBadges, 300);
  setTimeout(syncBadges, 1200);

  function uiLog(msg) {
    var logList = document.getElementById("logList");
    if (!logList) return;
    var row = document.createElement("div");
    row.className = "log-item ok";
    row.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
    logList.insertBefore(row, logList.firstChild);
  }

  function injectSteadyJsx() {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function" && fs.existsSync(STEADY_JSX)) {
      var p = STEADY_JSX.replace(/\\/g, "/");
      window.__adobe_cep__.evalScript('try { $.evalFile(new File("' + p + '")); } catch(_e) {}');
    }
  }
  setTimeout(injectSteadyJsx, 450);
  setTimeout(injectSteadyJsx, 1800);

  var lastRiggedSess = "";
  function triggerAutoRigForSession(sessDir) {
    if (!sessDir || sessDir === lastRiggedSess) return;
    lastRiggedSess = sessDir;
    try { if (fs.existsSync(DONE_SIG)) fs.unlinkSync(DONE_SIG); } catch (_e) {}

    injectSteadyJsx();
    var prefs = {};
    try { if (fs.existsSync(PREFS_FILE)) prefs = JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")); } catch (_ep) {}
    try {
      if (prefs.editMode && document.getElementById("modeSelect")) document.getElementById("modeSelect").value = prefs.editMode;
      if (prefs.aspectPreset && document.getElementById("aspectSelect")) document.getElementById("aspectSelect").value = prefs.aspectPreset;
      if (prefs.wallpaper && document.getElementById("wallpaperSelect")) document.getElementById("wallpaperSelect").value = prefs.wallpaper;
      if (prefs.frameStyle && document.getElementById("frameStyleSelect")) document.getElementById("frameStyleSelect").value = prefs.frameStyle;
      if (typeof prefs.clickSfx === "boolean" && document.getElementById("chkClickSfx")) document.getElementById("chkClickSfx").checked = prefs.clickSfx;
      if (typeof prefs.clickRipples === "boolean" && document.getElementById("chkRipples")) document.getElementById("chkRipples").checked = prefs.clickRipples;
      if (typeof prefs.autoZoom === "boolean" && document.getElementById("chkAutoZoom")) document.getElementById("chkAutoZoom").checked = prefs.autoZoom;
    } catch (_es) {}

    uiLog("🎬 Auto-Importing recording into After Effects: " + path.basename(sessDir));
    var rigBtn = document.getElementById("btnRigLatest");
    if (rigBtn) setTimeout(function () { rigBtn.click(); }, 180);
  }

  /* Unthrottled Node libuv TCP Bridge — fires in 0.5ms even when AE was in background! */
  var bridgeSrv = http.createServer(function (req, res) {
    if (req.method === "POST" && req.url === "/bridge") {
      var body = "";
      req.on("data", function (c) { body += c; });
      req.on("end", function () {
        try {
          var d = JSON.parse(body || "{}");
          if (d.action === "auto_rig") triggerAutoRigForSession(d.sessionDir);
          else if (d.action === "OPEN_CHROME") { var bc = document.getElementById("btnLaunchChrome"); if (bc) bc.click(); }
          else if (d.action === "OPEN_GHOST")  { var bg = document.getElementById("btnGhostBar"); if (bg) bg.click(); }
        } catch (_eb) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  bridgeSrv.listen(0, "127.0.0.1", function () {
    try { fs.writeFileSync(PORT_FILE, String(bridgeSrv.address().port), "utf8"); } catch (_ep) {}
  });

  /* Also watch REC_ROOT via native libuv fs.watch + window focus backup */
  try {
    fs.watch(REC_ROOT, function (_ev, fname) {
      if (fname === "native_done.signal" && fs.existsSync(DONE_SIG)) {
        try { triggerAutoRigForSession(fs.readFileSync(DONE_SIG, "utf8").trim()); } catch (_ew) {}
      }
    });
  } catch (_ew2) {}

  window.addEventListener("focus", function () {
    if (fs.existsSync(DONE_SIG)) {
      try { triggerAutoRigForSession(fs.readFileSync(DONE_SIG, "utf8").trim()); } catch (_ef) {}
    }
  });

  function findCscCompiler() {
    var winDir = process.env.WINDIR || "C:\\Windows";
    var cands = [
      path.join(winDir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
      path.join(winDir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
    ];
    for (var i = 0; i < cands.length; i++) if (fs.existsSync(cands[i])) return cands[i];
    return null;
  }

  function buildAndLaunchNativeExe() {
    var csc = findCscCompiler();
    if (!csc || !fs.existsSync(CS_SRC)) { uiLog("Compiler missing: " + CS_SRC); return; }

    cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v32.exe"], function () {
      cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v33.exe"], function () {
        var needBuild = !fs.existsSync(NATIVE_EXE);
        if (!needBuild) {
          try { needBuild = fs.statSync(CS_SRC).mtimeMs > fs.statSync(NATIVE_EXE).mtimeMs; } catch (_e) { needBuild = true; }
        }

        function spawnExe() {
          var envCopy = Object.assign({}, process.env, { PIXOPIK_REC_ROOT: REC_ROOT });
          cp.spawn(NATIVE_EXE, [], { detached: true, stdio: "ignore", cwd: REC_ROOT, env: envCopy }).unref();
          uiLog("🚀 Launched PixopikRecorder v3.3 (Stop = Instant AE Auto-Rig)!");
        }

        if (!needBuild) { spawnExe(); return; }

        uiLog("⚡ Building PixopikRecorder v3.3...");
        cp.execFile(csc, [
          "/nologo", "/target:winexe", "/optimize+",
          "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.dll",
          "/out:" + NATIVE_EXE, CS_SRC
        ], { timeout: 15000 }, function (err, stdout, stderr) {
          if (err && !fs.existsSync(NATIVE_EXE)) {
            uiLog("Compile error: " + (stderr || stdout || err.message));
            return;
          }
          uiLog("✅ Ready: PixopikRecorder_v33.exe");
          spawnExe();
        });
      });
    });
  }

  var studioBtn = document.getElementById("btnOpenRecorderStudio");
  if (studioBtn) studioBtn.onclick = buildAndLaunchNativeExe;

  var deskBtn = document.getElementById("btnPinDesktopShortcut");
  if (deskBtn) {
    deskBtn.onclick = function () {
      var desk = path.join(os.homedir(), "Desktop", "Launch Pixopik Recorder.bat");
      try {
        fs.writeFileSync(desk, '@echo off\r\nset "PIXOPIK_REC_ROOT=' + REC_ROOT + '"\r\nstart "" "' + NATIVE_EXE + '"\r\n', "utf8");
        uiLog("📌 Updated Desktop Shortcut to v3.3!");
      } catch (e) { uiLog("Shortcut note: " + e.message); }
    };
  }
})();
