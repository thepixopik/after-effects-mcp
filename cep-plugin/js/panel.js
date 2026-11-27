(function () {
  var fs = require("fs");
  var path = require("path");
  var os = require("os");
  var cp = require("child_process");

  function evalHostScript(code, cb) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function") {
      window.__adobe_cep__.evalScript(code, function (res) { if (cb) cb(res || ""); });
    } else if (cb) { cb(""); }
  }

  function getExtRoot() {
    var raw = "";
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.getSystemPath === "function") {
      raw = window.__adobe_cep__.getSystemPath("extension") || "";
    } else {
      raw = decodeURI(window.location.pathname || "");
    }
    raw = raw.replace(/^file:\/+/i, "");
    if (/^\/[A-Za-z]:/.test(raw)) raw = raw.slice(1);
    return path.normalize(decodeURIComponent(raw));
  }

  var EXT_ROOT    = getExtRoot();
  var HOST_JSX    = path.join(EXT_ROOT, "jsx", "host.jsx");
  var PRO_RIG_JSX = path.join(EXT_ROOT, "jsx", "pro-studio-rig.jsx");
  var REC_SCRIPT  = path.join(EXT_ROOT, "recorder", "capture-session.ps1");
  var INST_SCRIPT = path.join(EXT_ROOT, "recorder", "install-ffmpeg.ps1");
  var REC_ROOT    = path.join(os.homedir(), "Videos", "PixopikRecordings");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

  var statusBadge   = document.getElementById("statusBadge");
  var statusText    = document.getElementById("statusText");
  var quickBanner   = document.getElementById("quickBanner");
  var wsInput       = document.getElementById("wsUrl");
  var logList       = document.getElementById("logList");
  var btnRecord     = document.getElementById("btnRecord");
  var btnStop       = document.getElementById("btnStop");
  var recTimer      = document.getElementById("recTimer");
  var ffmpegBar     = document.getElementById("ffmpegBar");
  var modeSelect    = document.getElementById("modeSelect");
  var wallSelect    = document.getElementById("wallpaperSelect");
  var frameSelect   = document.getElementById("frameStyleSelect");
  var chkMicAudio   = document.getElementById("chkMicAudio");
  var chkMotionBlur = document.getElementById("chkMotionBlur");

  function log(msg, level) {
    var row = document.createElement("div");
    row.className = "log-item " + (level || "info");
    row.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
    logList.insertBefore(row, logList.firstChild);
    while (logList.children.length > 60) logList.removeChild(logList.lastChild);
  }

  function loadExtendScripts(cb) {
    var p1 = HOST_JSX.replace(/\\/g, "/");
    var p2 = PRO_RIG_JSX.replace(/\\/g, "/");
    var loader = 'try { $.evalFile(new File("' + p1 + '")); $.evalFile(new File("' + p2 + '")); "OK"; } catch(e) { "ERR:" + e; }';
    evalHostScript(loader, function (res) {
      if (cb) cb(res);
    });
  }

  function evalJSX(action, argsObj) {
    return new Promise(function (resolve) {
      var b64 = Buffer.from(JSON.stringify(argsObj || {}), "utf8").toString("base64");
      var callCode = 'PixopikAE.dispatch("' + action + '", "' + b64 + '")';
      evalHostScript(callCode, function (raw) {
        if (!raw || raw === "EvalScript error." || raw.indexOf("ReferenceError") !== -1) {
          loadExtendScripts(function () {
            evalHostScript(callCode, function (retryRaw) {
              try { resolve(JSON.parse(retryRaw)); }
              catch (_e2) { resolve({ ok: false, error: retryRaw || "ExtendScript error" }); }
            });
          });
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch (_e) { resolve({ ok: true, raw: raw }); }
      });
    });
  }

  loadExtendScripts(function (res) {
    if (String(res).indexOf("OK") === 0) {
      quickBanner.textContent = "v1.1 Ready • SaaS Promo + YouTube Tutorial + Live Mic";
      log("Studio Pro v1.1 engine loaded (SaaS + YouTube + Mic)", "ok");
    } else {
      log("Engine init: " + res, "err");
    }
  });

  if (modeSelect) {
    modeSelect.onchange = function () {
      var isYT = (modeSelect.value === "youtube_tutorial");
      chkMicAudio.checked = isYT;
      chkMotionBlur.checked = !isYT;
      if (isYT) {
        wallSelect.value = "dark_carbon";
        frameSelect.value = "minimal_rounded";
        log("Switched to YouTube Tutorial Mode (95% Big Screen • Flat 145% Zoom • Mic ON)", "ok");
      } else {
        wallSelect.value = "cosmic_indigo";
        frameSelect.value = "macos_glass";
        log("Switched to SaaS Promo Mode (84% Frame • 3D + 178% Zoom)", "ok");
      }
    };
  }

  function hasFfmpegInstalled() {
    try {
      var r = cp.spawnSync("where.exe", ["ffmpeg"], { windowsHide: true });
      if (r && r.status === 0) return true;
    } catch (_e) {}
    var wg = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
    try {
      if (fs.existsSync(wg)) {
        var dirs = fs.readdirSync(wg);
        for (var i = 0; i < dirs.length; i++) {
          if (dirs[i].toLowerCase().indexOf("ffmpeg") !== -1) return true;
        }
      }
    } catch (_e2) {}
    return fs.existsSync("C:\\ffmpeg\\bin\\ffmpeg.exe");
  }

  if (!hasFfmpegInstalled()) ffmpegBar.classList.remove("hidden");

  document.getElementById("btnInstallFfmpeg").onclick = function () {
    log("Installing FFmpeg via Windows Winget...", "info");
    var ps = cp.spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INST_SCRIPT], { windowsHide: true });
    ps.on("close", function () {
      if (hasFfmpegInstalled()) {
        ffmpegBar.classList.add("hidden");
        log("FFmpeg ready!", "ok");
      }
    });
  };

  function simplifyTrajectory(samples, stepSec) {
    if (!samples || !samples.length) return [];
    var out = [samples[0]], last = samples[0];
    for (var i = 1; i < samples.length - 1; i++) {
      var s = samples[i];
      var dt = s.t - last.t;
      var dist = Math.hypot(s.x - last.x, s.y - last.y);
      if (dt >= (stepSec || 0.032) || dist >= 16) {
        out.push(s);
        last = s;
      }
    }
    if (samples.length > 1) out.push(samples[samples.length - 1]);
    return out;
  }

  function findLatestRecording() {
    try {
      var entries = fs.readdirSync(REC_ROOT).map(function (name) {
        var full = path.join(REC_ROOT, name);
        var st = fs.statSync(full);
        return st.isDirectory() ? { name: name, dir: full, mtime: st.mtimeMs } : null;
      }).filter(Boolean).sort(function (a, b) { return b.mtime - a.mtime; });

      for (var i = 0; i < entries.length; i++) {
        var mp4 = path.join(entries[i].dir, "screen.mp4");
        var mot = path.join(entries[i].dir, "motion.json");
        if (fs.existsSync(mp4)) return { dir: entries[i].dir, videoPath: mp4, motionPath: fs.existsSync(mot) ? mot : null };
      }
    } catch (_e) {}
    return null;
  }

  function currentStudioPrefs() {
    var isYT = (modeSelect.value === "youtube_tutorial");
    return {
      editMode: modeSelect.value,
      aspectPreset: document.getElementById("aspectSelect").value,
      wallpaper: wallSelect.value,
      frameStyle: frameSelect.value,
      autoZoom: document.getElementById("chkAutoZoom").checked,
      vectorCursor: document.getElementById("chkVectorCursor").checked,
      clickRipples: document.getElementById("chkRipples").checked,
      motionBlur: chkMotionBlur.checked,
      cursorScale: isYT ? 140 : 155
    };
  }

  async function autoRigBundle(bundle, overrides) {
    var motion = null;
    if (bundle.motionPath && fs.existsSync(bundle.motionPath)) {
      try {
        var raw = fs.readFileSync(bundle.motionPath, "utf8").replace(/^\uFEFF/, "");
        motion = JSON.parse(raw);
        var step = (motion.duration && motion.duration > 180) ? 0.048 : 0.032;
        motion.cursorKeys = simplifyTrajectory(motion.samples || [], step);
        delete motion.samples;
      } catch (e) { log("Motion telemetry parse warning: " + e.message, "err"); }
    }
    var payload = Object.assign({ videoPath: bundle.videoPath.replace(/\\/g, "/"), motion: motion }, currentStudioPrefs(), overrides || {});
    log("Building " + (payload.editMode === "youtube_tutorial" ? "YouTube Tutorial" : "SaaS Promo") + " timeline...", "info");
    var res = await evalJSX("import_and_autorig_recording", payload);
    if (res && res.ok) {
      log("Rigged: " + res.compName + " (" + (res.autoZoomClusters || 0) + " zooms)", "ok");
    } else {
      log("Auto-rig error: " + JSON.stringify(res), "err");
    }
    return res;
  }

  var activeSession = null, timerInterval = null, startEpoch = 0;

  btnRecord.onclick = function () {
    if (!hasFfmpegInstalled()) {
      ffmpegBar.classList.remove("hidden");
      log("Click Auto-Install FFmpeg first.", "err");
      return;
    }
    var stamp = new Date().toISOString().replace(/[:.]/g, "-");
    var sessionDir = path.join(REC_ROOT, "rec_" + stamp);
    fs.mkdirSync(sessionDir, { recursive: true });

    var countdownSec = parseInt(document.getElementById("countdownSelect").value || "3", 10);
    var useMicFlag = chkMicAudio.checked ? "1" : "0";
    activeSession = {
      dir: sessionDir,
      stopSignal: path.join(sessionDir, "stop.signal"),
      doneSignal: path.join(sessionDir, "done.signal"),
      videoPath: path.join(sessionDir, "screen.mp4"),
      motionPath: path.join(sessionDir, "motion.json")
    };

    cp.spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA",
      "-File", REC_SCRIPT,
      "-SessionDir", sessionDir,
      "-Fps", "60",
      "-Countdown", String(countdownSec),
      "-UseMic", useMicFlag
    ], { detached: true, windowsHide: true });

    btnRecord.classList.add("hidden");
    btnStop.classList.remove("hidden");
    recTimer.classList.remove("hidden");
    startEpoch = Date.now() + (countdownSec * 1000);
    log("Recorder started (" + (useMicFlag === "1" ? "60fps + Live Mic" : "60fps Screen") + ")...", "ok");

    var finishing = false;
    timerInterval = setInterval(async function () {
      var diff = Math.floor((Date.now() - startEpoch) / 1000);
      if (diff < 0) {
        recTimer.textContent = "Starting in " + Math.abs(diff) + "s • Switch to your app!";
      } else {
        var sec = String(diff % 60).padStart(2, "0");
        var min = String(Math.floor(diff / 60)).padStart(2, "0");
        recTimer.textContent = min + ":" + sec + (useMicFlag === "1" ? " • REC 60fps + Mic ON" : " • REC 60fps");
      }

      if (!finishing && activeSession && fs.existsSync(activeSession.doneSignal)) {
        finishing = true;
        clearInterval(timerInterval);
        btnStop.classList.add("hidden");
        btnRecord.classList.remove("hidden");
        recTimer.classList.add("hidden");

        var status = "";
        try { status = fs.readFileSync(activeSession.doneSignal, "utf8").trim(); } catch (_e) {}
        if (status.indexOf("ERROR:") === 0) {
          log("Recorder error: " + status, "err");
        } else if (fs.existsSync(activeSession.videoPath)) {
          log("Capture saved! Auto-rigging in After Effects...", "ok");
          await autoRigBundle(activeSession);
        }
        activeSession = null;
      }
    }, 350);
  };

  btnStop.onclick = function () {
    if (!activeSession) return;
    recTimer.textContent = "Finalizing MP4 & Auto-Rigging...";
    try { fs.writeFileSync(activeSession.stopSignal, "STOP", "utf8"); } catch (_e) {}
  };

  document.getElementById("btnRigLatest").onclick = async function () {
    var latest = findLatestRecording();
    if (!latest) return log("No recordings found in Videos/PixopikRecordings yet.", "err");
    await autoRigBundle(latest);
  };

  document.getElementById("btnRigFile").onclick = async function () {
    evalHostScript('var f = File.openDialog("Select MP4/MOV video"); f ? f.fsName : "";', async function (chosen) {
      if (!chosen) return;
      var mot = path.join(path.dirname(chosen), "motion.json");
      await autoRigBundle({ videoPath: chosen, motionPath: fs.existsSync(mot) ? mot : null });
    });
  };

  document.getElementById("btnSubscribe").onclick = async function () {
    var r = await evalJSX("add_youtube_subscribe", {});
    log(r && r.ok ? "Added YouTube Subscribe Pill at playhead!" : JSON.stringify(r), r && r.ok ? "ok" : "err");
  };
  document.getElementById("btnChapter").onclick = async function () {
    var title = window.prompt("Enter YouTube Chapter / Step Title:", "STEP 01  •  Getting Started");
    if (!title) return;
    var r = await evalJSX("add_youtube_chapter", { title: title });
    log(r && r.ok ? "Added YouTube Chapter Lower-Third!" : JSON.stringify(r), r && r.ok ? "ok" : "err");
  };
  document.getElementById("btnAddZoom").onclick = function () { evalJSX("add_smart_zoom_segment", { startTime: 1, holdDuration: 1.5, targetX: 960, targetY: 540, zoomPercent: 160 }); };
  document.getElementById("btnSpotlight").onclick = function () { evalJSX("add_spotlight_focus", { startTime: 1, duration: 2.5, centerX: 960, centerY: 540, radiusX: 280, radiusY: 160, dimOpacity: 68 }); };
  document.getElementById("btnBlur").onclick = function () { evalJSX("add_blur_redact_zone", { startTime: 0, duration: 5, x: 960, y: 220, width: 420, height: 90, blurriness: 45 }); };
  document.getElementById("btnCallout").onclick = function () { evalJSX("add_saas_callout", { text: "Ctrl + K  •  Quick Action", startTime: 1, duration: 2.8, x: 960, y: 150, accentHex: "#6366F1" }); };
  document.getElementById("btnShorts").onclick = function () { evalJSX("convert_comp_for_shorts", { followCursor: true }); };
  document.getElementById("btn3dTilt").onclick = function () { evalJSX("apply_3d_saas_perspective", { swivelDeg: 10, tiltDeg: -4, animateFloat: true }); };
  document.getElementById("btnClearLog").onclick = function () { logList.innerHTML = ""; };

  var ws = null, reconnectTimer = null;
  function setStatus(connected, text) {
    statusBadge.className = "status " + (connected ? "connected" : "disconnected");
    statusText.textContent = text;
  }

  async function handleCommand(msg) {
    var action = msg.action, args = msg.args || {};
    log("MCP -> " + action, "info");
    if (action === "get_project_info") {
      var info = await evalJSX("get_project_info", {});
      var latest = findLatestRecording();
      info.recordingsRoot = REC_ROOT;
      info.latestRecording = latest ? latest.videoPath : null;
      return info;
    }
    if (action === "import_and_autorig_recording") {
      var target = (!args.videoPath || args.videoPath === "latest")
        ? findLatestRecording()
        : { videoPath: args.videoPath, motionPath: args.motionJsonPath || null };
      if (!target) return { ok: false, error: "No recording found." };
      return await autoRigBundle(target, args);
    }
    return await evalJSX(action, args);
  }

  function connectWS() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try { if (ws) ws.close(); } catch (_e) {}
    var url = (wsInput.value || "").trim();
    setStatus(false, "Connecting...");
    ws = new WebSocket(url);
    ws.onopen = function () { setStatus(true, "Pro v1.1 Live"); log("Connected to Cloud MCP Relay!", "ok"); };
    ws.onmessage = async function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (_e) { return; }
      if (!msg || !msg.id || !msg.action) return;
      try {
        var result = await handleCommand(msg);
        ws.send(JSON.stringify({ id: msg.id, result: result }));
      } catch (err) {
        ws.send(JSON.stringify({ id: msg.id, error: String(err && err.message ? err.message : err) }));
      }
    };
    ws.onclose = function () {
      setStatus(false, "Reconnecting...");
      reconnectTimer = setTimeout(connectWS, 3500);
    };
    ws.onerror = function () {};
  }

  document.getElementById("btnReconnect").onclick = connectWS;
  connectWS();
})();
