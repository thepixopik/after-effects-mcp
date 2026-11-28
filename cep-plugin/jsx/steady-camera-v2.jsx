(function () {
  function toJson(val) {
    if (val === null || val === undefined) return "null";
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val === "string") return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    if (val instanceof Array) { var a = []; for (var i = 0; i < val.length; i++) a.push(toJson(val[i])); return "[" + a.join(",") + "]"; }
    var p = []; for (var k in val) { if (val.hasOwnProperty(k) && typeof val[k] !== "function") p.push(toJson(String(k)) + ":" + toJson(val[k])); }
    return "{" + p.join(",") + "}";
  }

  function readJsonFileSafe(pathStr) {
    try {
      if (!pathStr) return null;
      var f = new File(pathStr);
      if (f.exists && f.open("r")) {
        f.encoding = "UTF-8";
        var txt = f.read();
        f.close();
        if (txt) return eval("(" + txt + ")");
      }
    } catch (_e) {}
    return null;
  }

  function getActiveOrLatestComp() {
    if (!app.project) return null;
    var comp = app.project.activeItem;
    if (comp && (comp instanceof CompItem)) {
      if (comp.name.indexOf("FocuSee_Edit_") === 0 && comp.numLayers >= 1 && comp.layer(1).source instanceof CompItem) {
        var bc = comp.layer(1).source;
        try { bc.openInViewer(); comp.remove(); } catch (_eu) {}
        return bc;
      }
      return comp;
    }
    for (var i = app.project.numItems; i >= 1; i--) {
      if (app.project.item(i) instanceof CompItem) return app.project.item(i);
    }
    return null;
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
    if (n < 2 || n > 240) return;
    var dims = (prop.keyValue(1) instanceof Array) ? prop.keyValue(1).length : 1;
    var eIn = [], eOut = [];
    for (var d = 0; d < dims; d++) { eIn.push(new KeyframeEase(0, 84)); eOut.push(new KeyframeEase(0, 84)); }
    for (var k = 1; k <= n; k++) {
      try { prop.setTemporalEaseAtKey(k, eIn, eOut); prop.setSpatialContinuousAtKey(k, false); } catch (_e) {}
    }
  }

  function findLayersAndTelemetry(comp, fallbackMotionPath) {
    var camNull = null, curLayer = null, ripLayer = null, scrLayer = null;
    for (var l = 1; l <= comp.numLayers; l++) {
      var lyr = comp.layer(l);
      if (lyr.name === "05_Smart_Camera_Rig") camNull = lyr;
      if (lyr.name === "04_Vector_Cursor") curLayer = lyr;
      if (lyr.name === "03_Click_Ripple_FX") ripLayer = lyr;
      if (!scrLayer && (lyr.name.indexOf("Screen") !== -1 || lyr.name.indexOf("screen.mp4") !== -1 || lyr.name.indexOf("02_") === 0) && lyr.width > 200) {
        scrLayer = lyr;
      }
    }

    var motObj = null;
    if (scrLayer && scrLayer.source && scrLayer.source.file) {
      try {
        var sib = scrLayer.source.file.parent.fsName.replace(/\\/g, "/") + "/motion.json";
        motObj = readJsonFileSafe(sib);
      } catch (_em) {}
    }
    if (!motObj && fallbackMotionPath) motObj = readJsonFileSafe(fallbackMotionPath);

    var clickTimes = [];
    if (motObj && motObj.clicks && motObj.clicks.length > 0) {
      var lastM = -10;
      for (var m = 0; m < motObj.clicks.length; m++) {
        var mt = Number(motObj.clicks[m].t);
        if (!isNaN(mt) && mt >= 0 && mt <= comp.duration && (mt - lastM) > 0.08) {
          clickTimes.push(Math.round(mt * 1000) / 1000);
          lastM = mt;
        }
      }
    }
    if (clickTimes.length === 0 && curLayer) {
      var cScl = curLayer.property("ADBE Transform Group").property("ADBE Scale");
      var maxS = 100;
      for (var s1 = 1; s1 <= cScl.numKeys; s1++) if (cScl.keyValue(s1)[0] > maxS) maxS = cScl.keyValue(s1)[0];
      var thresh = maxS * 0.88, prevT = -10;
      for (var ck = 1; ck <= cScl.numKeys; ck++) {
        var kv = cScl.keyValue(ck)[0], kt = cScl.keyTime(ck);
        if (kv < thresh && (kt - prevT) > 0.14) { clickTimes.push(Math.round(kt * 1000) / 1000); prevT = kt; }
      }
    }

    /* Also detect existing camera glide timestamps for whoosh sync! */
    var whooshTimes = [];
    if (camNull) {
      var cp = camNull.property("ADBE Transform Group").property("ADBE Position");
      var cs = camNull.property("ADBE Transform Group").property("ADBE Scale");
      var lastW = -10;
      for (var k = 1; k < cp.numKeys; k++) {
        var pA = cp.keyValue(k), pB = cp.keyValue(k + 1);
        var sA = k <= cs.numKeys ? cs.keyValue(k)[0] : 100;
        var sB = (k + 1) <= cs.numKeys ? cs.keyValue(k + 1)[0] : sA;
        var dMove = Math.sqrt(Math.pow(pB[0] - pA[0], 2) + Math.pow(pB[1] - pA[1], 2));
        if ((dMove > 45 || Math.abs(sB - sA) > 12) && (cp.keyTime(k) - lastW) > 0.45) {
          whooshTimes.push(Math.round(cp.keyTime(k) * 1000) / 1000);
          lastW = cp.keyTime(k);
        }
      }
    }

    return {
      camNull: camNull, curLayer: curLayer, ripLayer: ripLayer, scrLayer: scrLayer,
      motionObj: motObj, clickTimes: clickTimes, whooshTimes: whooshTimes
    };
  }

  /* =========================================================================
   * MODULE A1: RESET CAMERA TO 100% FLAT RAW VIEW (0% ZOOM / 0% MOVE)
   * ========================================================================= */
  $.global.PixopikResetCameraFlat = function () {
    var comp = getActiveOrLatestComp();
    if (!comp) return '{"ok":false,"error":"Open a composition first!"}';
    var info = findLayersAndTelemetry(comp, "");
    if (!info.camNull) return '{"ok":false,"error":"05_Smart_Camera_Rig not found"}';

    app.beginUndoGroup("Reset Camera to Flat 100%");
    try {
      var camPos = info.camNull.property("ADBE Transform Group").property("ADBE Position");
      var camScl = info.camNull.property("ADBE Transform Group").property("ADBE Scale");
      while (camPos.numKeys > 0) camPos.removeKey(camPos.numKeys);
      while (camScl.numKeys > 0) camScl.removeKey(camScl.numKeys);
      camPos.expression = ""; camScl.expression = "";
      camPos.setValue([comp.width / 2, comp.height / 2]);
      camScl.setValue([100, 100]);
      if (info.curLayer) {
        var op = info.curLayer.property("ADBE Transform Group").property("ADBE Opacity");
        while (op.numKeys > 0) op.removeKey(op.numKeys);
        op.setValue(100);
      }
      return toJson({ ok: true, compName: comp.name });
    } finally {
      app.endUndoGroup();
    }
  };

  /* =========================================================================
   * MODULE A2: APPLY POST-PRODUCTION CLICK-ZOOM + CURSOR DISTANCE DOLLY
   * ========================================================================= */
  $.global.PixopikApplyPostCamera = function (jsonOpts) {
    var comp = getActiveOrLatestComp();
    if (!comp) return '{"ok":false,"error":"Open a composition first!"}';
    var opts = jsonOpts ? eval("(" + jsonOpts + ")") : {};
    var info = findLayersAndTelemetry(comp, opts.motionPath || "");
    if (!info.camNull || !info.curLayer) return '{"ok":false,"error":"Camera Rig or Vector Cursor missing!"}';

    app.beginUndoGroup("Apply Post-Production Camera Zoom + Dolly");
    try {
      var minDist       = Math.max(80, parseFloat(opts.minDollyPx) || 550);
      var baseZoomPct   = parseFloat(opts.zoomPercent) || 148;
      var clickPunchPct = opts.clickZoomPunch !== false ? Math.min(185, baseZoomPct + 16) : baseZoomPct;
      var enableTyping  = opts.typingHide !== false;
      var typingBursts  = (info.motionObj && info.motionObj.typingBursts) ? info.motionObj.typingBursts : [];

      /* Typing idle cursor auto-hide */
      var op = info.curLayer.property("ADBE Transform Group").property("ADBE Opacity");
      while (op.numKeys > 0) op.removeKey(op.numKeys);
      op.setValue(100);
      if (enableTyping && typingBursts.length > 0) {
        var oKeys = [{ t: 0, v: 100 }];
        for (var tb = 0; tb < typingBursts.length; tb++) {
          var b = typingBursts[tb];
          if (!b || (b.tEnd - b.tStart) < 0.75) continue;
          var fs0 = Math.max(0.05, b.tStart - 0.05);
          oKeys.push({ t: fs0, v: 100 });
          oKeys.push({ t: fs0 + 0.20, v: 0 });
          oKeys.push({ t: b.tEnd, v: 0 });
          oKeys.push({ t: Math.min(comp.duration - 0.04, b.tEnd + 0.18), v: 100 });
        }
        if (oKeys.length > 1) setBatch(op, oKeys, comp.duration);
      }

      var camPos = info.camNull.property("ADBE Transform Group").property("ADBE Position");
      var camScl = info.camNull.property("ADBE Transform Group").property("ADBE Scale");
      while (camPos.numKeys > 0) camPos.removeKey(camPos.numKeys);
      while (camScl.numKeys > 0) camScl.removeKey(camScl.numKeys);
      camPos.expression = ""; camScl.expression = "";

      var cx = comp.width / 2.0, cy = comp.height / 2.0, dur = comp.duration;
      camPos.setValue([cx, cy]); camScl.setValue([100, 100]);

      var fitHalfW = comp.width * 0.475, fitHalfH = comp.height * 0.475;
      if (info.scrLayer) {
        try {
          var scVal = info.scrLayer.property("ADBE Transform Group").property("ADBE Scale").value;
          fitHalfW = (info.scrLayer.width * (scVal[0] / 100.0)) / 2.0;
          fitHalfH = (info.scrLayer.height * (scVal[1] / 100.0)) / 2.0;
        } catch (_esc) {}
      }

      function camTarget(px, py, zPct) {
        var z = zPct / 100.0;
        var maxX = Math.max(0, z * fitHalfW - cx + 22);
        var maxY = Math.max(0, z * fitHalfH - cy + 22);
        return [
          Math.max(cx - maxX, Math.min(cx + maxX, cx - z * (px - cx))),
          Math.max(cy - maxY, Math.min(cy + maxY, cy - z * (py - cy)))
        ];
      }

      var cPos = info.curLayer.property("ADBE Transform Group").property("ADBE Position");
      var clickTimes = info.clickTimes;

      function nearbyClick(tA, tB) {
        for (var c = 0; c < clickTimes.length; c++) if (clickTimes[c] >= tA && clickTimes[c] <= tB) return clickTimes[c];
        return -1;
      }

      var dt = 0.10, samples = [];
      for (var t = 0.25; t <= Math.max(0.3, dur - 0.55); t += dt) {
        var pv = cPos.valueAtTime(t, false);
        samples.push({ t: Math.round(t * 100) / 100, x: pv[0], y: pv[1] });
      }

      var pKeys = [{ t: 0, v: [cx, cy] }], sKeys = [{ t: 0, v: [100, 100] }], whooshes = [];
      var glides = 0, punches = 0;

      if (samples.length >= 2) {
        var p0 = samples[0], curFocus = [p0.x, p0.y], curZoom = baseZoomPct;
        var curCamPt = camTarget(p0.x, p0.y, curZoom);
        var initT = Math.min(0.68, dur * 0.25);
        pKeys.push({ t: initT, v: curCamPt }); sKeys.push({ t: initT, v: [curZoom, curZoom] });
        whooshes.push(Math.round((initT * 0.35) * 1000) / 1000);
        var lastKeyT = initT; glides = 1;

        var idx = 1;
        while (idx < samples.length) {
          var s = samples[idx];
          if (s.t <= lastKeyT + 0.12) { idx++; continue; }

          var clkT = nearbyClick(s.t - 0.06, s.t + 0.06);
          if (clkT > lastKeyT + 0.22 && clkT < dur - 0.75) {
            var clkPt = cPos.valueAtTime(clkT, false);
            var pStart = Math.max(lastKeyT + 0.10, clkT - 0.38);
            pKeys.push({ t: pStart, v: curCamPt }); sKeys.push({ t: pStart, v: [curZoom, curZoom] });
            if (Math.sqrt(Math.pow(clkPt[0] - curFocus[0], 2) + Math.pow(clkPt[1] - curFocus[1], 2)) >= 220) {
              whooshes.push(Math.round(pStart * 1000) / 1000);
            }
            curFocus = [clkPt[0], clkPt[1]];
            curCamPt = camTarget(clkPt[0], clkPt[1], clickPunchPct);
            pKeys.push({ t: clkT, v: curCamPt }); sKeys.push({ t: clkT, v: [clickPunchPct, clickPunchPct] });

            var hUntil = Math.min(dur - 0.9, clkT + 0.85), rEnd = Math.min(dur - 0.75, hUntil + 0.48);
            if (rEnd > hUntil + 0.15 && clickPunchPct > baseZoomPct) {
              pKeys.push({ t: hUntil, v: curCamPt }); sKeys.push({ t: hUntil, v: [clickPunchPct, clickPunchPct] });
              curZoom = baseZoomPct; curCamPt = camTarget(curFocus[0], curFocus[1], curZoom);
              pKeys.push({ t: rEnd, v: curCamPt }); sKeys.push({ t: rEnd, v: [curZoom, curZoom] });
              lastKeyT = rEnd;
            } else { curZoom = clickPunchPct; lastKeyT = clkT; }
            punches++;
            while (idx < samples.length && samples[idx].t <= lastKeyT + 0.1) idx++;
            continue;
          }

          var dist = Math.sqrt(Math.pow(s.x - curFocus[0], 2) + Math.pow(s.y - curFocus[1], 2));
          if (dist < minDist) { idx++; continue; }

          var dep = Math.max(0, idx - 2), j = idx, maxL = Math.min(samples.length - 1, idx + 14);
          while (j < maxL) {
            var sp = Math.sqrt(Math.pow(samples[j + 1].x - samples[j].x, 2) + Math.pow(samples[j + 1].y - samples[j].y, 2)) / dt;
            if (sp < 220) break;
            j++;
          }
          var dest = samples[j];
          if (Math.sqrt(Math.pow(dest.x - curFocus[0], 2) + Math.pow(dest.y - curFocus[1], 2)) < minDist) { idx = j + 1; continue; }

          var panS = Math.max(lastKeyT + 0.16, samples[dep].t), panE = Math.max(panS + 0.62, dest.t + 0.12);
          if (panE > dur - 0.75) break;

          pKeys.push({ t: panS, v: curCamPt }); sKeys.push({ t: panS, v: [curZoom, curZoom] });
          whooshes.push(Math.round((panS + 0.06) * 1000) / 1000);
          curFocus = [dest.x, dest.y]; curZoom = baseZoomPct; curCamPt = camTarget(dest.x, dest.y, curZoom);
          pKeys.push({ t: panE, v: curCamPt }); sKeys.push({ t: panE, v: [curZoom, curZoom] });
          lastKeyT = panE; glides++; idx = j + 3;
        }

        if (dur > lastKeyT + 0.85) {
          var hEnd = Math.max(lastKeyT + 0.15, dur - 0.82);
          pKeys.push({ t: hEnd, v: curCamPt }); sKeys.push({ t: hEnd, v: [curZoom, curZoom] });
          pKeys.push({ t: dur - 0.06, v: [cx, cy] }); sKeys.push({ t: dur - 0.06, v: [100, 100] });
          whooshes.push(Math.round(hEnd * 1000) / 1000);
        }

        setBatch(camPos, pKeys, dur);
        setBatch(camScl, sKeys, dur);
        easeSteady(camPos);
        easeSteady(camScl);
      }

      return toJson({ ok: true, compName: comp.name, glides: glides, punches: punches, clickTimes: clickTimes, whooshTimes: whooshes, duration: dur });
    } catch (e) {
      return toJson({ ok: false, error: String(e) });
    } finally {
      app.endUndoGroup();
    }
  };

  /* =========================================================================
   * MODULE B: INDEPENDENT 3-WAY OPTICAL MOTION BLUR TOGGLE (ON / OFF)
   * ========================================================================= */
  $.global.PixopikSetPostMotionBlur = function (enableBlur, shutterDeg) {
    var comp = getActiveOrLatestComp();
    if (!comp) return '{"ok":false,"error":"Open a composition first!"}';
    app.beginUndoGroup(enableBlur ? "Enable 3-Way Motion Blur" : "Disable Motion Blur");
    try {
      var deg = parseFloat(shutterDeg) || 190;
      comp.motionBlur = !!enableBlur;
      if (enableBlur) {
        try { comp.shutterAngle = deg; comp.shutterPhase = -Math.round(deg / 2); } catch (_es) {}
      }
      for (var l = 1; l <= comp.numLayers; l++) {
        var lyr = comp.layer(l), nm = lyr.name || "";
        if (nm.indexOf("01_") === 0 || nm.indexOf("Backdrop") !== -1 || nm.indexOf("Wallpaper") !== -1 || nm.indexOf("SFX") !== -1 || nm.indexOf("Voiceover") !== -1) {
          try { lyr.motionBlur = false; } catch (_e0) {}
        } else {
          try { lyr.motionBlur = !!enableBlur; } catch (_e1) {}
        }
      }
      return toJson({ ok: true, compName: comp.name, motionBlur: !!enableBlur, shutter: deg });
    } finally {
      app.endUndoGroup();
    }
  };

  /* =========================================================================
   * MODULE C: QUERY TIMELINE TELEMETRY & INJECT / REMOVE STUDIO SFX LAYER
   * ========================================================================= */
  $.global.PixopikGetCompSfxTimings = function (fallbackMotionPath) {
    var comp = getActiveOrLatestComp();
    if (!comp) return '{"ok":false,"error":"Open a composition first!"}';
    var info = findLayersAndTelemetry(comp, fallbackMotionPath || "");
    return toJson({
      ok: true,
      compName: comp.name,
      duration: Math.round(comp.duration * 100) / 100,
      clickTimes: info.clickTimes,
      whooshTimes: info.whooshTimes
    });
  };

  $.global.PixopikInjectStudioSfxWav = function (wavPathStr, dbVal) {
    var comp = getActiveOrLatestComp();
    if (!comp) return '{"ok":false,"error":"No comp"}';
    var wf = new File(wavPathStr);
    if (!wf.exists) return '{"ok":false,"error":"WAV missing"}';
    var db = (dbVal !== undefined && !isNaN(Number(dbVal))) ? Number(dbVal) : -1.5;

    app.beginUndoGroup("Add Studio Click + Whoosh SFX");
    try {
      for (var l = comp.numLayers; l >= 1; l--) {
        var nm = comp.layer(l).name || "";
        if (nm === "07_Mouse_Click_SFX" || nm === "07_Studio_Click_Whoosh_SFX") {
          try { comp.layer(l).remove(); } catch (_er) {}
        }
      }
      var audioItem = app.project.importFile(new ImportOptions(wf));
      var aLyr = comp.layers.add(audioItem);
      aLyr.name = "07_Mouse_Click_SFX";
      aLyr.startTime = 0;
      aLyr.audioEnabled = true;
      aLyr.solo = false;
      try { aLyr.property("ADBE Audio Group").property("ADBE Audio Levels").setValue([db, db]); } catch (_ea) {}
      return toJson({ ok: true, compName: comp.name });
    } catch (e) {
      return toJson({ ok: false, error: String(e) });
    } finally {
      app.endUndoGroup();
    }
  };

  $.global.PixopikRemoveStudioSfx = function () {
    var comp = getActiveOrLatestComp();
    if (!comp) return '{"ok":false}';
    app.beginUndoGroup("Remove Studio SFX");
    try {
      for (var l = comp.numLayers; l >= 1; l--) {
        var nm = comp.layer(l).name || "";
        if (nm.indexOf("SFX") !== -1) { try { comp.layer(l).remove(); } catch (_er) {} }
      }
      return toJson({ ok: true, compName: comp.name });
    } finally {
      app.endUndoGroup();
    }
  };
})();
