(function () {
  var nodeReq = (typeof cep_node !== "undefined" && cep_node.require) ? cep_node.require : (typeof require !== "undefined" ? require : null);
  var fs = nodeReq ? nodeReq("fs") : null;
  var path = nodeReq ? nodeReq("path") : null;
  var os = nodeReq ? nodeReq("os") : null;
  var cp = nodeReq ? nodeReq("child_process") : null;

  var ws = null;
  var pingTimer = null;
  var recTimerInt = null;
  var activeSessionDir = null;
  var recStartMs = 0;

  var statusBadge = document.getElementById("statusBadge");
  var statusText = document.getElementById("statusText");
  var logList = document.getElementById("logList");
  var wsInput = document.getElementById("wsUrl");

  function log(msg) {
    var line = document.createElement("div");
    var t = new Date().toLocaleTimeString();
    line.textContent = "[" + t + "] " + msg;
    logList.appendChild(line);
    logList.scrollTop = logList.scrollHeight;
  }

  function setStatus(state, label) {
    statusBadge.className = "status " + state;
    statusText.textContent = label;
  }

  function evalJSX(script) {
    return new Promise(function (resolve, reject) {
      if (!window.__adobe_cep__) {
        reject(new Error("Adobe CEP runtime not detected."));
        return;
      }
      window.__adobe_cep__.evalScript(script, function (res) {
        if (res === "EvalScript error.") {
          reject(new Error("After Effects ExtendScript execution error."));
        } else {
          resolve(res);
        }
      });
    });
  }

  function callHost(action, argsObj) {
    var b64 = Buffer.from(JSON.stringify(argsObj || {}), "utf8").toString("base64");
    var code = 'PixopikAE.dispatch("' + action + '", "' + b64 + '")';
    return evalJSX(code).then(function (raw) {
      if (!raw) return { ok: true };
      var parsed = JSON.parse(raw);
      if (parsed && parsed.ok === false) {
        throw new Error(parsed.error || "ExtendScript error");
      }
      return parsed;
    });
  }

  function getRecordingsRoot() {
    return path.join(os.homedir(), "Videos", "PixopikRecordings");
  }

  function getExtensionRoot() {
    var uri = decodeURIComponent(window.location.pathname);
    if (/^\/[A-Za-z]:/.test(uri)) uri = uri.slice(1);
    return path.dirname(uri);
  }

  function checkFfmpeg() {
    if (!cp) return;
    cp.exec("where ffmpeg", function (err) {
      if (!err) return;
      var wingetDir = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
      var found = false;
      if (fs.existsSync(wingetDir)) {
        try {
          var entries = fs.readdirSync(wingetDir);
          found = entries.some(function (e) { return e.toLowerCase().indexOf("ffmpeg") !== -1; });
        } catch (_e) {}
      }
      if (!found && !fs.existsSync("C:\\ffmpeg\\bin\\ffmpeg.exe")) {
        document.getElementById("ffmpegBar").classList.remove("hidden");
      }
    });
  }

  /* Smooth raw cursor samples & decimate to <=240 clean keyframes */
  function processMotionTelemetry(motionData) {
    if (!motionData || !Array.isArray(motionData.samples) || motionData.samples.length === 0) {
      return { cursorKeys: [], zoomSegments: [], clicks: [] };
    }
    var raw = motionData.samples;
    var smoothed = [];
    var sx = raw[0].x;
    var sy = raw[0].y;
    var alpha = 0.32;

    for (var i = 0; i < raw.length; i++) {
      sx = sx + alpha * (raw[i].x - sx);
      sy = sy + alpha * (raw[i].y - sy);
      smoothed.push({ t: raw[i].t, x: Math.round(sx), y: Math.round(sy) });
    }

    var step = Math.max(1, Math.ceil(smoothed.length / 220));
    var cursorKeys = [];
    var prevT = -1;
    for (var j = 0; j < smoothed.length; j += step) {
      if (smoothed[j].t - prevT >= 0.04) {
        cursorKeys.push(smoothed[j]);
        prevT = smoothed[j].t;
      }
    }
    var last = smoothed[smoothed.length - 1];
    if (!cursorKeys.length || cursorKeys[cursorKeys.length - 1].t < last.t) {
      cursorKeys.push(last);
    }

    /* Group clicks within 2.4s into smooth camera zoom clusters */
    var clicks = Array.isArray(motionData.clicks) ? motionData.clicks.slice(0, 80) : [];
    var zoomSegments = [];
    for (var c = 0; c < clicks.length; c++) {
      var clk = clicks[c];
      var prevSeg = zoomSegments[zoomSegments.length - 1];
      if (prevSeg && clk.t - prevSeg.endTime < 1.8) {
        prevSeg.endTime = clk.t + 1.3;
        prevSeg.x = Math.round((prevSeg.x + clk.x) / 2);
        prevSeg.y = Math.round((prevSeg.y + clk.y) / 2);
      } else {
        zoomSegments.push({
          startTime: Math.max(0.1, Number((clk.t - 0.35).toFixed(2))),
          endTime: Number((clk.t + 1.35).toFixed(2)),
          x: clk.x,
          y: clk.y
        });
      }
    }

    return {
      screenWidth: motionData.screenWidth || 1920,
      screenHeight: motionData.screenHeight || 1080,
      duration: motionData.duration || 10,
      cursorKeys: cursorKeys,
      clicks: clicks,
      zoomSegments: zoomSegments.slice(0, 25)
    };
  }

  function findLatestSession() {
    var root = getRecordingsRoot();
    if (!fs.existsSync(root)) return null;
    var dirs = fs.readdirSync(root)
      .map(function (name) {
        var full = path.join(root, name);
        return { name: name, full: full, stat: fs.statSync(full) };
      })
      .filter(function (d) { return d.stat.isDirectory() && fs.existsSync(path.join(d.full, "screen.mp4")); })
      .sort(function (a, b) { return b.stat.mtimeMs - a.stat.mtimeMs; });
    return dirs.length ? dirs[0].full : null;
  }

  async function handleAutoRig(args) {
    var folder = args.sessionFolder;
    var videoPath = args.videoPath;
    var motionPath = args.motionJsonPath;

    if (!videoPath) {
      if (!folder || folder === "latest") {
        folder = findLatestSession();
      }
      if (!folder) {
        throw new Error("No recorded session found yet in Videos/PixopikRecordings.");
      }
      videoPath = path.join(folder, "screen.mp4");
      motionPath = path.join(folder, "motion.json");
    }

    var processedMotion = null;
    if (motionPath && fs.existsSync(motionPath)) {
      var rawJson = JSON.parse(fs.readFileSync(motionPath, "utf8"));
      processedMotion = processMotionTelemetry(rawJson);
    }

    var payload = Object.assign({}, args, {
      videoPath: videoPath.replace(/\\/g, "/"),
      motion: processedMotion
    });

    log("Auto-rigging recording into After Effects...");
    var res = await callHost("import_and_autorig_recording", payload);
    log("Rig ready: " + (res.compName || "Done"));
    return res;
  }

  async function executeTool(tool, args) {
    if (tool === "get_project_info") {
      var info = await callHost("get_project_info", {});
      var root = getRecordingsRoot();
      info.recordingsFolder = root;
      info.savedSessions = fs && fs.existsSync(root) ? fs.readdirSync(root).slice(-10) : [];
      return { output: info };
    }

    if (tool === "import_and_autorig_recording") {
      var rigOut = await handleAutoRig(args || {});
      return { output: rigOut };
    }

    if (tool === "export_frame_preview") {
      var tmpPng = path.join(os.tmpdir(), "pixopik_ae_preview_" + Date.now() + ".png").replace(/\\/g, "/");
      var frameRes = await callHost("export_frame_preview", {
        timeSeconds: args ? args.timeSeconds : undefined,
        outPath: tmpPng
      });
      if (fs.existsSync(tmpPng)) {
        var b64 = fs.readFileSync(tmpPng).toString("base64");
        try { fs.unlinkSync(tmpPng); } catch (_e) {}
        return { base64: b64, mimeType: "image/png", output: frameRes };
      }
      return { output: frameRes };
    }

    var out = await callHost(tool, args || {});
    return { output: out };
  }

  function connectWS() {
    if (ws) {
      try { ws.close(); } catch (_e) {}
    }
    var url = wsInput.value.trim();
    setStatus("connecting", "Connecting...");
    ws = new WebSocket(url);

    ws.onopen = function () {
      setStatus("connected", "Connected & Ready!");
      log("Connected to Cloudflare! Ready for Gemini Video commands.");
      ws.send(JSON.stringify({ type: "hello", app: "after-effects", version: "0.1.0" }));
      clearInterval(pingTimer);
      pingTimer = setInterval(function () {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    };

    ws.onmessage = async function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (_e) { return; }
      if (msg.type === "ae_command" && msg.id) {
        log("AI Tool -> " + msg.tool);
        try {
          var res = await executeTool(msg.tool, msg.args || {});
          ws.send(JSON.stringify(Object.assign({ id: msg.id, ok: true }, res)));
          log("Completed: " + msg.tool);
        } catch (err) {
          log("Error in " + msg.tool + ": " + err.message);
          ws.send(JSON.stringify({ id: msg.id, ok: false, error: String(err.message || err) }));
        }
      }
    };

    ws.onclose = function () {
      setStatus("disconnected", "Disconnected");
      clearInterval(pingTimer);
      setTimeout(connectWS, 4000);
    };
  }

  /* UI Button Handlers */
  document.getElementById("btnRecord").onclick = function () {
    var recRoot = getRecordingsRoot();
    if (!fs.existsSync(recRoot)) fs.mkdirSync(recRoot, { recursive: true });
    var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    activeSessionDir = path.join(recRoot, "rec_" + stamp);
    fs.mkdirSync(activeSessionDir, { recursive: true });

    var psScript = path.join(getExtensionRoot(), "recorder", "capture-session.ps1");
    log("Starting 60fps cursor-free screen + motion capture...");

    var args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript, "-SessionDir", activeSessionDir, "-Fps", "60"];
    var child = cp.spawn("powershell.exe", args, { windowsHide: true });
    child.on("error", function (e) { log("Recorder error: " + e.message); });

    document.getElementById("btnRecord").classList.add("hidden");
    document.getElementById("btnStop").classList.remove("hidden");
    var timerEl = document.getElementById("recTimer");
    timerEl.classList.remove("hidden");
    recStartMs = Date.now();
    recTimerInt = setInterval(function () {
      var sec = Math.floor((Date.now() - recStartMs) / 1000);
      var mm = String(Math.floor(sec / 60)).padStart(2, "0");
      var ss = String(sec % 60).padStart(2, "0");
      timerEl.textContent = mm + ":" + ss + " • Capturing 60fps + Motion...";
    }, 500);
  };

  document.getElementById("btnStop").onclick = function () {
    clearInterval(recTimerInt);
    document.getElementById("recTimer").textContent = "Finalizing MP4 & Auto-Rigging in AE...";
    if (activeSessionDir) {
      fs.writeFileSync(path.join(activeSessionDir, "stop.signal"), "STOP", "utf8");
      var doneFile = path.join(activeSessionDir, "done.signal");
      var checks = 0;
      var poll = setInterval(async function () {
        checks++;
        if (fs.existsSync(doneFile) || checks > 25) {
          clearInterval(poll);
          document.getElementById("btnStop").classList.add("hidden");
          document.getElementById("btnRecord").classList.remove("hidden");
          document.getElementById("recTimer").classList.add("hidden");
          try {
            await handleAutoRig({
              sessionFolder: activeSessionDir,
              aspectPreset: document.getElementById("aspectSelect").value,
              autoZoom: document.getElementById("chkAutoZoom").checked,
              vectorCursor: document.getElementById("chkVectorCursor").checked,
              clickRipples: document.getElementById("chkRipples").checked
            });
          } catch (e) {
            log("Auto-rig error: " + e.message);
          }
        }
      }, 400);
    }
  };

  document.getElementById("btnRigLatest").onclick = function () {
    handleAutoRig({
      sessionFolder: "latest",
      aspectPreset: document.getElementById("aspectSelect").value,
      autoZoom: document.getElementById("chkAutoZoom").checked,
      vectorCursor: document.getElementById("chkVectorCursor").checked,
      clickRipples: document.getElementById("chkRipples").checked
    }).catch(function (e) { log("Error: " + e.message); });
  };

  document.getElementById("btnRigFile").onclick = function () {
    evalJSX('var f = File.openDialog("Select Screen Recording MP4/MOV"); f ? f.fsName : "";').then(function (chosen) {
      if (chosen) {
        var dir = path.dirname(chosen);
        var maybeMotion = path.join(dir, "motion.json");
        handleAutoRig({
          videoPath: chosen,
          motionJsonPath: fs.existsSync(maybeMotion) ? maybeMotion : "",
          aspectPreset: document.getElementById("aspectSelect").value,
          autoZoom: document.getElementById("chkAutoZoom").checked,
          vectorCursor: document.getElementById("chkVectorCursor").checked,
          clickRipples: document.getElementById("chkRipples").checked
        }).catch(function (e) { log("Error: " + e.message); });
      }
    });
  };

  document.getElementById("btnInstallFfmpeg").onclick = function () {
    log("Installing FFmpeg via Windows Winget...");
    cp.exec("winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements", function (err) {
      if (err) log("Winget note: restart AE after FFmpeg finishes installing.");
      else {
        log("FFmpeg installed! Ready for 60fps capture.");
        document.getElementById("ffmpegBar").classList.add("hidden");
      }
    });
  };

  document.getElementById("btnAddZoom").onclick = function () {
    callHost("add_smart_zoom_at_playhead", { zoomPercent: 195 }).then(function () { log("Added Smart Zoom at playhead!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btnSpotlight").onclick = function () {
    callHost("add_spotlight_at_playhead", {}).then(function () { log("Added Spotlight Focus at playhead!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btnBlur").onclick = function () {
    callHost("add_blur_at_playhead", {}).then(function () { log("Added Privacy Blur zone!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btnCallout").onclick = function () {
    callHost("add_callout_at_playhead", { text: "Pro Tip • Click Here" }).then(function () { log("Added SaaS Callout!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btnShorts").onclick = function () {
    callHost("convert_comp_for_shorts", { zoomPercent: 210 }).then(function () { log("Converted to 1080x1920 YouTube Shorts!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btn3dTilt").onclick = function () {
    callHost("apply_3d_saas_perspective", {}).then(function () { log("Applied 3D SaaS Perspective Tilt!"); }).catch(function (e) { log(e.message); });
  };

  document.getElementById("btnReconnect").onclick = connectWS;
  document.getElementById("btnClearLog").onclick = function () { logList.innerHTML = ""; };

  checkFfmpeg();
  connectWS();
})();
