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
  var STUDIO_PS1  = path.join(EXT_ROOT, "recorder", "recorder-studio.ps1");
  var REC_ROOT    = path.join(os.homedir(), "Videos", "PixopikRecordings");
  var CMD_FILE    = path.join(REC_ROOT, "studio_v2_cmd.txt");
  var PREFS_FILE  = path.join(REC_ROOT, "studio_v2_prefs.json");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

  function injectSteadyJsx() {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function" && fs.existsSync(STEADY_JSX)) {
      var p = STEADY_JSX.replace(/\\/g, "/");
      window.__adobe_cep__.evalScript('try { $.evalFile(new File("' + p + '")); } catch(_e) {}');
    }
  }
  setTimeout(injectSteadyJsx, 450);
  setTimeout(injectSteadyJsx, 1800);

  var studioBtn = document.getElementById("btnOpenRecorderStudio");
  var studioProc = null;

  if (studioBtn) {
    studioBtn.onclick = function () {
      try { if (fs.existsSync(CMD_FILE)) fs.unlinkSync(CMD_FILE); } catch (_e) {}
      if (studioProc && !studioProc.killed) { try { studioProc.kill(); } catch (_k) {} }

      /* Direct -File launch (zero Base64 -EncodedCommand so Windows Defender stays 100% happy!) */
      studioProc = cp.spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA",
        "-File", STUDIO_PS1,
        "-CommandFile", CMD_FILE,
        "-PrefsFile", PREFS_FILE
      ], { windowsHide: false });

      var banner = document.getElementById("quickBanner");
      if (banner) banner.textContent = "🎬 Pro Recorder Studio Open • Set Camera & Start!";
    };
  }

  /* Poll lightweight command bridge from Dedicated Recorder Studio window */
  setInterval(function () {
    if (!fs.existsSync(CMD_FILE)) return;
    var cmd = "";
    try {
      cmd = fs.readFileSync(CMD_FILE, "utf8").trim();
      fs.unlinkSync(CMD_FILE);
    } catch (_e) { return; }
    if (!cmd) return;

    if (cmd === "OPEN_CHROME") {
      var bc = document.getElementById("btnLaunchChrome");
      if (bc) bc.click();
    } else if (cmd === "OPEN_GHOST") {
      var bg = document.getElementById("btnGhostBar");
      if (bg) bg.click();
    } else if (cmd.indexOf("DIM:") === 0) {
      var pct = cmd.split(":")[1] || "0";
      var ds = document.getElementById("ghostDimSelect");
      if (ds) { ds.value = pct; if (ds.onchange) ds.onchange(); }
    } else if (cmd === "START_RECORD") {
      injectSteadyJsx();
      var prefs = {};
      try { if (fs.existsSync(PREFS_FILE)) prefs = JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")); } catch (_ep) {}
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
      if (recBtn) setTimeout(function () { recBtn.click(); }, 150);
    }
  }, 320);
})();
