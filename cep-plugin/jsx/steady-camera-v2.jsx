(function () {
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  function decB64(input) {
    var str = String(input || "").replace(/[^A-Za-z0-9\+\/\=]/g, ""), out = "", i = 0;
    while (i < str.length) {
      var e1 = B64.indexOf(str.charAt(i++)), e2 = B64.indexOf(str.charAt(i++));
      var e3 = B64.indexOf(str.charAt(i++)), e4 = B64.indexOf(str.charAt(i++));
      out += String.fromCharCode((e1 << 2) | (e2 >> 4));
      if (e3 !== 64) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
      if (e4 !== 64) out += String.fromCharCode(((e3 & 3) << 6) | e4);
    }
    try { return decodeURIComponent(escape(out)); } catch (_e) { return out; }
  }
  function encB64(utf8Str) {
    var s = unescape(encodeURIComponent(utf8Str)), out = "", i = 0;
    while (i < s.length) {
      var c1 = s.charCodeAt(i++), c2 = i < s.length ? s.charCodeAt(i++) : NaN, c3 = i < s.length ? s.charCodeAt(i++) : NaN;
      var e1 = c1 >> 2, e2 = ((c1 & 3) << 4) | (c2 >> 4), e3 = isNaN(c2) ? 64 : (((c2 & 15) << 2) | (c3 >> 6)), e4 = isNaN(c3) ? 64 : (c3 & 63);
      out += B64.charAt(e1) + B64.charAt(e2) + B64.charAt(e3) + B64.charAt(e4);
    }
    return out;
  }
  function toJson(val) {
    if (val === null || val === undefined) return "null";
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val === "string") return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    if (val instanceof Array) { var a = []; for (var i = 0; i < val.length; i++) a.push(toJson(val[i])); return "[" + a.join(",") + "]"; }
    var p = []; for (var k in val) { if (val.hasOwnProperty(k) && typeof val[k] !== "function") p.push(toJson(String(k)) + ":" + toJson(val[k])); }
    return "{" + p.join(",") + "}";
  }

  function readStudioV2Prefs() {
    try {
      var up = $.getenv("USERPROFILE");
      if (!up) return {};
      var f = new File(up + "/Videos/PixopikRecordings/studio_v2_prefs.json");
      if (f.exists && f.open("r")) {
        f.encoding = "UTF-8";
        var obj = eval("(" + f.read() + ")");
        f.close();
        return obj || {};
      }
    } catch (_e) {}
    return {};
  }

  function applyBandicamHdWallpaper(comp, bgPath) {
    if (!comp || !bgPath) return;
    try {
      var imgFile = new File(bgPath);
      if (!imgFile.exists) return;
      var io = new ImportOptions(imgFile);
      var ft = app.project.importFile(io);
      var bgLayer = null;
      for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name.indexOf("01_") === 0 || comp.layer(i).name.indexOf("Backdrop") !== -1) bgLayer = comp.layer(i);
      }
      var lyr = comp.layers.add(ft);
      lyr.name = "01B_Bandicam_HD_Wallpaper";
      if (bgLayer) lyr.moveBefore(bgLayer); else lyr.moveToEnd();
      var sc = Math.max((comp.width / Math.max(1, ft.width)) * 100, (comp.height / Math.max(1, ft.height)) * 100);
      lyr.property("ADBE Transform Group").property("ADBE Scale").setValue([sc, sc]);
      lyr.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    } catch (_ebg) {}
  }

  function smoothCursorKeysEMA(keys) {
    if (!keys || keys.length < 4) return keys || [];
    var out = [keys[0]], sx = keys[0].x, sy = keys[0].y;
    for (var i = 1; i < keys.length - 1; i++) {
      sx = sx + 0.44 * (keys[i].x - sx);
      sy = sy + 0.44 * (keys[i].y - sy);
      out.push({ t: keys[i].t, x: Math.round(sx), y: Math.round(sy) });
    }
    out.push(keys[keys.length - 1]);
    return out;
  }

  function setBatch(prop, pairs, dur) {
    if (!prop || !pairs || !pairs.length) return;
    pairs.sort(function (a, b) { return a.t - b.t; });
    var ts = [], vs = [], last = -99, lim = Math.max(0.2, dur - 0.01);
    for (var i = 0; i < pairs.length; i++) {
      var t = Math.max(0, Math.min(lim, pairs[i].t));
      if (t <= last + 0.004) t = last + 0.005;
      if (t > lim) break;
      ts.push(t); vs.push(pairs[i].v); last = t;
    }
    if (ts.length === 1) prop.setValueAtTime(ts[0], vs[0]);
    else if (ts.length > 1) prop.setValuesAtTimes(ts, vs);
  }

  function easeSteady(prop) {
    var n = prop.numKeys;
    if (n < 2 || n > 160) return;
    var dims = (prop.keyValue(1) instanceof Array) ? prop.keyValue(1).length : 1;
    var eIn = [], eOut = [];
    for (var d = 0; d < dims; d++) { eIn.push(new KeyframeEase(0, 88)); eOut.push(new KeyframeEase(0, 88)); }
    for (var k = 1; k <= n; k++) {
      try {
        prop.setTemporalEaseAtKey(k, eIn, eOut);
        prop.setSpatialContinuousAtKey(k, false);
      } catch (_e) {}
    }
  }

  /* =========================================================================
   * v3.4 MINIMUM PIXEL DISTANCE TRAVEL DOLLY + EDGE-CLAMP LOCK!
   * Cursor move < minDollyPx (default 550px) => 0% camera movement!
   * ========================================================================= */
  function buildDistanceLockedDolly(comp, events, zoomPct, minDollyPx) {
    var camNull = null, curLayer = null, scrLayer = null;
    for (var l = 1; l <= comp.numLayers; l++) {
      var lyr = comp.layer(l);
      if (lyr.name === "05_Smart_Camera_Rig") camNull = lyr;
      if (lyr.name === "04_Vector_Cursor") curLayer = lyr;
      if (!scrLayer && (lyr.name.indexOf("Screen") !== -1 || lyr.name.indexOf("screen.mp4") !== -1 || lyr.name.indexOf("02_") === 0) && lyr.width > 200) {
        scrLayer = lyr;
      }
    }
    if (!camNull) return { glides: 0, locked: 0 };

    /* Attach / sync live Slider Control on 05_Smart_Camera_Rig */
    var minDist = parseFloat(minDollyPx) || 550;
    try {
      var fx = camNull.property("ADBE Effect Parade");
      var sl = fx.property("Dolly_Min_Distance_Px");
      if (!sl) {
        sl = fx.addProperty("ADBE Slider Control");
        sl.name = "Dolly_Min_Distance_Px";
      }
      sl.property(1).setValue(minDist);
    } catch (_esl) {}

    var camPos = camNull.property("ADBE Transform Group").property("ADBE Position");
    var camScl = camNull.property("ADBE Transform Group").property("ADBE Scale");
    while (camPos.numKeys > 0) camPos.removeKey(camPos.numKeys);
    while (camScl.numKeys > 0) camScl.removeKey(camScl.numKeys);
    camPos.expression = "";
    camScl.expression = "";

    var cx = comp.width / 2.0, cy = comp.height / 2.0, dur = comp.duration;
    camPos.setValue([cx, cy]);
    camScl.setValue([100, 100]);
    if (!events || !events.length) return { glides: 0, locked: 0 };

    var z = (zoomPct || 145) / 100.0;

    /* Tight Edge-Clamp Lock so screen edge NEVER pulls awkwardly inside frame! */
    var fitHalfW = comp.width * 0.475;
    var fitHalfH = comp.height * 0.475;
    if (scrLayer) {
      try {
        var scVal = scrLayer.property("ADBE Transform Group").property("ADBE Scale").value;
        fitHalfW = (scrLayer.width * (scVal[0] / 100.0)) / 2.0;
        fitHalfH = (scrLayer.height * (scVal[1] / 100.0)) / 2.0;
      } catch (_esc) {}
    }
    var maxPanX = Math.max(0, z * fitHalfW - cx + 16);
    var maxPanY = Math.max(0, z * fitHalfH - cy + 16);

    function camTargetForCompPt(px, py) {
      var tx = cx - z * (px - cx);
      var ty = cy - z * (py - cy);
      return [
        Math.max(cx - maxPanX, Math.min(cx + maxPanX, tx)),
        Math.max(cy - maxPanY, Math.min(cy + maxPanY, ty))
      ];
    }

    var cPos = curLayer ? curLayer.property("ADBE Transform Group").property("ADBE Position") : null;
    var pKeys = [{ t: 0, v: [cx, cy] }], sKeys = [{ t: 0, v: [100, 100] }];
    var isZoomed = false, curFocus = [cx, cy], curCamPt = [cx, cy], lastEvtT = 0, lastGlideT = 0;
    var glides = 0, locked = 0;

    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.t < 0.7 || ev.t > dur - 0.9) continue;
      var pt = cPos ? cPos.valueAtTime(ev.t, false) : [cx, cy];

      if (isZoomed && (ev.t - lastEvtT) > 9.5) {
        var zoomOutStart = lastEvtT + 2.0;
        var zoomOutEnd   = Math.min(ev.t - 0.9, zoomOutStart + 0.75);
        if (zoomOutEnd > zoomOutStart + 0.2) {
          pKeys.push({ t: zoomOutStart, v: curCamPt }); sKeys.push({ t: zoomOutStart, v: [zoomPct, zoomPct] });
          pKeys.push({ t: zoomOutEnd, v: [cx, cy] });   sKeys.push({ t: zoomOutEnd, v: [100, 100] });
          isZoomed = false;
        }
      }

      if (!isZoomed) {
        var tStart = Math.max(0.08, ev.t - 0.58);
        curFocus = [pt[0], pt[1]];
        curCamPt = camTargetForCompPt(pt[0], pt[1]);
        pKeys.push({ t: tStart, v: [cx, cy] }); sKeys.push({ t: tStart, v: [100, 100] });
        pKeys.push({ t: ev.t, v: curCamPt });   sKeys.push({ t: ev.t, v: [zoomPct, zoomPct] });
        isZoomed = true; lastEvtT = ev.t; lastGlideT = ev.t; glides++;
      } else {
        var dx = pt[0] - curFocus[0], dy = pt[1] - curFocus[1];
        var distPx = Math.sqrt(dx * dx + dy * dy);
        if (distPx >= minDist && (ev.t - lastGlideT) >= 1.0) {
          var panStart = Math.max(lastGlideT + 0.3, ev.t - 0.65);
          pKeys.push({ t: panStart, v: curCamPt }); sKeys.push({ t: panStart, v: [zoomPct, zoomPct] });
          curFocus = [pt[0], pt[1]];
          curCamPt = camTargetForCompPt(pt[0], pt[1]);
          pKeys.push({ t: ev.t, v: curCamPt });     sKeys.push({ t: ev.t, v: [zoomPct, zoomPct] });
          lastGlideT = ev.t; glides++;
        } else {
          locked++;
        }
        lastEvtT = ev.t;
      }
    }

    if (isZoomed) {
      var holdT = Math.min(dur - 0.85, lastEvtT + 1.4);
      var endT  = Math.min(dur - 0.05, Math.max(holdT + 0.68, dur - 0.12));
      if (holdT > lastGlideT + 0.06) {
        pKeys.push({ t: holdT, v: curCamPt }); sKeys.push({ t: holdT, v: [zoomPct, zoomPct] });
      }
      pKeys.push({ t: endT, v: [cx, cy] }); sKeys.push({ t: endT, v: [100, 100] });
    }

    setBatch(camPos, pKeys, dur);
    setBatch(camScl, sKeys, dur);
    easeSteady(camPos);
    easeSteady(camScl);
    return { glides: glides, locked: locked, minDist: minDist };
  }

  function extractClickEventsFromComp(comp) {
    var cur = null;
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === "04_Vector_Cursor") cur = comp.layer(i);
    var evs = [];
    if (cur) {
      var sc = cur.property("ADBE Transform Group").property("ADBE Scale");
      var lastT = -10;
      for (var k = 1; k <= sc.numKeys; k++) {
        var kv = sc.keyValue(k), kt = sc.keyTime(k);
        if (kv[0] < 92 && (kt - lastT) > 0.22) { evs.push({ t: kt }); lastT = kt; }
      }
    }
    return evs;
  }

  /* Expose direct helper so AE panel can apply custom px distance in 0.05s! */
  $.global.PixopikApplyDollyDistance = function (minPx, zoomOpt) {
    if (!app.project) return '{"ok":false,"error":"No project"}';
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      for (var i = app.project.numItems; i >= 1; i--) {
        if (app.project.item(i) instanceof CompItem) { comp = app.project.item(i); break; }
      }
    }
    if (!comp || !(comp instanceof CompItem)) return '{"ok":false,"error":"Open a composition first!"}';
    app.beginUndoGroup("Apply " + minPx + "px Dolly Distance Lock");
    try {
      var evs = extractClickEventsFromComp(comp);
      var r = buildDistanceLockedDolly(comp, evs, zoomOpt || 145, minPx || 550);
      return toJson({ ok: true, compName: comp.name, glides: r.glides, lockedClicks: r.locked, minDistPx: r.minDist });
    } catch (e) {
      return toJson({ ok: false, error: String(e) });
    } finally {
      app.endUndoGroup();
    }
  };

  if (typeof PixopikAE !== "undefined") {
    var baseDispatch = PixopikAE._origBaseDispatch || PixopikAE.dispatch;
    PixopikAE._origBaseDispatch = baseDispatch;

    PixopikAE.dispatch = function (action, b64Args) {
      if (action === "import_and_autorig_recording") {
        try {
          var parsed = b64Args ? eval("(" + decB64(b64Args) + ")") : {};
          var full = parsed;
          if (parsed.payloadFile) {
            var pf = new File(parsed.payloadFile);
            if (pf.exists && pf.open("r")) { pf.encoding = "UTF-8"; full = eval("(" + pf.read() + ")"); pf.close(); }
          }
          var v2Prefs = readStudioV2Prefs();
          var camMode = v2Prefs.cameraMode || full.cameraMode || "dolly_steady";
          var zPct    = v2Prefs.zoomPercent || full.zoomPercent || 145;
          var minPx   = v2Prefs.minDollyPx || 550;
          var cSmooth = v2Prefs.cursorSmooth || "high";

          if (cSmooth === "high" && full.motion && full.motion.cursorKeys) {
            full.motion.cursorKeys = smoothCursorKeysEMA(full.motion.cursorKeys);
          }

          if (camMode === "dolly_steady" || camMode === "smooth_travel" || camMode === "static_lock") {
            var origAuto = full.autoZoom;
            full.autoZoom = false;
            if (parsed.payloadFile) {
              var wf = new File(parsed.payloadFile);
              wf.encoding = "UTF-8";
              if (wf.open("w")) { wf.write(toJson(full)); wf.close(); }
            }
            var baseRaw = baseDispatch(action, encB64(toJson(parsed.payloadFile ? parsed : full)));
            var baseRes = eval("(" + baseRaw + ")");
            if (baseRes && baseRes.ok) {
              var comp = app.project.activeItem;
              app.beginUndoGroup("Distance-Locked Dolly v3.4");
              try {
                if (v2Prefs.bgImagePath) applyBandicamHdWallpaper(comp, v2Prefs.bgImagePath);
                if (origAuto !== false && camMode !== "static_lock") {
                  var m = full.motion || {};
                  var evts = (m.clicks || []).concat(m.zoomPins || []);
                  evts.sort(function (a, b) { return a.t - b.t; });
                  var stats = buildDistanceLockedDolly(comp, evts, zPct, minPx);
                  baseRes.autoZoomClusters = stats.glides;
                  baseRes.minDollyPx = minPx;
                }
              } finally { app.endUndoGroup(); }
            }
            return toJson(baseRes);
          }
        } catch (_errV2) {}
      }
      if (action === "apply_smooth_travel") {
        var vp = readStudioV2Prefs();
        return $.global.PixopikApplyDollyDistance(vp.minDollyPx || 550, vp.zoomPercent || 145);
      }
      return baseDispatch(action, b64Args);
    };
  }
})();
