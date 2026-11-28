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
  var NATIVE_EXE  = path.join(REC_ROOT, "PixopikRecorder_v50.exe");
  var DONE_SIG    = path.join(REC_ROOT, "native_done.signal");
  var PORT_FILE   = path.join(REC_ROOT, "ae_bridge_port.txt");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

  function syncBadges() {
    var pill = document.getElementById("verPill") || document.querySelector(".pro-pill");
    if (pill) pill.textContent = "v5.0";
    var verSub = document.getElementById("verSubtitle");
    if (verSub) verSub.textContent = "Raw Capture -> Post-FX Studio";
    var qBan = document.getElementById("quickBanner");
    if (qBan) qBan.textContent = "v5.0 Studio • Step 1: Normal Raw Record -> Step 2: Apply Post-FX!";
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

  function injectPostJsx(cb) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function" && fs.existsSync(STEADY_JSX)) {
      var p = STEADY_JSX.replace(/\\/g, "/");
      window.__adobe_cep__.evalScript('try { $.evalFile(new File("' + p + '")); "OK"; } catch(e) { "ERR:" + e; }', function (res) {
        if (cb) cb(res);
      });
    }
  }
  setTimeout(injectPostJsx, 500);

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

  /* =========================================================================
   * PEAK-NORMALIZED STUDIO SFX GENERATOR (Tactile Clicks + Soft Velvet Whoosh)
   * ========================================================================= */
  function buildStudioSfxWav(clickTimes, whooshTimes, durationSec, outWavPath) {
    var sr = 22050;
    var dur = Math.max(2.5, (durationSec || 10) + 0.35);
    var totalSamples = Math.ceil(dur * sr);
    var pcm = new Int16Array(totalSamples);

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
      clkTpl[j] = Math.round(Math.max(-1, Math.min(1, w * 0.92)) * 32767);
    }

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
      rawSw[m] = lp2 * Math.pow(Math.sin(Math.PI * u), 1.75);
      if (Math.abs(rawSw[m]) > maxPeak) maxPeak = Math.abs(rawSw[m]);
    }
    var swTpl = new Int16Array(swLen);
    for (var m2 = 0; m2 < swLen; m2++) {
      swTpl[m2] = Math.round(Math.max(-1, Math.min(1, (rawSw[m2] / maxPeak) * 0.28)) * 32767);
    }

    var clicksPlaced = 0, whooshesPlaced = 0, lastC = -1, lastW = -1;
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

  /* =========================================================================
   * STEP 1 HELPER: IMPORT RAW RECORDING FLAT (0% ZOOM, NO FORCED EFFECTS!)
   * ========================================================================= */
  function syncLookSelectorsToInternal() {
    var lay = document.getElementById("uiLayoutPreset");
    var wal = document.getElementById("uiWallPreset");
    if (lay && document.getElementById("modeSelect")) {
      document.getElementById("modeSelect").value = lay.value;
      if (document.getElementById("frameStyleSelect")) {
        document.getElementById("frameStyleSelect").value = (lay.value === "saas_promo") ? "macos_glass" : "minimal_rounded";
      }
    }
    if (wal && document.getElementById("wallpaperSelect")) {
      document.getElementById("wallpaperSelect").value = wal.value;
    }
  }

  function importLatestRawClipFlat() {
    syncLookSelectorsToInternal();
    /* Force flat 100% raw import — NO forced auto-zoom, NO forced SFX! */
    if (document.getElementById("chkAutoZoom")) document.getElementById("chkAutoZoom").checked = false;
    if (document.getElementById("chkClickSfx")) document.getElementById("chkClickSfx").checked = false;
    uiLog("📥 Importing clean Raw Recording (100% Flat — ready for Post-Production FX!)...");
    var rigBtn = document.getElementById("btnRigLatest");
    if (rigBtn) rigBtn.click();
  }

  /* =========================================================================
   * STEP 2 POST-PRODUCTION MODULAR ACTIONS
   * ========================================================================= */
  function runPostCameraFx(doneCb) {
    var zSel = document.getElementById("postZoomSelect");
    var dInp = document.getElementById("dollyDistCustom");
    var cChk = document.getElementById("chkClickZoomPunch");
    var tChk = document.getElementById("chkTypingHide");
    var opts = {
      zoomPercent: zSel ? parseInt(zSel.value, 10) : 148,
      minDollyPx: dInp ? parseInt(dInp.value, 10) : 550,
      clickZoomPunch: cChk ? cChk.checked : true,
      typingHide: tChk ? tChk.checked : true,
      motionPath: findLatestMotionJson()
    };
    injectPostJsx(function () {
      var arg = JSON.stringify(JSON.stringify(opts));
      window.__adobe_cep__.evalScript("$.global.PixopikApplyPostCamera(" + arg + ")", function (raw) {
        try {
          var r = JSON.parse(raw || "{}");
          if (r && r.ok) uiLog("🎥 Camera Applied: " + r.punches + " Click-Zooms + " + r.glides + " Dolly Glides on " + r.compName);
          else if (r && r.error) uiLog("⚠️ " + r.error);
          if (doneCb) doneCb(r);
        } catch (_e) { if (doneCb) doneCb(null); }
      });
    });
  }

  function runPostBlur(enable, doneCb) {
    var sh = document.getElementById("postShutterSelect");
    var deg = sh ? parseInt(sh.value, 10) : 190;
    injectPostJsx(function () {
      window.__adobe_cep__.evalScript("$.global.PixopikSetPostMotionBlur(" + (enable ? "true" : "false") + ", " + deg + ")", function (raw) {
        try {
          var r = JSON.parse(raw || "{}");
          if (r && r.ok) uiLog(enable ? ("🌀 3-Way Optical Motion Blur ON (" + deg + "°)!") : "🌀 Motion Blur OFF");
        } catch (_e) {}
        if (doneCb) doneCb();
      });
    });
  }

  function runPostSfx(doneCb) {
    var wantClicks = document.getElementById("chkSfxClicks") ? document.getElementById("chkSfxClicks").checked : true;
    var wantWhoosh = document.getElementById("chkSfxWhoosh") ? document.getElementById("chkSfxWhoosh").checked : true;
    var volSel = document.getElementById("postSfxVol");
    var dbVal = volSel ? parseFloat(volSel.value) : -1.5;

    injectPostJsx(function () {
      var mp = JSON.stringify(findLatestMotionJson());
      window.__adobe_cep__.evalScript("$.global.PixopikGetCompSfxTimings(" + mp + ")", function (raw) {
        try {
          var r = JSON.parse(raw || "{}");
          if (!r || !r.ok) { if (r && r.error) uiLog("⚠️ " + r.error); if (doneCb) doneCb(); return; }
          var cTimes = wantClicks ? (r.clickTimes || []) : [];
          var wTimes = wantWhoosh ? (r.whooshTimes || []) : [];
          var outWav = path.join(REC_ROOT, "post_sfx_" + Date.now() + ".wav");
          var built = buildStudioSfxWav(cTimes, wTimes, r.duration || 15, outWav);
          if (!built) {
            uiLog("ℹ️ No clicks or camera glides found yet (Apply Camera FX first if you want Whooshes!).");
            if (doneCb) doneCb();
            return;
          }
          var safeW = built.path.replace(/\\/g, "/");
          window.__adobe_cep__.evalScript('$.global.PixopikInjectStudioSfxWav("' + safeW + '", ' + dbVal + ')', function () {
            uiLog("🔊 SFX Added: " + built.clicks + " Clicks + " + built.whooshes + " Soft Whooshes (" + dbVal + " dB)!");
            if (doneCb) doneCb();
          });
        } catch (_e) { if (doneCb) doneCb(); }
      });
    });
  }

  /* Wire Step 1 & Step 2 Buttons */
  var bRaw = document.getElementById("btnImportRawFlat");
  if (bRaw) bRaw.onclick = importLatestRawClipFlat;

  var bCam = document.getElementById("btnApplyCameraOnly");
  if (bCam) bCam.onclick = function () { runPostCameraFx(); };

  var bFlat = document.getElementById("btnResetCameraFlat");
  if (bFlat) {
    bFlat.onclick = function () {
      injectPostJsx(function () {
        window.__adobe_cep__.evalScript("$.global.PixopikResetCameraFlat()", function () {
          uiLog("📌 Reset Camera to 100% Flat Raw View!");
        });
      });
    };
  }

  var bBlurOn = document.getElementById("btnBlurOn");
  if (bBlurOn) bBlurOn.onclick = function () { runPostBlur(true); };

  var bBlurOff = document.getElementById("btnBlurOff");
  if (bBlurOff) bBlurOff.onclick = function () { runPostBlur(false); };

  var bSfx = document.getElementById("btnApplySfxOnly");
  if (bSfx) bSfx.onclick = function () { runPostSfx(); };

  var bMute = document.getElementById("btnRemoveSfx");
  if (bMute) {
    bMute.onclick = function () {
      injectPostJsx(function () {
        window.__adobe_cep__.evalScript("$.global.PixopikRemoveStudioSfx()", function () {
          uiLog("🔇 Removed SFX Layer from timeline.");
        });
      });
    };
  }

  var bAll = document.getElementById("btnApplyAllPostFx");
  if (bAll) {
    bAll.onclick = function () {
      uiLog("⚡ Applying ALL Post-Production Pro FX (Camera + Blur + SFX)...");
      runPostCameraFx(function () {
        runPostBlur(true, function () {
          runPostSfx();
        });
      });
    };
  }

  /* TCP Bridge from Simple Raw Recorder (.EXE) -> Imports Clean Flat Raw Clip! */
  var lastRawSess = "";
  function onRawRecordingFinished(sessDir) {
    if (!sessDir || sessDir === lastRawSess) return;
    lastRawSess = sessDir;
    try { if (fs.existsSync(DONE_SIG)) fs.unlinkSync(DONE_SIG); } catch (_e) {}
    importLatestRawClipFlat();
  }

  var bridgeSrv = http.createServer(function (req, res) {
    if (req.method === "POST" && req.url === "/bridge") {
      var body = "";
      req.on("data", function (c) { body += c; });
      req.on("end", function () {
        try {
          var d = JSON.parse(body || "{}");
          if (d.action === "raw_ready" || d.action === "auto_rig") onRawRecordingFinished(d.sessionDir);
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
        try { onRawRecordingFinished(fs.readFileSync(DONE_SIG, "utf8").trim()); } catch (_ew) {}
      }
    });
  } catch (_ew2) {}

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

    cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v402.exe"], function () {
      cp.execFile("taskkill.exe", ["/F", "/IM", "PixopikRecorder_v50.exe"], function () {
        var needBuild = !fs.existsSync(NATIVE_EXE);
        if (!needBuild) {
          try { needBuild = fs.statSync(CS_SRC).mtimeMs > fs.statSync(NATIVE_EXE).mtimeMs; } catch (_e) { needBuild = true; }
        }
        function spawnExe() {
          var envCopy = Object.assign({}, process.env, { PIXOPIK_REC_ROOT: REC_ROOT });
          cp.spawn(NATIVE_EXE, [], { detached: true, stdio: "ignore", cwd: REC_ROOT, env: envCopy }).unref();
          uiLog("🔴 Launched Simple Raw Recorder v5.0!");
        }
        if (!needBuild) { spawnExe(); return; }
        uiLog("⚡ Building Simple Raw Recorder v5.0...");
        cp.execFile(csc, [
          "/nologo", "/target:winexe", "/optimize+",
          "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.dll",
          "/out:" + NATIVE_EXE, CS_SRC
        ], { timeout: 15000 }, function (err, stdout, stderr) {
          if (err && !fs.existsSync(NATIVE_EXE)) { uiLog("Compile error: " + (stderr || stdout || err.message)); return; }
          uiLog("✅ Ready: PixopikRecorder_v50.exe");
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
        uiLog("📌 Updated Desktop Shortcut to Simple Raw Recorder v5.0!");
      } catch (e) { uiLog("Shortcut note: " + e.message); }
    };
  }
})();
