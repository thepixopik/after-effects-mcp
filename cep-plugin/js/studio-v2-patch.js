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

  var verSub = document.getElementById("verSubtitle");
  if (verSub) verSub.textContent = "Bandicam Pro Studio • v2.1";
  var qBan = document.getElementById("quickBanner");
  if (qBan) qBan.textContent = "v2.1 Live • Bandicam UI + Area / Rect / Window / Mouse Modes";

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

  function listOpenWindows(cb) {
    var ps = "Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.ProcessName -notmatch 'TextInputHost|ApplicationFrameHost' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress";
    cp.execFile("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 3500 }, function (_err, stdout) {
      try {
        var raw = JSON.parse((stdout || "[]").trim() || "[]");
        var arr = Array.isArray(raw) ? raw : [raw];
        cb(arr.filter(function (w) { return w && w.MainWindowTitle && w.MainWindowTitle.indexOf("Pixopik Recorder") === -1; }));
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
            date: new Date(st.mtimeMs).toLocaleTimeString(),
            res: (meta.screenWidth || 1920) + "x" + (meta.screenHeight || 1080),
            dur: meta.duration ? (Math.round(meta.duration) + "s") : ""
          });
        }
      }
      return out;
    } catch (_e) { return []; }
  }

  function runPicker(mode, w, h, cb) {
    var outJson = path.join(REC_ROOT, "picked_region.json");
    try { if (fs.existsSync(outJson)) fs.unlinkSync(outJson); } catch (_e) {}
    var args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", CAP_PS1, "-SessionDir", REC_ROOT, "-PickMode", mode];
    if (w && h) args.push("-InitW", String(w), "-InitH", String(h));
    var p = cp.spawn("powershell.exe", args, { windowsHide: false });
    p.on("close", function () {
      try {
        if (fs.existsSync(outJson)) {
          cb(JSON.parse(fs.readFileSync(outJson, "utf8")));
          return;
        }
      } catch (_er) {}
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
            runPicker("screenshot", 0, 0, function () {
              uiLog("Saved clean PNG screenshot in Videos/PixopikRecordings/Screenshots!");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }
          if (data.action === "open_folder") {
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

  srv.listen(0, "127.0.0.1", function () { studioPort = srv.address().port; });

  var studioBtn = document.getElementById("btnOpenRecorderStudio");
  if (studioBtn) {
    studioBtn.onclick = function () {
      if (!studioPort) { uiLog("Studio bridge starting..."); return; }
      var appUrl = "http://127.0.0.1:" + studioPort + "/studio?t=" + Date.now();
      var exe = findAppBrowserExe();
      if (exe) {
        cp.spawn(exe, ["--app=" + appUrl, "--window-size=760,520", "--window-position=520,170"], { detached: true, stdio: "ignore" }).unref();
        uiLog("Launched Bandicam-Style Recorder Studio v2.1!");
      } else {
        window.open(appUrl, "PixopikRecorderStudio", "width=760,height=520");
      }
    };
  }
})();
