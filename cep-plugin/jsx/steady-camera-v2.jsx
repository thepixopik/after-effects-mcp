(function () {
  if (typeof PixopikAE === "undefined" || PixopikAE._steadyV2Loaded) return;

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

  function setBatch(prop, pairs, dur) {
    if (!prop || !pairs || !pairs.length) return;
    pairs.sort(function (a, b) { return a.t - b.t; });
    var ts = [], vs = [], last = -99;
    var lim = Math.max(0.2, dur - 0.01);
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
    if (n < 2 || n > 140) return;
    var dims = (prop.keyValue(1) instanceof Array) ? prop.keyValue(1).length : 1;
    var eIn = [], eOut = [];
    for (var d = 0; d < dims; d++) { eIn.push(new KeyframeEase(0, 86)); eOut.push(new KeyframeEase(0, 86)); }
    for (var k = 1; k <= n; k++) {
      try {
        prop.setTemporalEaseAtKey(k, eIn, eOut);
        prop.setSpatialContinuousAtKey(k, false); /* Linear spatial path = ZERO curved overshoot wobble! */
      } catch (_e) {}
    }
  }

  /* ROCK-STEADY SAFE-ZONE CAMERA: 0% mouse-hover shake! Moves ONLY on outside-safe-box clicks/pins! */
  function buildRockSteadyDolly(comp, events, zoomPct, deadZoneRatio) {
    var camNull = null, curLayer = null;
    for (var l = 1; l <= comp.numLayers; l++) {
      if (comp.layer(l).name === "05_Smart_Camera_Rig") camNull = comp.layer(l);
      if (comp.layer(l).name === "04_Vector_Cursor") curLayer = comp.layer(l);
    }
    if (!camNull) return 0;

    var camPos = camNull.property("ADBE Transform Group").property("ADBE Position");
    var camScl = camNull.property("ADBE Transform Group").property("ADBE Scale");
    while (camPos.numKeys > 0) camPos.removeKey(camPos.numKeys);
    while (camScl.numKeys > 0) camScl.removeKey(camScl.numKeys);
    camPos.expression = ""; /* Remove continuous Gimbal drift completely! */
    camScl.expression = "";

    var cx = comp.width / 2, cy = comp.height / 2, dur = comp.duration;
    camPos.setValue([cx, cy]); camScl.setValue([100, 100]);
    if (!events || !events.length) return 0;

    var z = (zoomPct || 150) / 100;
    var dz = deadZoneRatio || 0.65;
    var safeHalfW = ((comp.width / z) * dz) / 2;
    var safeHalfH = ((comp.height / z) * dz) / 2;

    function camTargetForCompPt(px, py) {
      var tx = cx - z * (px - cx), ty = cy - z * (py - cy);
      var maxX = (comp.width * (z - 1)) * 0.47, maxY = (comp.height * (z - 1)) * 0.47;
      return [Math.max(cx - maxX, Math.min(cx + maxX, tx)), Math.max(cy - maxY, Math.min(cy + maxY, ty))];
    }

    var cPos = curLayer ? curLayer.property("ADBE Transform Group").property("ADBE Position") : null;
    var pKeys = [{ t: 0, v: [cx, cy] }], sKeys = [{ t: 0, v: [100, 100] }];
    var isZoomed = false, curFocus = [cx, cy], curCamPt = [cx, cy], lastEvtT = 0, moves = 0;

    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.t < 0.75 || ev.t > dur - 0.9) continue;
      var pt = cPos ? cPos.valueAtTime(ev.t, false) : [cx, cy];

      if (isZoomed && (ev.t - lastEvtT) > 9.0) {
        var zoomOutStart = lastEvtT + 1.8;
        var zoomOutEnd   = Math.min(ev.t - 0.9, zoomOutStart + 0.75);
        if (zoomOutEnd > zoomOutStart + 0.2) {
          pKeys.push({ t: zoomOutStart, v: curCamPt }); sKeys.push({ t: zoomOutStart, v: [zoomPct, zoomPct] });
          pKeys.push({ t: zoomOutEnd, v: [cx, cy] });   sKeys.push({ t: zoomOutEnd, v: [100, 100] });
          isZoomed = false;
        }
      }

      if (!isZoomed) {
        var tStart = Math.max(0.08, ev.t - 0.55);
        curFocus = [pt[0], pt[1]];
        curCamPt = camTargetForCompPt(pt[0], pt[1]);
        pKeys.push({ t: tStart, v: [cx, cy] });  sKeys.push({ t: tStart, v: [100, 100] });
        pKeys.push({ t: ev.t, v: curCamPt });    sKeys.push({ t: ev.t, v: [zoomPct, zoomPct] });
        isZoomed = true; lastEvtT = ev.t; moves++;
      } else {
        var outsideSafeBox = (Math.abs(pt[0] - curFocus[0]) > safeHalfW) || (Math.abs(pt[1] - curFocus[1]) > safeHalfH);
        if (outsideSafeBox && (ev.t - lastEvtT) >= 0.85) {
          var panStart = Math.max(lastEvtT + 0.25, ev.t - 0.58);
          pKeys.push({ t: panStart, v: curCamPt }); sKeys.push({ t: panStart, v: [zoomPct, zoomPct] });
          curFocus = [pt[0], pt[1]];
          curCamPt = camTargetForCompPt(pt[0], pt[1]);
          pKeys.push({ t: ev.t, v: curCamPt });     sKeys.push({ t: ev.t, v: [zoomPct, zoomPct] });
          moves++;
        }
        lastEvtT = ev.t;
      }
    }

    if (isZoomed) {
      var holdT = Math.min(dur - 0.85, lastEvtT + 1.2);
      var endT  = Math.min(dur - 0.05, Math.max(holdT + 0.65, dur - 0.12));
      if (holdT > lastEvtT + 0.05) {
        pKeys.push({ t: holdT, v: curCamPt }); sKeys.push({ t: holdT, v: [zoomPct, zoomPct] });
      }
      pKeys.push({ t: endT, v: [cx, cy] }); sKeys.push({ t: endT, v: [100, 100] });
    }

    setBatch(camPos, pKeys, dur);
    setBatch(camScl, sKeys, dur);
    easeSteady(camPos);
    easeSteady(camScl);
    return moves;
  }

  var baseDispatch = PixopikAE.dispatch;
  PixopikAE.dispatch = function (action, b64Args) {
    if (action === "import_and_autorig_recording") {
      try {
        var parsed = b64Args ? eval("(" + decB64(b64Args) + ")") : {};
        var full = parsed;
        if (parsed.payloadFile) {
          var pf = new File(parsed.payloadFile);
          if (pf.exists && pf.open("r")) { pf.encoding = "UTF-8"; full = eval("(" + pf.read() + ")"); pf.close(); }
        }
        var camMode = full.cameraMode || "dolly_steady";
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
          if (baseRes && baseRes.ok && origAuto !== false && camMode !== "static_lock") {
            var comp = app.project.activeItem;
            var m = full.motion || {};
            var evts = (m.clicks || []).concat(m.zoomPins || []);
            evts.sort(function (a, b) { return a.t - b.t; });
            app.beginUndoGroup("Rock-Steady Dolly Camera v2");
            try {
              baseRes.autoZoomClusters = buildRockSteadyDolly(comp, evts, full.zoomPercent || 150, full.deadZoneRatio || 0.65);
              baseRes.cameraMode = "dolly_steady_v2";
            } finally { app.endUndoGroup(); }
          }
          return toJson(baseRes);
        }
      } catch (_errV2) {}
    }
    if (action === "apply_smooth_travel") {
      try {
        var compA = app.project ? app.project.activeItem : null;
        if (!compA || !(compA instanceof CompItem)) return toJson({ ok: false, error: "Open a composition first!" });
        var cur = null;
        for (var i = 1; i <= compA.numLayers; i++) if (compA.layer(i).name === "04_Vector_Cursor") cur = compA.layer(i);
        var evs = [];
        if (cur) {
          var sc = cur.property("ADBE Transform Group").property("ADBE Scale");
          for (var k = 2; k <= sc.numKeys; k += 3) evs.push({ t: sc.keyTime(k) });
        }
        app.beginUndoGroup("Apply Rock-Steady Dolly v2");
        try {
          var mv = buildRockSteadyDolly(compA, evs, 150, 0.65);
          return toJson({ ok: true, compName: compA.name, travelWaypoints: mv });
        } finally { app.endUndoGroup(); }
      } catch (e2) { return toJson({ ok: false, error: String(e2) }); }
    }
    return baseDispatch(action, b64Args);
  };
  PixopikAE._steadyV2Loaded = true;
})();
