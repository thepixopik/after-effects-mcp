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
  var NATIVE_EXE  = path.join(REC_ROOT, "PixopikRecorder_v402.exe");
  var DONE_SIG    = path.join(REC_ROOT, "native_done.signal");
  var PORT_FILE   = path.join(REC_ROOT, "ae_bridge_port.txt");
  var PREFS_FILE  = path.join(REC_ROOT, "studio_v2_prefs.json");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

  function syncBadges() {
    var pill = document.getElementById("verPill") || document.querySelector(".pro-pill");
    if (pill) pill.textContent = "v4.0.2";
    var verSub = document.getElementById("verSubtitle");
    if (verSub) verSub.textContent = "Verified Click + Whoosh SFX • v4.0.2";
    var qBan = document.getElementById("quickBanner");
    if (qBan) qBan.textContent = "v4.0.2 Live • Fixed 140% Cursor Scale SFX Bug (100% Audible!)";
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

  /* =========================================================================
   * PEAK-NORMALIZED ORIGINAL TACTILE CLICK + SOFT VELVET AIR SWISH!
   * ========================================================================= */
  function buildOriginalClickAndVelvetWhooshWav(clickTimes, whooshTimes, durationSec, outWavPath) {
    var sr = 22050;
    var dur = Math.max(2.5, (durationSec || 10) + 0.35);
    var totalSamples = Math.ceil(dur * sr);
    var pcm = new Int16Array(totalSamples);

    /* 1. Exact Original Tactile Mechanical Click (0.90 peak = clear crisp click!) */
    var clkLen = Math.floor(sr * 0.085);
    var clkTpl = new Int16Array(clkLen);
    for (var j = 0; j < clkLen; j++) {
      var lt = j / sr;
      var w = (Math.sin(6.283185 * 1550 * lt) * Math.exp(-lt * 210) * 0.62) +
              (Math.sin(6.283185 * 420 * lt) * Math.exp(-lt * 95) * 0.48);
      if (lt >= 0.046) {
        var lt2 = lt - 0.046;
        w += Math.sin(6.283185 * 1950 * lt2) * Math.exp(-lt2 * 280) * 0.22;
      }
      var s = Math.max(-1, Math.min(1, w * 0.92));
      clkTpl[j] = Math.round(s * 32767);
    }

    /* 2. Peak-Normalized Subtle Velvet Air Swish (0.28 normalized peak = soft audible swish!) */
    var swLen = Math.floor(sr * 0.26);
    var rawSw = new Float64Array(swLen);
    var lp1 = 0, lp2 = 0, seed = 1337, maxPeak = 0.0001;
    for (var m = 0; m < swLen; m++) {
      var u = m / swLen;
      seed = (seed * 16807) % 2147483647;
      var white = ((seed / 1073741823.5) - 1.0);
      var alpha = 0.07 + 0.16 * Math.sin(Math.PI * u);
      lp1 += alpha * (white - lp1);
      lp2 += alpha * (lp1 - lp2);
      var env = Math.pow(Math.sin(Math.PI * u), 1.75);
      rawSw[m] = lp2 * env;
      if (Math.abs(rawSw[m]) > maxPeak) maxPeak = Math.abs(rawSw[m]);
    }
    var swTpl = new Int16Array(swLen);
    for (var m2 = 0; m2 < swLen; m2++) {
      var norm = (rawSw[m2] / maxPeak) * 0.28; /* Guaranteed -11 dB soft velvet swish! */
      swTpl[m2] = Math.round(Math.max(-1, Math.min(1, norm)) * 32767);
    }

    var clicksPlaced = 0, whooshesPlaced = 0;
    var lastC = -1;
    var cArr = clickTimes || [];
    for (var c = 0; c < cArr.length; c++) {
      var ct = Number(cArr[c]);
      if (isNaN(ct) || ct < 0 || ct - lastC < 0.06) continue;
      lastC = ct;
      var i0 = Math.floor(ct * sr);
      if (i0 >= totalSamples) break;
      var maxK = Math.min(clkLen, totalSamples - i0);
      for (var k = 0; k < maxK; k++) {
        var sum = pcm[i0 + k] + clkTpl[k];
        pcm[i0 + k] = sum > 32767 ? 32767 : (sum < -32768 ? -32768 : sum);
      }
      clicksPlaced++;
    }

    var lastW = -1;
    var wArr = whooshTimes || [];
    for (var wi = 0; wi < wArr.length; wi++) {
      var wt = Number(wArr[wi]);
      if (isNaN(wt) || wt < 0 || wt - lastW < 0.45) continue;
      lastW = wt;
      var wi0 = Math.floor(wt * sr);
      if (wi0 >= totalSamples) break;
      var maxM = Math.min(swLen, totalSamples - wi0);
      for (var mk = 0; mk < maxM; mk++) {
        var sum2 = pcm[wi0 + mk] + swTpl[mk];
        pcm[wi0 + mk] = sum2 > 32767 ? 32767 : (sum2 < -32768 ? -32768 : sum2);
      }
      whooshesPlaced++;
    }

    if (clicksPlaced === 0 && whooshesPlaced === 0) return null;

    var dataByteLen = pcm.byteLength;
    var wav = Buffer.alloc(44 + dataByteLen);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataByteLen, 4); wav.write("WAVE", 8);
    wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
    wav.writeUInt32LE(dataByteLen, 40);
    Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(wav, 44);
    fs.writeFileSync(outWavPath, wav);
    return { path: outWavPath, clicks: clicksPlaced, whooshes: whooshesPlaced };
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
  var chkSfxBox = document.getElementById("chkOrigSfx");
  var chkClick  = document.getElementById("chkClickZoomPunch");
  var chkBlur   = document.getElementById("chk3WayBlur");
  var chkType   = document.getElementById("chkTypingHide");

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
  function applyFocuSeeAndOriginalSfx(pxVal, autoSilent, explicitMotionPath) {
    if (applyingNow) return;
    applyingNow = true;
    var minPx = parseInt(pxVal, 10) || getSelectedMinPx();
    var wantSfx = chkSfxBox ? chkSfxBox.checked : true;
    var motPath = explicitMotionPath || findLatestMotionJson();

    var opts = {
      minDollyPx: minPx,
      zoomPercent: 148,
      clickZoomPunch: chkClick ? chkClick.checked : true,
      threeWayBlur: chkBlur ? chkBlur.checked : true,
      typingHide: chkType ? chkType.checked : true,
      motionPath: motPath
    };

    try {
      var curP = fs.existsSync(PREFS_FILE) ? JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")) : {};
      curP.minDollyPx = minPx;
      curP.threeWayBlur = opts.threeWayBlur;
      curP.clickSfx = wantSfx;
      fs.writeFileSync(PREFS_FILE, JSON.stringify(curP), "utf8");
    } catch (_ep) {}

    injectSteadyJsx(function () {
      if (!window.__adobe_cep__) { applyingNow = false; return; }
      var argStr = JSON.stringify(JSON.stringify(opts));
      window.__adobe_cep__.evalScript("$.global.PixopikApplyFocuSeeEngine(" + argStr + ")", function (raw) {
        try {
          var r = JSON.parse(raw || "{}");
          if (r && r.ok) {
            if (wantSfx) {
              var outWav = path.join(REC_ROOT, "studio_sfx_" + Date.now() + ".wav");
              var built = buildOriginalClickAndVelvetWhooshWav(r.clickTimes || [], r.whooshTimes || [], r.duration || 15, outWav);
              if (built && built.path) {
                var safeW = built.path.replace(/\\/g, "/");
                window.__adobe_cep__.evalScript('$.global.PixopikInjectStudioSfxWav("' + safeW + '")', function () {
                  applyingNow = false;
                  uiLog("🔊 SFX Active (" + built.clicks + " Clicks + " + built.whooshes + " Soft Whooshes) on " + r.compName + "!");
                });
                return;
              }
            }
            applyingNow = false;
            uiLog("🎥 Applied FocuSee Dolly (" + r.minDistPx + "px) on " + r.compName + "!");
            return;
          } else if (!autoSilent && r && r.error) {
            uiLog("Note: " + r.error);
          }
        } catch (_er) {}
        applyingNow = false;
      });
    });
  }

  /* 1. Auto-restore audible Click + Velvet Whoosh SFX immediately on v4.0.2 Sync! */
  setTimeout(function () { applyFocuSeeAndOriginalSfx(getSelectedMinPx(), true); }, 650);

  /* 2. Auto-apply after every 'Rigged in X.XXs' import */
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
            setTimeout(function () { applyFocuSeeAndOriginalSfx(getSelectedMinPx(), false, mp); }, 150);
            return;
          }
        }
      }
    });
    obs.observe(logContainer, { childList: true });
  }

  if (presetSel && customInp) {
    presetSel.onchange = function () {
      customInp.value = presetSel.value;
      applyFocuSeeAndOriginalSfx(presetSel.value, false);
    };
  }
  if (applyBtn && customInp) applyBtn.onclick = function () { applyFocuSeeAndOriginalSfx(customInp.value, false); };
  if (chkSfxBox) chkSfxBox.onchange = function () { applyFocuSeeAndOriginalSfx(getSelectedMinPx(), false); };
  if (chkClick)  chkClick.onchange  = function () { applyFocuSeeAndOriginalSfx(getSelectedMinPx(), false); };
  if (chkBlur)   chkBlur.onchange   = function () { applyFocuSeeAndOriginalSfx(getSelectedMinPx(), false); };
  if (chkType)   chkType.onchange   = function () { applyFocuSeeAndOriginalSfx(getSelectedMinPx(), false); };

  var fixBtn = document.getElementById("btnSmoothTravel");
  if (fixBtn) {
    fixBtn.onclick = function (ev) {
      if (ev && ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      applyFocuSeeAndOriginalSfx(getSelectedMinPx(), false);
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
    try {
      if (prefs.editMode && document.getElementById("modeSelect")) document.getElementById("modeSelect").value = prefs.editMode;
      if (prefs.aspectPreset && document.getElementById("aspectSelect")) document.getElementById("aspectSelect").value = prefs.aspectPreset;
      if (prefs.wallpaper && document.getElementById("wallpaperSelect")) document.getElementById("wallpaperSelect").value = prefs.wallpaper;
      if (prefs.frameStyle && document.getElementById("frameStyleSelect")) document.getElementById("frameStyleSelect").value = prefs.frameStyle;
      if (document.getElementById("chkClickSfx")) document.getElementById("chkClickSfx").checked = (prefs.clickSfx !== false);
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

    cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v401.exe"], function () {
      cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v402.exe"], function () {
        var needBuild = !fs.existsSync(NATIVE_EXE);
        if (!needBuild) {
          try { needBuild = fs.statSync(CS_SRC).mtimeMs > fs.statSync(NATIVE_EXE).mtimeMs; } catch (_e) { needBuild = true; }
        }
        function spawnExe() {
          var envCopy = Object.assign({}, process.env, { PIXOPIK_REC_ROOT: REC_ROOT });
          cp.spawn(NATIVE_EXE, [], { detached: true, stdio: "ignore", cwd: REC_ROOT, env: envCopy }).unref();
          uiLog("🚀 Launched PixopikRecorder v4.0.2!");
        }
        if (!needBuild) { spawnExe(); return; }
        uiLog("⚡ Building PixopikRecorder v4.0.2...");
        cp.execFile(csc, [
          "/nologo", "/target:winexe", "/optimize+",
          "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.dll",
          "/out:" + NATIVE_EXE, CS_SRC
        ], { timeout: 15000 }, function (err, stdout, stderr) {
          if (err && !fs.existsSync(NATIVE_EXE)) { uiLog("Compile error: " + (stderr || stdout || err.message)); return; }
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
        uiLog("📌 Updated Desktop Shortcut to v4.0.2!");
      } catch (e) { uiLog("Shortcut note: " + e.message); }
    };
  }
})();
