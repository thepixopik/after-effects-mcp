(function () {
  var ws = null;
  var pingTimer = null;
  var recTimerInt = null;
  var activeSessionDir = null;
  var recStartMs = 0;

  var statusBadge = document.getElementById("statusBadge");
  var statusText = document.getElementById("statusText");
  var logList = document.getElementById("logList");
  var wsInput = document.getElementById("wsUrl");
  var quickBanner = document.getElementById("quickBanner");

  function getNode(mod) {
    try {
      if (window.cep_node && window.cep_node.require) return window.cep_node.require(mod);
      if (typeof require === "function") return require(mod);
    } catch (_e) {}
    return null;
  }

  function encodeB64Utf8(str) {
    return window.btoa(unescape(encodeURIComponent(str)));
  }

  function log(msg) {
    if (quickBanner) quickBanner.textContent = msg;
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
        if (!res || res === "EvalScript error.") {
          reject(new Error("ExtendScript error — verify Allow Scripts to Write Files is ON."));
        } else {
          resolve(res);
        }
      });
    });
  }

  function getExtensionRoot() {
    var uri = decodeURIComponent(window.location.pathname || "");
    if (/^\/[A-Za-z]:/.test(uri)) uri = uri.slice(1);
    var idx = uri.lastIndexOf("/");
    return idx > 0 ? uri.slice(0, idx) : uri;
  }

  var hostLoaded = false;
  function ensureHostLoaded() {
    if (hostLoaded) return Promise.resolve();
    return new Promise(function (resolve) {
      var root = getExtensionRoot().replace(/\\/g, "/");
      var boot = 'if (typeof PixopikAE === "undefined") { $.evalFile("' + root + '/jsx/host.jsx"); } ' +
                 'if (typeof PixopikAE !== "undefined" && !PixopikAE._addonLoaded) { $.evalFile("' + root + '/jsx/recorder-addon.jsx"); } ' +
                 '"OK"';
      window.__adobe_cep__.evalScript(boot, function () {
        hostLoaded = true;
        resolve();
      });
    });
  }

  function callHost(action, argsObj) {
    return ensureHostLoaded().then(function () {
      var b64 = encodeB64Utf8(JSON.stringify(argsObj || {}));
      var code = 'PixopikAE.dispatch("' + action + '", "' + b64 + '")';
      return evalJSX(code).then(function (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.ok === false) {
          throw new Error(parsed.error || "ExtendScript error");
        }
        return parsed;
      });
    });
  }

  function processMotionTelemetry(motionData) {
    if (!motionData || !Array.isArray(motionData.samples) || motionData.samples.length === 0) {
      return { cursorKeys: [], zoomSegments: [], clicks: [] };
    }
    var raw = motionData.samples;
    var smoothed = [];
    var sx = raw[0].x, sy = raw[0].y, alpha = 0.32;

    for (var i = 0; i < raw.length; i++) {
      sx = sx + alpha * (raw[i].x - sx);
      sy = sy + alpha * (raw[i].y - sy);
      smoothed.push({ t: raw[i].t, x: Math.round(sx), y: Math.round(sy) });
    }

    var step = Math.max(1, Math.ceil(smoothed.length / 220));
    var cursorKeys = [], prevT = -1;
    for (var j = 0; j < smoothed.length; j += step) {
      if (smoothed[j].t - prevT >= 0.04) {
        cursorKeys.push(smoothed[j]);
        prevT = smoothed[j].t;
      }
    }
    var last = smoothed[smoothed.length - 1];
    if (!cursorKeys.length || cursorKeys[cursorKeys.length - 1].t < last.t) cursorKeys.push(last);

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

  async function handleAutoRig(args) {
    var info = await callHost("resolve_recording_session", {
      sessionFolder: args.sessionFolder || "latest",
      videoPath: args.videoPath || "",
      motionJsonPath: args.motionJsonPath || ""
    });
    var processedMotion = null;
    if (info.motionText) {
      try { processedMotion = processMotionTelemetry(JSON.parse(info.motionText)); } catch (_e) {}
    }
    var payload = Object.assign({}, args, { videoPath: info.videoPath, motion: processedMotion });
    log("Auto-rigging " + info.videoPath.split("/").pop() + "...");
    var res = await callHost("import_and_autorig_recording", payload);
    log("Rig ready: " + res.compName);
    return res;
  }

  async function executeTool(tool, args) {
    if (tool === "import_and_autorig_recording") {
      return { output: await handleAutoRig(args || {}) };
    }
    if (tool === "export_frame_preview") {
      var frameRes = await callHost("export_frame_preview_b64", { timeSeconds: args ? args.timeSeconds : undefined });
      if (frameRes && frameRes.base64) {
        return { base64: frameRes.base64, mimeType: "image/png", output: { ok: true, comp: frameRes.comp, timeSeconds: frameRes.timeSeconds } };
      }
      return { output: frameRes };
    }
    return { output: await callHost(tool, args || {}) };
  }

  function connectWS() {
    if (ws) { try { ws.close(); } catch (_e) {} }
    setStatus("connecting", "Connecting...");
    ws = new WebSocket(wsInput.value.trim());

    ws.onopen = function () {
      setStatus("connected", "Connected & Ready!");
      log("Connected to Cloudflare! Ready for AI Video commands.");
      ws.send(JSON.stringify({ type: "hello", app: "after-effects", version: "0.2.1" }));
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
          log("Done: " + msg.tool);
        } catch (err) {
          log("Error: " + err.message);
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

  document.getElementById("btnRecord").onclick = async function () {
    try {
      log("Starting 60fps screen + motion recorder...");
      var cp = getNode("child_process"), fs = getNode("fs"), path = getNode("path"), os = getNode("os");
      if (cp && fs && path && os) {
        var recRoot = path.join(os.homedir(), "Videos", "PixopikRecordings");
        fs.mkdirSync(recRoot, { recursive: true });
        var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        activeSessionDir = path.join(recRoot, "rec_" + stamp);
        fs.mkdirSync(activeSessionDir, { recursive: true });
        var psScript = path.join(getExtensionRoot(), "recorder", "capture-session.ps1");
        cp.spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript, "-SessionDir", activeSessionDir, "-Fps", "60"], { windowsHide: true });
      } else {
        var startRes = await callHost("start_screen_recorder", { extRoot: getExtensionRoot() });
        activeSessionDir = startRes.sessionDir;
      }
      document.getElementById("btnRecord").classList.add("hidden");
      document.getElementById("btnStop").classList.remove("hidden");
      var timerEl = document.getElementById("recTimer");
      timerEl.classList.remove("hidden");
      recStartMs = Date.now();
      log("RECORDING LIVE! Record at least 3-5s & click buttons...");
      recTimerInt = setInterval(function () {
        var sec = Math.floor((Date.now() - recStartMs) / 1000);
        var mm = ("0" + Math.floor(sec / 60)).slice(-2);
        var ss = ("0" + (sec % 60)).slice(-2);
        timerEl.textContent = mm + ":" + ss + " • Recording 60fps + Motion...";
      }, 500);
    } catch (err) {
      log("Record error: " + err.message);
    }
  };

  document.getElementById("btnStop").onclick = async function () {
    clearInterval(recTimerInt);
    document.getElementById("recTimer").textContent = "Finalizing MP4 & Auto-Rigging...";
    try {
      var fs = getNode("fs"), path = getNode("path");
      if (fs && path && activeSessionDir) {
        fs.writeFileSync(path.join(activeSessionDir, "stop.signal"), "STOP", "utf8");
      } else {
        await callHost("stop_screen_recorder", { sessionDir: activeSessionDir });
      }
      var checks = 0;
      var poll = setInterval(async function () {
        checks++;
        try {
          var st = await callHost("check_recorder_done", { sessionDir: String(activeSessionDir).replace(/\\/g, "/") });
          if (st.done || checks > 24) {
            clearInterval(poll);
            document.getElementById("btnStop").classList.add("hidden");
            document.getElementById("btnRecord").classList.remove("hidden");
            document.getElementById("recTimer").classList.add("hidden");
            if (st.status && st.status.indexOf("FFMPEG_NOT_FOUND") !== -1) {
              var bar = document.getElementById("ffmpegBar");
              if (bar) bar.classList.remove("hidden");
              log("FFmpeg missing — click Auto-Install!");
              return;
            }
            await handleAutoRig({
              sessionFolder: String(activeSessionDir).replace(/\\/g, "/"),
              aspectPreset: document.getElementById("aspectSelect").value,
              autoZoom: document.getElementById("chkAutoZoom").checked,
              vectorCursor: document.getElementById("chkVectorCursor").checked,
              clickRipples: document.getElementById("chkRipples").checked
            });
          }
        } catch (e) {
          clearInterval(poll);
          log("Stop error: " + e.message);
        }
      }, 500);
    } catch (err) {
      log("Stop error: " + err.message);
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

  document.getElementById("btnRigFile").onclick = async function () {
    try {
      var pick = await callHost("pick_video_file", {});
      if (pick && pick.videoPath) {
        await handleAutoRig({
          videoPath: pick.videoPath,
          motionJsonPath: pick.motionJsonPath || "",
          aspectPreset: document.getElementById("aspectSelect").value,
          autoZoom: document.getElementById("chkAutoZoom").checked,
          vectorCursor: document.getElementById("chkVectorCursor").checked,
          clickRipples: document.getElementById("chkRipples").checked
        });
      }
    } catch (e) { log("Import error: " + e.message); }
  };

  var btnFfmpeg = document.getElementById("btnInstallFfmpeg");
  if (btnFfmpeg) {
    btnFfmpeg.onclick = function () {
      callHost("install_ffmpeg_winget", {}).then(function () { log("Winget FFmpeg installer opened!"); });
    };
  }

  var btnNewComp = document.getElementById("btnNewComp");
  if (btnNewComp) {
    btnNewComp.onclick = function () {
      callHost("create_composition", { name: "Pixopik_SaaS_Demo", preset: document.getElementById("aspectSelect").value })
        .then(function (r) { log("Created comp: " + r.compName); }).catch(function (e) { log(e.message); });
    };
  }

  document.getElementById("btnAddZoom").onclick = function () {
    callHost("add_smart_zoom_at_playhead", { zoomPercent: 195 }).then(function () { log("Added Smart Zoom!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btnSpotlight").onclick = function () {
    callHost("add_spotlight_at_playhead", {}).then(function () { log("Added Spotlight Focus!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btnBlur").onclick = function () {
    callHost("add_blur_at_playhead", {}).then(function () { log("Added Privacy Blur!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btnCallout").onclick = function () {
    callHost("add_callout_at_playhead", { text: "Pro Tip • Click Here" }).then(function () { log("Added SaaS Callout!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btnShorts").onclick = function () {
    callHost("convert_comp_for_shorts", { zoomPercent: 210 }).then(function () { log("Converted to 9:16 Shorts!"); }).catch(function (e) { log(e.message); });
  };
  document.getElementById("btn3dTilt").onclick = function () {
    callHost("apply_3d_saas_perspective", {}).then(function () { log("Applied 3D SaaS Tilt!"); }).catch(function (e) { log(e.message); });
  };

  document.getElementById("btnReconnect").onclick = connectWS;
  document.getElementById("btnClearLog").onclick = function () { logList.innerHTML = ""; };

  connectWS();
})();
