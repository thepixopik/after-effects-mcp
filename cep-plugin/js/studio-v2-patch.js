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
  var REC_ROOT    = path.join(os.homedir(), "Videos", "PixopikRecordings");
  var PREFS_FILE  = path.join(REC_ROOT, "studio_v2_prefs.json");
  try { fs.mkdirSync(REC_ROOT, { recursive: true }); } catch (_e) {}

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

  /* Localhost Studio Bridge Server (Zero PowerShell UI, Zero Defender warnings, Instant Window!) */
  var studioPort = 0;
  var srv = http.createServer(function (req, res) {
    if (req.method === "GET" && (req.url === "/" || req.url.indexOf("/studio") === 0)) {
      try {
        var html = fs.readFileSync(STUDIO_HTML, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(html);
      } catch (e) {
        res.writeHead(500); res.end("Studio HTML missing: " + e.message);
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/action") {
      var body = "";
      req.on("data", function (c) { body += c; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body || "{}");
          if (data.action === "open_chrome") {
            var bc = document.getElementById("btnLaunchChrome"); if (bc) bc.click();
          } else if (data.action === "open_ghost") {
            var bg = document.getElementById("btnGhostBar"); if (bg) bg.click();
          } else if (data.action === "set_dim") {
            var ds = document.getElementById("ghostDimSelect");
            if (ds) { ds.value = String(data.pct || "0"); if (ds.onchange) ds.onchange(); }
          } else if (data.action === "start_record") {
            applyStudioPrefsAndStart(data.prefs || {});
          } else if (data.action === "stop_record") {
            var bs = document.getElementById("btnStop"); if (bs) bs.click();
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end("Not found");
  });

  srv.listen(0, "127.0.0.1", function () {
    studioPort = srv.address().port;
  });

  var studioBtn = document.getElementById("btnOpenRecorderStudio");
  if (studioBtn) {
    studioBtn.onclick = function () {
      if (!studioPort) { uiLog("Studio bridge starting, click again in 1s..."); return; }
      var appUrl = "http://127.0.0.1:" + studioPort + "/studio?t=" + Date.now();
      var exe = findAppBrowserExe();
      if (exe) {
        var child = cp.spawn(exe, [
          "--app=" + appUrl,
          "--window-size=475,625",
          "--window-position=720,140"
        ], { detached: true, stdio: "ignore" });
        child.unref();
        uiLog("Launched Floating Recorder Studio Window!");
      } else {
        window.open(appUrl, "PixopikRecorderStudio", "width=475,height=625");
        uiLog("Opened Recorder Studio Popup!");
      }
      var banner = document.getElementById("quickBanner");
      if (banner) banner.textContent = "🎬 Floating Recorder Studio Open • Ready!";
    };
  }
})();
