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
  var NATIVE_EXE  = path.join(REC_ROOT, "PixopikRecorder_v40.exe");
  var DONE_SIG    = path.join(REC_ROOT, "native_done.signal");
  var PORT_FILE   = path.join(REC_ROOT, "ae_bridge_port.txt");
  var PREFS_FILE  = path.join(REC_ROOT, "studio_v2_prefs.json");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

  function syncBadges() {
    var pill = document.getElementById("verPill") || document.querySelector(".pro-pill");
    if (pill) pill.textContent = "v4.0";
    var verSub = document.getElementById("verSubtitle");
    if (verSub) verSub.textContent = "FocuSee 3-Layer Cinema • v4.0";
    var qBan = document.getElementById("quickBanner");
    if (qBan) qBan.textContent = "v4.0 FocuSee Engine • Click Zoom + Cursor Dolly + Typing Motion Blur";
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

  function injectSteadyJsx(cb) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function" && fs.existsSync(STEADY_JSX)) {
      var p = STEADY_JSX.replace(/\\/g, "/");
      window.__adobe_cep__.evalScript('try { $.evalFile(new File("' + p + '")); "OK"; } catch(e) { "ERR:" + e; }', function (res) {
        if (cb) cb(res);
      });
    }
  }

  function findLatestMotionJson() {
    try {
      if (!fs.existsSync(REC_ROOT)) return "";
      var dirs = fs.readdirSync(REC_ROOT).filter(function (d) { return d.indexOf("rec_") === 0; }).sort().reverse();
      for (var i = 0; i < dirs.length; i++) {
        var mp = path.join(REC_ROOT, dirs[i], "motion.json");
        if (fs.existsSync(mp)) return mp.replace(/\\/g, "/");
      }
    } catch (_e) {}
    return "";
  }

  var presetSel = document.getElementById("dollyDistPreset");
  var customInp = document.getElementById("dollyDistCustom");
  var applyBtn  = document.getElementById("btnApplyDollyDist");
  var chkClick  = document.getElementById("chkClickZoomPunch");
  var chkBlur   = document.getElementById("chk3WayBlur");
  var chkType   = document.getElementById("chkTypingRamp");

  function getSelectedMinPx() {
    if (customInp && parseInt(customInp.value, 10) >= 80) return parseInt(customInp.value, 10);
    try {
      if (fs.existsSync(PREFS_FILE)) {
        var p = JSON.parse(fs.readFileSync(PREFS_FILE, "utf8"));
        if (p.minDollyPx) return parseInt(p.minDollyPx, 10);
      }
    } catch (_e) {}
    return 550;
  }

  var applyingNow = false;
  function applyFocuSeeToOpenComp(pxVal, autoSilent, explicitMotionPath) {
    if (applyingNow) return;
    applyingNow = true;
    var minPx = parseInt(pxVal, 10) || getSelectedMinPx();
    var opts = {
      minDollyPx: minPx,
      zoomPercent: 148,
      clickZoomPunch: chkClick ? chkClick.checked : true,
      threeWayBlur: chkBlur ? chkBlur.checked : true,
      typingRamp: chkType ? chkType.checked : true,
      motionPath: explicitMotionPath || findLatestMotionJson()
    };

    try {
      var curP = fs.existsSync(PREFS_FILE) ? JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")) : {};
      curP.minDollyPx = minPx;
      curP.threeWayBlur = opts.threeWayBlur;
      curP.typingRamp = opts.typingRamp;
      fs.writeFileSync(PREFS_FILE, JSON.stringify(curP), "utf8");
    } catch (_ep) {}

    injectSteadyJsx(function () {
      if (!window.__adobe_cep__) { applyingNow = false; return; }
      var argStr = JSON.stringify(JSON.stringify(opts));
      window.__adobe_cep__.evalScript("$.global.PixopikApplyFocuSeeEngine(" + argStr + ")", function (raw) {
        applyingNow = false;
        try {
          var r = JSON.parse(raw || "{}");
          if (r && r.ok) {
            var extra = r.typingRamps ? (" • " + r.typingRamps + " typing speed-ramps!") : "";
            uiLog("🌀 FocuSee v4.0 (" + r.minDistPx + "px Dolly, " + r.clickPunches + " click-zooms, " + r.glides + " glides, 3-Way Blur ON" + extra + ")");
          } else if (!autoSilent && r && r.error) {
            uiLog("Note: " + r.error);
          }
        } catch (_er) {}
      });
    });
  }

  /* 1. Auto-upgrade currently open composition right on v4.0 Sync! */
  setTimeout(function () { applyFocuSeeToOpenComp(getSelectedMinPx(), true); }, 750);

  /* 2. Auto-apply FocuSee Engine immediately after EVERY panel.js 'Rigged in X.XXs' event! */
  var lastSessMotion = "";
  var logContainer = document.getElementById("logList");
  if (logContainer && typeof MutationObserver !== "undefined") {
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var txt = added[j].textContent || "";
          if (txt.indexOf("Rigged in ") !== -1) {
            var mp = lastSessMotion || findLatestMotionJson();
            setTimeout(function () { applyFocuSeeToOpenComp(getSelectedMinPx(), false, mp); }, 150);
            return;
          }
        }
      }
    });
    obs.observe(logContainer, { childList: true });
  }

  /* 3. Wire UI controls */
  if (presetSel && customInp) {
    presetSel.onchange = function () {
      customInp.value = presetSel.value;
      applyFocuSeeToOpenComp(presetSel.value, false);
    };
  }
  if (applyBtn && customInp) applyBtn.onclick = function () { applyFocuSeeToOpenComp(customInp.value, false); };
  if (chkClick) chkClick.onchange = function () { applyFocuSeeToOpenComp(getSelectedMinPx(), false); };
  if (chkBlur)  chkBlur.onchange  = function () { applyFocuSeeToOpenComp(getSelectedMinPx(), false); };
  if (chkType)  chkType.onchange  = function () { applyFocuSeeToOpenComp(getSelectedMinPx(), false); };

  var fixBtn = document.getElementById("btnSmoothTravel");
  if (fixBtn) {
    fixBtn.onclick = function (ev) {
      if (ev && ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      applyFocuSeeToOpenComp(getSelectedMinPx(), false);
    };
  }

  var lastRiggedSess = "";
  function triggerAutoRigForSession(sessDir) {
    if (!sessDir || sessDir === lastRiggedSess) return;
    lastRiggedSess = sessDir;
    lastSessMotion = path.join(sessDir, "motion.json").replace(/\\/g, "/");
    try { if (fs.existsSync(DONE_SIG)) fs.unlinkSync(DONE_SIG); } catch (_e) {}

    var prefs = {};
    try { if (fs.existsSync(PREFS_FILE)) prefs = JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")); } catch (_ep) {}
    if (prefs.minDollyPx && customInp) customInp.value = String(prefs.minDollyPx);
    if (typeof prefs.threeWayBlur === "boolean" && chkBlur) chkBlur.checked = prefs.threeWayBlur;
    if (typeof prefs.typingRamp === "boolean" && chkType) chkType.checked = prefs.typingRamp;
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

    cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v34.exe"], function () {
      cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v40.exe"], function () {
        var needBuild = !fs.existsSync(NATIVE_EXE);
        if (!needBuild) {
          try { needBuild = fs.statSync(CS_SRC).mtimeMs > fs.statSync(NATIVE_EXE).mtimeMs; } catch (_e) { needBuild = true; }
        }
        function spawnExe() {
          var envCopy = Object.assign({}, process.env, { PIXOPIK_REC_ROOT: REC_ROOT });
          cp.spawn(NATIVE_EXE, [], { detached: true, stdio: "ignore", cwd: REC_ROOT, env: envCopy }).unref();
          uiLog("🚀 Launched PixopikRecorder v4.0 (FocuSee Engine)!");
        }
        if (!needBuild) { spawnExe(); return; }
        uiLog("⚡ Building PixopikRecorder v4.0...");
        cp.execFile(csc, [
          "/nologo", "/target:winexe", "/optimize+",
          "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.dll",
          "/out:" + NATIVE_EXE, CS_SRC
        ], { timeout: 15000 }, function (err, stdout, stderr) {
          if (err && !fs.existsSync(NATIVE_EXE)) { uiLog("Compile error: " + (stderr || stdout || err.message)); return; }
          uiLog("✅ Ready: PixopikRecorder_v40.exe");
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
        uiLog("📌 Updated Desktop Shortcut to v4.0!");
      } catch (e) { uiLog("Shortcut note: " + e.message); }
    };
  }
})();
