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

  var EXT_ROOT       = getExtRoot();
  var STEADY_JSX     = path.join(EXT_ROOT, "jsx", "steady-camera-v2.jsx");
  var STUDIO_PS1     = path.join(EXT_ROOT, "recorder", "recorder-studio.ps1");
  var BROWSER_SCRIPT = path.join(EXT_ROOT, "recorder", "studio-browser.ps1");
  var GHOST_SCRIPT   = path.join(EXT_ROOT, "recorder", "ghost-presenter.ps1");
  var DIMMER_SCRIPT  = path.join(EXT_ROOT, "recorder", "ghost-dimmer.ps1");
  var REC_ROOT       = path.join(os.homedir(), "Videos", "PixopikRecordings");
  var SIGNAL_FILE    = path.join(REC_ROOT, "studio_v2_done.signal");

  function injectSteadyJsx() {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function" && fs.existsSync(STEADY_JSX)) {
      var p = STEADY_JSX.replace(/\\/g, "/");
      window.__adobe_cep__.evalScript('try { $.evalFile(new File("' + p + '")); } catch(_e) {}');
    }
  }
  setTimeout(injectSteadyJsx, 500);
  setTimeout(injectSteadyJsx, 2000);

  function smoothCursorSamples(samples, mode) {
    if (!samples || samples.length < 4 || mode === "raw") return samples || [];
    var out = [samples[0]];
    var sx = samples[0].x, sy = samples[0].y;
    var alpha = 0.42; /* EMA wrist-tremor stabilizer */
    for (var i = 1; i < samples.length - 1; i++) {
      sx = sx + alpha * (samples[i].x - sx);
      sy = sy + alpha * (samples[i].y - sy);
      out.push({ t: samples[i].t, x: Math.round(sx), y: Math.round(sy) });
    }
    out.push(samples[samples.length - 1]);
    return out;
  }

  function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

  var studioBtn = document.getElementById("btnOpenRecorderStudio");
  var studioProc = null;

  if (studioBtn) {
    studioBtn.onclick = function () {
      try { if (fs.existsSync(SIGNAL_FILE)) fs.unlinkSync(SIGNAL_FILE); } catch (_e) {}
      if (studioProc && !studioProc.killed) { try { studioProc.kill(); } catch (_k) {} }

      var cmd = "& " + psQuote(STUDIO_PS1) +
        " -RecordingsRoot " + psQuote(REC_ROOT) +
        " -SignalOutFile " + psQuote(SIGNAL_FILE) +
        " -BrowserScript " + psQuote(BROWSER_SCRIPT) +
        " -GhostScript " + psQuote(GHOST_SCRIPT) +
        " -DimmerScript " + psQuote(DIMMER_SCRIPT);

      var enc = Buffer.from(cmd, "utf16le").toString("base64");
      studioProc = cp.spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-EncodedCommand", enc], { windowsHide: true });

      var banner = document.getElementById("quickBanner");
      if (banner) banner.textContent = "🎬 Floating Recorder Studio Active • Configure & Record!";
    };
  }

  /* Watch for completed session from Floating Recorder Studio */
  setInterval(function () {
    if (!fs.existsSync(SIGNAL_FILE)) return;
    var sessDir = "";
    try {
      sessDir = fs.readFileSync(SIGNAL_FILE, "utf8").trim();
      fs.unlinkSync(SIGNAL_FILE);
    } catch (_e) { return; }
    if (!sessDir || !fs.existsSync(sessDir)) return;

    injectSteadyJsx();
    var prefsPath = path.join(sessDir, "studio_prefs.json");
    var motPath   = path.join(sessDir, "motion.json");
    var prefs = {};
    try { if (fs.existsSync(prefsPath)) prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8")); } catch (_ep) {}

    if (fs.existsSync(motPath) && prefs.cursorSmooth === "high") {
      try {
        var mot = JSON.parse(fs.readFileSync(motPath, "utf8").replace(/^\uFEFF/, ""));
        mot.samples = smoothCursorSamples(mot.samples || [], "high");
        fs.writeFileSync(motPath, JSON.stringify(mot), "utf8");
      } catch (_em) {}
    }

    /* Sync UI dropdowns in AE panel to match Recorder Studio choices before triggering Turbo-Rig! */
    try {
      if (prefs.editMode && document.getElementById("modeSelect")) document.getElementById("modeSelect").value = prefs.editMode;
      if (prefs.aspectPreset && document.getElementById("aspectSelect")) document.getElementById("aspectSelect").value = prefs.aspectPreset;
      if (prefs.wallpaper && document.getElementById("wallpaperSelect")) document.getElementById("wallpaperSelect").value = prefs.wallpaper;
      if (prefs.frameStyle && document.getElementById("frameStyleSelect")) document.getElementById("frameStyleSelect").value = prefs.frameStyle;
      if (typeof prefs.clickSfx === "boolean" && document.getElementById("chkClickSfx")) document.getElementById("chkClickSfx").checked = prefs.clickSfx;
      if (typeof prefs.clickRipples === "boolean" && document.getElementById("chkRipples")) document.getElementById("chkRipples").checked = prefs.clickRipples;
      if (typeof prefs.autoZoom === "boolean" && document.getElementById("chkAutoZoom")) document.getElementById("chkAutoZoom").checked = prefs.autoZoom;
      if (prefs.cameraMode && document.getElementById("cameraModeSelect")) {
        document.getElementById("cameraModeSelect").value = (prefs.cameraMode === "click_bounce") ? "click_bounce" : "smooth_travel";
      }
    } catch (_es) {}

    if (prefs.autoRig !== false) {
      var rigBtn = document.getElementById("btnRigLatest");
      if (rigBtn) setTimeout(function () { rigBtn.click(); }, 250);
    }
  }, 550);
})();
