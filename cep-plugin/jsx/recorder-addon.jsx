(function () {
  if (typeof PixopikAE === "undefined") return;
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  function decodeB64(input) {
    var str = String(input || "").replace(/[^A-Za-z0-9\+\/\=]/g, "");
    var out = "", i = 0;
    while (i < str.length) {
      var e1 = B64.indexOf(str.charAt(i++)), e2 = B64.indexOf(str.charAt(i++));
      var e3 = B64.indexOf(str.charAt(i++)), e4 = B64.indexOf(str.charAt(i++));
      out += String.fromCharCode((e1 << 2) | (e2 >> 4));
      if (e3 !== 64) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
      if (e4 !== 64) out += String.fromCharCode(((e3 & 3) << 6) | e4);
    }
    try { return decodeURIComponent(escape(out)); } catch (_e) { return out; }
  }
  function encodeBytesB64(binStr) {
    var out = "", i = 0, len = binStr.length;
    while (i < len) {
      var b1 = binStr.charCodeAt(i++) & 255;
      var has2 = i < len, b2 = has2 ? (binStr.charCodeAt(i++) & 255) : 0;
      var has3 = i < len, b3 = has3 ? (binStr.charCodeAt(i++) & 255) : 0;
      out += B64.charAt(b1 >> 2);
      out += B64.charAt(((b1 & 3) << 4) | (b2 >> 4));
      out += has2 ? B64.charAt(((b2 & 15) << 2) | (b3 >> 6)) : "=";
      out += has3 ? B64.charAt(b3 & 63) : "=";
    }
    return out;
  }
  function toJson(val) {
    if (val === null || val === undefined) return "null";
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val === "string") {
      return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
    }
    if (val instanceof Array) {
      var a = []; for (var i = 0; i < val.length; i++) a.push(toJson(val[i]));
      return "[" + a.join(",") + "]";
    }
    var p = [];
    for (var k in val) { if (val.hasOwnProperty(k) && typeof val[k] !== "function") p.push(toJson(String(k)) + ":" + toJson(val[k])); }
    return "{" + p.join(",") + "}";
  }
  function parseJson(txt) { return eval("(" + txt + ")"); }
  function getRecRoot() {
    var home = $.getenv("USERPROFILE") || Folder.myDocuments.parent.fsName;
    var root = new Folder(home.replace(/\\/g, "/") + "/Videos/PixopikRecordings");
    if (!root.exists) root.create();
    return root;
  }
  function readUtf8(f) {
    if (!f.exists) return "";
    f.encoding = "UTF-8"; f.open("r"); var t = f.read(); f.close(); return t;
  }
  function writeUtf8(f, txt) {
    f.encoding = "UTF-8";
    if (!f.open("w")) throw new Error("Cannot write files! Turn ON: Edit > Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network");
    f.write(txt); f.close();
  }
  var extra = {
    start_screen_recorder: function (args) {
      var root = getRecRoot();
      var d = new Date();
      var stamp = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() + "_" + d.getHours() + "-" + d.getMinutes() + "-" + d.getSeconds();
      var sessFolder = new Folder(root.fsName.replace(/\\/g, "/") + "/rec_" + stamp);
      if (!sessFolder.create()) throw new Error("Allow Scripts to Write Files is OFF in AE Preferences!");
      var appData = $.getenv("APPDATA").replace(/\\/g, "/");
      var extDir = (args && args.extRoot) ? String(args.extRoot).replace(/\\/g, "/") : (appData + "/Adobe/CEP/extensions/com.thepixopik.aftereffects.mcp");
      var psFile = new File(extDir + "/recorder/capture-session.ps1");
      if (!psFile.exists) psFile = new File(appData + "/Adobe/CEP/extensions/com.thepixopik.aftereffects.mcp/recorder/capture-session.ps1");
      if (!psFile.exists) throw new Error("Recorder script missing at: " + psFile.fsName);
      var launchPs1 = new File(sessFolder.fsName.replace(/\\/g, "/") + "/launch-bg.ps1");
      var psClean = psFile.fsName.replace(/'/g, "''");
      var sdClean = sessFolder.fsName.replace(/'/g, "''");
      var scriptLines = "$ps = '" + psClean + "'\r\n$sd = '" + sdClean + "'\r\nStart-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$ps,'-SessionDir',$sd,'-Fps','60')\r\n";
      writeUtf8(launchPs1, scriptLines);
      system.callSystem('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + launchPs1.fsName + '"');
      return { ok: true, sessionDir: sessFolder.fsName.replace(/\\/g, "/") };
    },
    stop_screen_recorder: function (args) {
      var sig = new File(String(args.sessionDir || "").replace(/\\/g, "/") + "/stop.signal");
      writeUtf8(sig, "STOP");
      return { ok: true };
    },
    check_recorder_done: function (args) {
      var doneF = new File(String(args.sessionDir || "").replace(/\\/g, "/") + "/done.signal");
      if (!doneF.exists) return { ok: true, done: false };
      return { ok: true, done: true, status: readUtf8(doneF) };
    },
    resolve_recording_session: function (args) {
      var vPath = args.videoPath || "";
      var mPath = args.motionJsonPath || "";
      if (!vPath) {
        var folderPath = args.sessionFolder;
        if (!folderPath || folderPath === "latest") {
          var root = getRecRoot();
          var items = root.getFiles();
          var best = null, bestTime = 0;
          for (var i = 0; i < items.length; i++) {
            if (items[i] instanceof Folder) {
              var mp4 = new File(items[i].fsName.replace(/\\/g, "/") + "/screen.mp4");
              if (mp4.exists && mp4.modified.getTime() >= bestTime) { best = items[i]; bestTime = mp4.modified.getTime(); }
            }
          }
          if (!best) throw new Error("No recorded MP4 found yet.");
          folderPath = best.fsName;
        }
        var cleanDir = String(folderPath).replace(/\\/g, "/");
        vPath = cleanDir + "/screen.mp4";
        mPath = cleanDir + "/motion.json";
      }
      var mFile = mPath ? new File(mPath) : null;
      return { ok: true, videoPath: String(vPath).replace(/\\/g, "/"), motionText: (mFile && mFile.exists) ? readUtf8(mFile) : "" };
    },
    pick_video_file: function () {
      var f = File.openDialog("Select Screen Recording (.mp4 / .mov)");
      if (!f) return { ok: true, videoPath: "" };
      var vp = f.fsName.replace(/\\/g, "/");
      var mf = new File(f.parent.fsName.replace(/\\/g, "/") + "/motion.json");
      return { ok: true, videoPath: vp, motionJsonPath: mf.exists ? mf.fsName.replace(/\\/g, "/") : "" };
    },
    install_ffmpeg_winget: function () {
      system.callSystem('powershell.exe -Command "Start-Process powershell.exe -ArgumentList \'-NoExit\',\'-Command\',\'winget install --id Gyan.FFmpeg -e\'"');
      return { ok: true };
    },
    export_frame_preview_b64: function (args) {
      var comp = app.project ? app.project.activeItem : null;
      if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
      var t = (args && args.timeSeconds !== undefined) ? Number(args.timeSeconds) : comp.time;
      var tmp = new File(Folder.temp.fsName.replace(/\\/g, "/") + "/px_ae_prev_" + (new Date().getTime()) + ".png");
      comp.saveFrameToPng(t, tmp);
      var b64 = "";
      if (tmp.exists) { tmp.encoding = "BINARY"; tmp.open("r"); var bin = tmp.read(); tmp.close(); b64 = encodeBytesB64(bin); tmp.remove(); }
      return { ok: true, comp: comp.name, timeSeconds: t, base64: b64 };
    }
  };
  var baseDispatch = PixopikAE._baseDispatch || PixopikAE.dispatch;
  PixopikAE._baseDispatch = baseDispatch;
  PixopikAE.dispatch = function (action, b64Args) {
    if (extra[action]) {
      try {
        var args = b64Args ? parseJson(decodeB64(b64Args)) : {};
        return toJson(extra[action](args));
      } catch (e) {
        return toJson({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    }
    return baseDispatch(action, b64Args);
  };
  PixopikAE._addonLoaded = true;
})();
