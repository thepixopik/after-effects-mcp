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
  var STUDIO_HTML = path.join(EXT_ROOT, "recorder-studio.html");
  var CAP_PS1     = path.join(EXT_ROOT, "recorder", "capture-session.ps1");
  var REC_ROOT    = path.join(os.homedir(), "Videos", "PixopikRecordings");
  var PREFS_FILE  = path.join(REC_ROOT, "studio_v2_prefs.json");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

  function findBandicamDir() {
    var cands = [
      "C:\\Program Files\\Bandicam",
      "C:\\Program Files (x86)\\Bandicam",
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Bandicam")
    ];
    for (var i = 0; i < cands.length; i++) {
      if (fs.existsSync(path.join(cands[i], "bdcam.exe"))) return cands[i];
    }
    return null;
  }

  function syncHeaderBadges() {
    var pill = document.getElementById("verPill") || document.querySelector(".pro-pill");
    if (pill) pill.textContent = "v2.3";
    var verSub = document.getElementById("verSubtitle");
    if (verSub) verSub.textContent = "Bandicam Bridge & AE Hub";
    var qBan = document.getElementById("quickBanner");
    if (qBan && qBan.textContent.indexOf("1.6") !== -1) {
      qBan.textContent = "v2.3 Live • Real Bandicam Bridge + 31 HD Wallpapers";
    }
  }
  syncHeaderBadges();
  setTimeout(syncHeaderBadges, 250);
  setTimeout(syncHeaderBadges, 1200);

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

  /* =========================================================================
   * REAL BANDICAM.EXE LIVE WATCHER & TELEMETRY AUTO-RIG BRIDGE!
   * ========================================================================= */
  var bdBridgeActive = false;
  var bdWatchTimer   = null;
  var bdTrackProc    = null;
  var bdActiveMp4    = "";
  var bdActiveSess   = "";
  var bdLastSize     = -1;
  var bdStableTicks  = 0;
  var bdStartMs      = 0;

  function resolveBandicamOutputDirs(cb) {
    var dirs = [
      path.join(os.homedir(), "Documents", "Bandicam"),
      path.join(os.homedir(), "Videos", "Bandicam")
    ];
    var ps = "(Get-ItemProperty -Path 'HKCU:\\Software\\BANDISOFT\\BANDICAM\\OPTION' -ErrorAction SilentlyContinue).sOutputFolder";
    cp.execFile("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 2500 }, function (_e, out) {
      var regDir = (out || "").trim();
      if (regDir && fs.existsSync(regDir) && dirs.indexOf(regDir) === -1) dirs.unshift(regDir);
      cb(dirs.filter(function (d) { return fs.existsSync(d); }));
    });
  }

  function startRealBandicamBridge() {
    var bdDir = findBandicamDir();
    var btn = document.getElementById("btnRealBandicamBridge");
    if (!bdDir) {
      uiLog("Bandicam not found at C:\\Program Files\\Bandicam — opening built-in Studio instead!");
      var sb = document.getElementById("btnOpenRecorderStudio"); if (sb) sb.click();
      return;
    }

    if (bdBridgeActive) {
      bdBridgeActive = false;
      if (bdWatchTimer) clearInterval(bdWatchTimer);
      if (btn) { btn.classList.remove("active-watch"); btn.textContent = "🎯 Record via Real Bandicam.exe + Auto-Rig AE"; }
      uiLog("Stopped Bandicam Auto-Rig watcher.");
      return;
    }

    /* Launch bdcam.exe if not already running */
    cp.execFile("tasklist.exe", ["/FI", "IMAGENAME eq bdcam.exe"], function (_e, out) {
      if (!out || out.toLowerCase().indexOf("bdcam.exe") === -1) {
        cp.spawn(path.join(bdDir, "bdcam.exe"), [], { detached: true, stdio: "ignore" }).unref();
        uiLog("Launched real Bandicam (bdcam.exe)!");
      } else {
        uiLog("Connected to running Bandicam (bdcam.exe)! Press REC / F12 in Bandicam.");
      }
    });

    bdBridgeActive = true;
    bdStartMs = Date.now() - 500;
    bdActiveMp4 = "";
    if (btn) { btn.classList.add("active-watch"); btn.textContent = "🟢 Watching Bandicam (Press REC / F12 in Bandicam!)"; }
    var qBan = document.getElementById("quickBanner");
    if (qBan) qBan.textContent = "🟢 Bandicam Bridge Active • Record in Bandicam -> Auto-Rigs in AE!";

    resolveBandicamOutputDirs(function (watchDirs) {
      if (!watchDirs.length) {
        var defD = path.join(os.homedir(), "Documents", "Bandicam");
        try { fs.mkdirSync(defD, { recursive: true }); } catch (_ed) {}
        watchDirs = [defD];
      }
      uiLog("Watching Bandicam output: " + watchDirs[0]);

      bdWatchTimer = setInterval(function () {
        if (!bdBridgeActive) return;

        /* Step 1: Detect newly started Bandicam MP4 recording */
        if (!bdActiveMp4) {
          for (var d = 0; d < watchDirs.length; d++) {
            var files = [];
            try { files = fs.readdirSync(watchDirs[d]); } catch (_ef) {}
            for (var f = 0; f < files.length; f++) {
              if (!/\.(mp4|avi)$/i.test(files[f])) continue;
              var fullP = path.join(watchDirs[d], files[f]);
              try {
                var st = fs.statSync(fullP);
                if (st.birthtimeMs >= bdStartMs || st.mtimeMs >= bdStartMs) {
                  bdActiveMp4 = fullP;
                  bdLastSize = st.size;
                  bdStableTicks = 0;
                  bdActiveSess = path.join(REC_ROOT, "rec_bdcam_" + Date.now());
                  fs.mkdirSync(bdActiveSess, { recursive: true });
                  bdTrackProc = cp.spawn("powershell.exe", [
                    "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA",
                    "-File", CAP_PS1, "-SessionDir", bdActiveSess, "-PickMode", "track_only"
                  ], { windowsHide: true });
                  uiLog("🔴 Bandicam recording detected (" + files[f] + ") — tracking 60Hz cursor & clicks!");
                  if (btn) btn.textContent = "🔴 Recording in Bandicam... (Stop / F12 to Auto-Rig!)";
                  break;
                }
              } catch (_es) {}
            }
            if (bdActiveMp4) break;
          }
          return;
        }

        /* Step 2: Detect when Bandicam finishes finalizing the MP4 */
        try {
          var curSt = fs.statSync(bdActiveMp4);
          if (curSt.size > 8192 && curSt.size === bdLastSize) {
            /* Test exclusive read/write lock to confirm Bandicam closed the file */
            var fd = fs.openSync(bdActiveMp4, "r+");
            fs.closeSync(fd);
            bdStableTicks++;
          } else {
            bdLastSize = curSt.size;
            bdStableTicks = 0;
          }

          if (bdStableTicks >= 2) {
            var finishedMp4  = bdActiveMp4;
            var finishedSess = bdActiveSess;
            bdActiveMp4 = "";
            bdStartMs = Date.now() + 500;

            /* Stop cursor tracker & copy MP4 into PixopikRecordings session */
            try { fs.writeFileSync(path.join(finishedSess, "stop.signal"), "STOP", "utf8"); } catch (_ew) {}
            setTimeout(function () {
              try {
                fs.copyFileSync(finishedMp4, path.join(finishedSess, "screen.mp4"));
                uiLog("✅ Imported Bandicam MP4 + Cursor Telemetry! Auto-Rigging in AE...");
                if (btn) btn.textContent = "🟢 Watching Bandicam (Press REC / F12 for Next Take)";
                injectSteadyJsx();
                var rigBtn = document.getElementById("btnRigLatest");
                if (rigBtn) rigBtn.click();
              } catch (copyErr) {
                uiLog("Copy error: " + copyErr.message);
              }
            }, 650);
          }
        } catch (_lockErr) {
          /* File still locked by bdcam.exe while recording — keep tracking! */
          bdStableTicks = 0;
        }
      }, 650);
    });
  }

  var bdBtn = document.getElementById("btnRealBandicamBridge");
  if (bdBtn) bdBtn.onclick = startRealBandicamBridge;

  function findAppBrowserExe() {
    var candidates = [
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe")
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && fs.existsSync(candidates[i])) return candidates[i];
    }
    return null;
  }

  function listOpenWindows(cb) {
    var ps = "Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.ProcessName -notmatch 'TextInputHost|ApplicationFrameHost' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress";
    cp.execFile("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 3500 }, function (_err, stdout) {
      try {
        var raw = JSON.parse((stdout || "[]").trim() || "[]");
        var arr = Array.isArray(raw) ? raw : [raw];
        cb(arr.filter(function (w) { return w && w.MainWindowTitle && w.MainWindowTitle.indexOf("Pixopik") === -1; }));
      } catch (_e) { cb([]); }
    });
  }

  function listRecordedVideos() {
    try {
      var dirs = fs.readdirSync(REC_ROOT).filter(function (d) { return d.indexOf("rec_") === 0; }).sort().reverse().slice(0, 18);
      var out = [];
      for (var i = 0; i < dirs.length; i++) {
        var mp4 = path.join(REC_ROOT, dirs[i], "screen.mp4");
        var mot = path.join(REC_ROOT, dirs[i], "motion.json");
        if (fs.existsSync(mp4)) {
          var st = fs.statSync(mp4);
          var meta = {};
          try { if (fs.existsSync(mot)) meta = JSON.parse(fs.readFileSync(mot, "utf8")); } catch (_m) {}
          out.push({
            id: dirs[i],
            sizeMb: (st.size / (1024 * 1024)).toFixed(1),
            res: (meta.screenWidth || 1920) + "x" + (meta.screenHeight || 1080),
            dur: meta.duration ? (Math.round(meta.duration) + "s") : ""
          });
        }
      }
      return out;
    } catch (_e) { return []; }
  }

  function listBandicamWallpapers() {
    var bdDir = findBandicamDir();
    if (!bdDir) return [];
    var bgDir = path.join(bdDir, "data", "bg");
    if (!fs.existsSync(bgDir)) return [];
    try {
      return fs.readdirSync(bgDir)
        .filter(function (f) { return /^bg\d+\.jpg$/i.test(f); })
        .sort(function (a, b) { return parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10); })
        .map(function (f) { return { file: f, fullPath: path.join(bgDir, f) }; });
    } catch (_e) { return []; }
  }

  function runPicker(mode, w, h, cb) {
    var outJson = path.join(REC_ROOT, "picked_region.json");
    try { if (fs.existsSync(outJson)) fs.unlinkSync(outJson); } catch (_e) {}
    var args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", CAP_PS1, "-SessionDir", REC_ROOT, "-PickMode", mode];
    if (w && h) args.push("-InitW", String(w), "-InitH", String(h));
    var p = cp.spawn("powershell.exe", args, { windowsHide: false });
    p.on("close", function () {
      try { if (fs.existsSync(outJson)) { cb(JSON.parse(fs.readFileSync(outJson, "utf8"))); return; } } catch (_er) {}
      cb({ ok: false });
    });
  }

  function applyStudioPrefsAndStart(prefs) {
    injectSteadyJsx();
    try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs || {}), "utf8"); } catch (_ew) {}
    try {
      if (prefs.editMode && document.getElementById("modeSelect")) document.getElementById("modeSelect").value = prefs.editMode;
      if (prefs.aspectPreset && document.getElementById("aspectSelect")) document.getElementById("aspectSelect").value = prefs.aspectPreset;
      if (prefs.wallpaper && document.getElementById("wallpaperSelect")) document.getElementById("wallpaperSelect").value = prefs.wallpaper;
      if (prefs.frameStyle && document.getElementById("frameStyleSelect")) document.getElementById("frameStyleSelect").value = prefs.frameStyle;
      if (typeof prefs.countdown !== "undefined" && document.getElementById("countdownSelect")) document.getElementById("countdownSelect").value = String(prefs.countdown);
      if (typeof prefs.clickSfx === "boolean" && document.getElementById("chkClickSfx")) document.getElementById("chkClickSfx").checked = prefs.clickSfx;
      if (typeof prefs.clickRipples === "boolean" && document.getElementById("chkRipples")) document.getElementById("chkRipples").checked = prefs.clickRipples;
      if (typeof prefs.autoRig === "boolean" && document.getElementById("chkAutoRigOnStop")) document.getElementById("chkAutoRigOnStop").checked = prefs.autoRig;
      if (typeof prefs.autoZoom === "boolean" && document.getElementById("chkAutoZoom")) document.getElementById("chkAutoZoom").checked = prefs.autoZoom;
      if (prefs.cameraMode && document.getElementById("cameraModeSelect")) {
        document.getElementById("cameraModeSelect").value = (prefs.cameraMode === "click_bounce") ? "click_bounce" : "smooth_travel";
      }
    } catch (_es) {}
    var recBtn = document.getElementById("btnRecord");
    if (recBtn) setTimeout(function () { recBtn.click(); }, 120);
  }

  var studioPort = 0;
  var srv = http.createServer(function (req, res) {
    if (req.method === "GET" && (req.url === "/" || req.url.indexOf("/studio") === 0)) {
      try {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(fs.readFileSync(STUDIO_HTML, "utf8"));
      } catch (e) { res.writeHead(500); res.end(e.message); }
      return;
    }
    if (req.method === "GET" && req.url.indexOf("/bdcam_bg/") === 0) {
      var bd = findBandicamDir();
      var fname = path.basename(req.url.split("?")[0]);
      var imgP = bd ? path.join(bd, "data", "bg", fname) : "";
      if (imgP && fs.existsSync(imgP)) {
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        res.end(fs.readFileSync(imgP));
      } else { res.writeHead(404); res.end(); }
      return;
    }
    if (req.method === "GET" && req.url === "/api/bandicam_info") {
      var bd2 = findBandicamDir();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ installed: !!bd2, bridgeActive: bdBridgeActive, wallpapers: listBandicamWallpapers() }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/windows") {
      listOpenWindows(function (wins) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, windows: wins }));
      });
      return;
    }
    if (req.method === "GET" && req.url === "/api/videos") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, folder: REC_ROOT, videos: listRecordedVideos() }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/action") {
      var body = "";
      req.on("data", function (c) { body += c; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body || "{}");
          if (data.action === "pick_area" || data.action === "pick_rect") {
            runPicker(data.action === "pick_area" ? "area" : "rect", data.w || 1280, data.h || 720, function (r) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(r));
            });
            return;
          }
          if (data.action === "screenshot") {
            var bd3 = findBandicamDir();
            if (bd3 && fs.existsSync(path.join(bd3, "data", "camera.wav"))) {
              cp.execFile("powershell.exe", ["-NoProfile", "-Command", "(New-Object System.Media.SoundPlayer 'C:\\Program Files\\Bandicam\\data\\camera.wav').PlaySync()"]);
            }
            runPicker("screenshot", 0, 0, function () {
              uiLog("📷 Saved PNG screenshot with Bandicam shutter sound!");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }
          if (data.action === "save_prefs") {
            try { fs.writeFileSync(PREFS_FILE, JSON.stringify(data.prefs || {}), "utf8"); } catch (_ep) {}
          } else if (data.action === "launch_real_bandicam") {
            if (data.prefs) { try { fs.writeFileSync(PREFS_FILE, JSON.stringify(data.prefs), "utf8"); } catch (_ep2) {} }
            startRealBandicamBridge();
          } else if (data.action === "open_folder") {
            cp.spawn("explorer.exe", [REC_ROOT], { detached: true, stdio: "ignore" }).unref();
          } else if (data.action === "open_chrome") {
            var bc = document.getElementById("btnLaunchChrome"); if (bc) bc.click();
          } else if (data.action === "open_ghost") {
            var bg = document.getElementById("btnGhostBar"); if (bg) bg.click();
          } else if (data.action === "set_dim") {
            var ds = document.getElementById("ghostDimSelect");
            if (ds) { ds.value = String(data.pct || "0"); if (ds.onchange) ds.onchange(); }
          } else if (data.action === "rig_latest") {
            injectSteadyJsx();
            var rl = document.getElementById("btnRigLatest"); if (rl) rl.click();
          } else if (data.action === "start_record") {
            applyStudioPrefsAndStart(data.prefs || {});
          } else if (data.action === "stop_record") {
            var bs = document.getElementById("btnStop"); if (bs) bs.click();
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, bridgeActive: bdBridgeActive }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end("Not found");
  });

  srv.listen(0, "127.0.0.1", function () { studioPort = srv.address().port; });

  var studioBtn = document.getElementById("btnOpenRecorderStudio");
  if (studioBtn) {
    studioBtn.onclick = function () {
      if (!studioPort) { uiLog("Studio bridge starting..."); return; }
      var appUrl = "http://127.0.0.1:" + studioPort + "/studio?t=" + Date.now();
      var exe = findAppBrowserExe();
      if (exe) {
        cp.spawn(exe, ["--app=" + appUrl, "--window-size=780,545", "--window-position=500,155"], { detached: true, stdio: "ignore" }).unref();
        uiLog("Opened Pixopik Recorder Studio v2.3!");
      } else {
        window.open(appUrl, "PixopikRecorderStudio", "width=780,height=545");
      }
    };
  }
})();
