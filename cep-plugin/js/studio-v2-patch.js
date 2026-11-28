(function () {
  var fs   = require("fs");
  var path = require("path");
  var os   = require("os");
  var cp   = require("child_process");

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
  var REC_ROOT    = path.join(os.homedir(), "Videos", "PixopikRecordings");
  var NATIVE_EXE  = path.join(REC_ROOT, "PixopikRecorder_v32.exe");
  var DONE_SIG    = path.join(REC_ROOT, "native_done.signal");
  var CMD_SIG     = path.join(REC_ROOT, "native_cmd.txt");
  var PREFS_FILE  = path.join(REC_ROOT, "studio_v2_prefs.json");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

  function syncBadges() {
    var pill = document.getElementById("verPill") || document.querySelector(".pro-pill");
    if (pill) pill.textContent = "v3.2 EXE";
    var verSub = document.getElementById("verSubtitle");
    if (verSub) verSub.textContent = "Direct GDI 60fps • v3.2";
    var qBan = document.getElementById("quickBanner");
    if (qBan) qBan.textContent = "v3.2 Ready • Hybrid-GPU Safe 60fps Recorder (.EXE)";
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
    if (!csc || !fs.existsSync(CS_SRC)) {
      uiLog("Compiler or source missing: " + CS_SRC);
      return;
    }

    /* Kill any old v3.0 / v3.1 / v3.2 instance first */
    cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v31.exe"], function () {
      cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v32.exe"], function () {
        var needBuild = !fs.existsSync(NATIVE_EXE);
        if (!needBuild) {
          try { needBuild = fs.statSync(CS_SRC).mtimeMs > fs.statSync(NATIVE_EXE).mtimeMs; } catch (_e) { needBuild = true; }
        }

        function spawnExe() {
          cp.spawn(NATIVE_EXE, [], { detached: true, stdio: "ignore", cwd: REC_ROOT }).unref();
          uiLog("🚀 Launched PixopikRecorder v3.2 (Hybrid-GPU Safe 60 FPS)!");
        }

        if (!needBuild) { spawnExe(); return; }

        uiLog("⚡ Building PixopikRecorder v3.2...");
        cp.execFile(csc, [
          "/nologo",
          "/target:winexe",
          "/optimize+",
          "/r:System.Windows.Forms.dll",
          "/r:System.Drawing.dll",
          "/out:" + NATIVE_EXE,
          CS_SRC
        ], { timeout: 15000 }, function (err, stdout, stderr) {
          if (err && !fs.existsSync(NATIVE_EXE)) {
            uiLog("Compile error: " + (stderr || stdout || err.message));
            return;
          }
          uiLog("✅ Ready: PixopikRecorder_v32.exe");
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
        fs.writeFileSync(desk, '@echo off\r\nstart "" "' + NATIVE_EXE + '"\r\n', "utf8");
        uiLog("📌 Updated Desktop Shortcut to v3.2!");
      } catch (e) { uiLog("Shortcut note: " + e.message); }
    };
  }

  setInterval(function () {
    if (fs.existsSync(CMD_SIG)) {
      try {
        var cmd = fs.readFileSync(CMD_SIG, "utf8").trim();
        fs.unlinkSync(CMD_SIG);
        if (cmd === "OPEN_CHROME") { var bc = document.getElementById("btnLaunchChrome"); if (bc) bc.click(); }
        if (cmd === "OPEN_GHOST")  { var bg = document.getElementById("btnGhostBar"); if (bg) bg.click(); }
      } catch (_ec) {}
    }

    if (fs.existsSync(DONE_SIG)) {
      try {
        var sess = fs.readFileSync(DONE_SIG, "utf8").trim();
        fs.unlinkSync(DONE_SIG);
        if (sess && fs.existsSync(sess)) {
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
          uiLog("🎬 Recording saved! Auto-Rigging in After Effects...");
          var rigBtn = document.getElementById("btnRigLatest");
          if (rigBtn) setTimeout(function () { rigBtn.click(); }, 200);
        }
      } catch (_ed) {}
    }
  }, 450);
})();
