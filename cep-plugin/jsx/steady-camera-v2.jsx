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

  function readStudioV2Prefs() {
    try {
      var up = $.getenv("USERPROFILE");
      if (!up) return {};
      return readJsonFileSafe(up + "/Videos/PixopikRecordings/studio_v2_prefs.json") || {};
    } catch (_e) {}
    return {};
  }

  function applyBandicamHdWallpaper(comp, bgPath) {
    if (!comp || !bgPath) return;
    try {
      for (var e = 1; e <= comp.numLayers; e++) {
        if (comp.layer(e).name === "01B_Bandicam_HD_Wallpaper") return;
      }
      var imgFile = new File(bgPath);
      if (!imgFile.exists) return;
      var ft = app.project.importFile(new ImportOptions(imgFile));
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
      try {
        prop.setTemporalEaseAtKey(k, eIn, eOut);
        prop.setSpatialContinuousAtKey(k, false);
      } catch (_e) {}
    }
  }

  /* =========================================================================
   * 1. FOCUSEE 3-WAY OPTICAL MOTION BLUR (Zoom + Screen Pan + Vector Cursor)
   *    190 deg shutter = silky directional blur ONLY while moving/zooming,
   *    100% razor-sharp UI text when camera stops!
   * ========================================================================= */
  function configure3WayMotionBlur(comp, enableBlur) {
    var on = enableBlur !== false;
    comp.motionBlur = on;
    if (on) {
      try { comp.shutterAngle = 190; comp.shutterPhase = -95; } catch (_es) {}
    }
    for (var l = 1; l <= comp.numLayers; l++) {
      var lyr = comp.layer(l);
      if (lyr.name.indexOf("01_") === 0 || lyr.name.indexOf("Backdrop") !== -1 || lyr.name.indexOf("Wallpaper") !== -1) {
        try { lyr.motionBlur = false; } catch (_e0) {}
      } else {
        try { lyr.motionBlur = on; } catch (_e1) {}
      }
    }
  }

  /* =========================================================================
   * 2. AUTO-HIDE IDLE CURSOR DURING TYPING BURSTS (FocuSee Style!)
   * ========================================================================= */
  function applyTypingCursorAutoHide(curLayer, typingBursts, dur) {
    if (!curLayer) return 0;
    var op = curLayer.property("ADBE Transform Group").property("ADBE Opacity");
    while (op.numKeys > 0) op.removeKey(op.numKeys);
    op.setValue(100);
    if (!typingBursts || !typingBursts.length) return 0;

    var oKeys = [{ t: 0, v: 100 }];
    var hiddenCount = 0;
    for (var i = 0; i < typingBursts.length; i++) {
      var b = typingBursts[i];
      if (!b || (b.tEnd - b.tStart) < 0.75) continue;
      var fadeStart = Math.max(0.05, b.tStart - 0.05);
      var fadeOut   = Math.min(dur - 0.3, fadeStart + 0.20);
      var holdEnd   = Math.min(dur - 0.2, Math.max(fadeOut + 0.2, b.tEnd));
      var fadeIn    = Math.min(dur - 0.04, holdEnd + 0.18);
      oKeys.push({ t: fadeStart, v: 100 });
      oKeys.push({ t: fadeOut,   v: 0 });
      oKeys.push({ t: holdEnd,   v: 0 });
      oKeys.push({ t: fadeIn,    v: 100 });
      hiddenCount++;
    }
    if (hiddenCount > 0) {
      setBatch(op, oKeys, dur);
    }
    return hiddenCount;
  }

  /* =========================================================================
   * 3. SYNCHRONIZED 1.85x TYPING SPEED-RAMP WRAPPER COMP (>2.5s Bursts)
   *    Wraps base comp into FocuSee_Master_<name> so Video + Cursor + Ripples
   *    + Camera ALL speed-ramp in 100% sync with 200-deg shutter motion blur!
   * ========================================================================= */
  function buildSynchronizedTypingSpeedRamp(baseComp, typingBursts) {
    if (!typingBursts || !typingBursts.length) return null;
    var longBursts = [];
    for (var i = 0; i < typingBursts.length; i++) {
      var b = typingBursts[i];
      if (b && (b.tEnd - b.tStart) >= 2.5 && b.tStart > 0.4 && b.tEnd < baseComp.duration - 0.4) {
        longBursts.push({ tStart: b.tStart, tEnd: b.tEnd });
      }
    }
    if (!longBursts.length) return null;
    longBursts.sort(function (a, b) { return a.tStart - b.tStart; });

    var masterName = "FocuSee_Edit_" + baseComp.name.replace(/^FocuSee_Edit_/, "");
    for (var it = app.project.numItems; it >= 1; it--) {
      if (app.project.item(it) instanceof CompItem && app.project.item(it).name === masterName) {
        try { app.project.item(it).remove(); } catch (_er) {}
      }
    }

    var srcDur = baseComp.duration;
    var rampSpeed = 1.85;
    var trPairs = [{ outT: 0, srcT: 0 }];
    var curSrc = 0, curOut = 0;

    for (var k = 0; k < longBursts.length; k++) {
      var lb = longBursts[k];
      if (lb.tStart > curSrc + 0.05) {
        curOut += (lb.tStart - curSrc);
        curSrc = lb.tStart;
        trPairs.push({ outT: curOut, srcT: curSrc });
      }
      var segDur = lb.tEnd - curSrc;
      if (segDur > 0.2) {
        curOut += (segDur / rampSpeed);
        curSrc = lb.tEnd;
        trPairs.push({ outT: curOut, srcT: curSrc, marker: "Typing 1.85x" });
      }
    }
    if (srcDur > curSrc + 0.02) {
      curOut += (srcDur - curSrc);
      trPairs.push({ outT: curOut, srcT: srcDur });
    }

    var newDur = Math.max(1.0, curOut);
    var masterComp = app.project.items.addComp(masterName, baseComp.width, baseComp.height, 1.0, newDur, baseComp.frameRate);
    masterComp.motionBlur = true;
    try { masterComp.shutterAngle = 210; masterComp.shutterPhase = -105; } catch (_ems) {}

    var nested = masterComp.layers.add(baseComp);
    nested.name = "01_Rigged_Timeline_Sync";
    nested.timeRemapEnabled = true;
    nested.motionBlur = true;
    nested.outPoint = newDur;

    var trProp = nested.property("ADBE Time Remapping");
    while (trProp.numKeys > 1) trProp.removeKey(trProp.numKeys);

    var ts = [], vs = [];
    for (var m = 0; m < trPairs.length; m++) {
      ts.push(Math.min(newDur - 0.005, trPairs[m].outT));
      vs.push(Math.min(srcDur - 0.005, trPairs[m].srcT));
      if (trPairs[m].marker) {
        try {
          var mv = new MarkerValue(trPairs[m].marker);
          nested.property("ADBE Marker").setValueAtTime(trPairs[m].outT, mv);
        } catch (_emk) {}
      }
    }
    trProp.setValuesAtTimes(ts, vs);
    easeSteady(trProp);

    try { masterComp.openInViewer(); } catch (_evw) {}
    return { masterName: masterName, ramps: longBursts.length, savedSec: Math.round((srcDur - newDur) * 10) / 10 };
  }

  /* =========================================================================
   * 4. FOCUSEE 3-LAYER CAMERA ENGINE:
   *    - Click = Zoom Focus (100% -> 150%, or 150% -> 165% Focus Punch!)
   *    - Cursor Move >= minDollyPx = Smooth Dolly Travel (Same Zoom Glide!)
   *    - Cursor Move < minDollyPx  = 0% Camera Drift (100% Tripod Lock!)
   * ========================================================================= */
  function applyFocuSee3LayerEngine(comp, opts) {
    opts = opts || {};
    if (comp.name.indexOf("FocuSee_Edit_") === 0 && comp.numLayers >= 1 && comp.layer(1).source instanceof CompItem) {
      comp = comp.layer(1).source;
    }

    var camNull = null, curLayer = null, scrLayer = null;
    for (var l = 1; l <= comp.numLayers; l++) {
      var lyr = comp.layer(l);
      if (lyr.name === "05_Smart_Camera_Rig") camNull = lyr;
      if (lyr.name === "04_Vector_Cursor") curLayer = lyr;
      if (!scrLayer && (lyr.name.indexOf("Screen") !== -1 || lyr.name.indexOf("screen.mp4") !== -1 || lyr.name.indexOf("02_") === 0) && lyr.width > 200) {
        scrLayer = lyr;
      }
    }
    if (!camNull || !curLayer) return { ok: false, error: "Camera Rig or Vector Cursor missing in " + comp.name };

    var minDist       = Math.max(80, parseFloat(opts.minDollyPx) || 550);
    var baseZoomPct   = parseFloat(opts.zoomPercent) || 148;
    var clickPunchPct = opts.clickZoomPunch !== false ? Math.min(185, baseZoomPct + 17) : baseZoomPct;
    var enableBlur    = opts.threeWayBlur !== false;
    var enableTyping  = opts.typingRamp !== false;

    /* Load motion.json if available for typingBursts & exact clicks */
    var motionObj = opts.motionPath ? readJsonFileSafe(opts.motionPath) : null;
    var typingBursts = (motionObj && motionObj.typingBursts) ? motionObj.typingBursts : [];

    try {
      var fx = camNull.property("ADBE Effect Parade");
      var sl = fx.property("Dolly_Min_Distance_Px");
      if (!sl) { sl = fx.addProperty("ADBE Slider Control"); sl.name = "Dolly_Min_Distance_Px"; }
      sl.property(1).setValue(minDist);
    } catch (_esl) {}

    configure3WayMotionBlur(comp, enableBlur);
    var hiddenBursts = enableTyping ? applyTypingCursorAutoHide(curLayer, typingBursts, comp.duration) : 0;

    var camPos = camNull.property("ADBE Transform Group").property("ADBE Position");
    var camScl = camNull.property("ADBE Transform Group").property("ADBE Scale");
    while (camPos.numKeys > 0) camPos.removeKey(camPos.numKeys);
    while (camScl.numKeys > 0) camScl.removeKey(camScl.numKeys);
    camPos.expression = "";
    camScl.expression = "";

    var cx = comp.width / 2.0, cy = comp.height / 2.0, dur = comp.duration;
    camPos.setValue([cx, cy]);
    camScl.setValue([100, 100]);

    var fitHalfW = comp.width * 0.475, fitHalfH = comp.height * 0.475;
    if (scrLayer) {
      try {
        var scVal = scrLayer.property("ADBE Transform Group").property("ADBE Scale").value;
        fitHalfW = (scrLayer.width * (scVal[0] / 100.0)) / 2.0;
        fitHalfH = (scrLayer.height * (scVal[1] / 100.0)) / 2.0;
      } catch (_esc) {}
    }

    function camTargetForCompPt(px, py, zScalePct) {
      var z = zScalePct / 100.0;
      var maxPanX = Math.max(0, z * fitHalfW - cx + 22);
      var maxPanY = Math.max(0, z * fitHalfH - cy + 22);
      var tx = cx - z * (px - cx);
      var ty = cy - z * (py - cy);
      return [
        Math.max(cx - maxPanX, Math.min(cx + maxPanX, tx)),
        Math.max(cy - maxPanY, Math.min(cy + maxPanY, ty))
      ];
    }

    /* Extract click timestamps from Vector Cursor scale pulses */
    var cPos = curLayer.property("ADBE Transform Group").property("ADBE Position");
    var cScl = curLayer.property("ADBE Transform Group").property("ADBE Scale");
    var clickTimes = [];
    var prevClickT = -10;
    for (var ck = 1; ck <= cScl.numKeys; ck++) {
      var kv = cScl.keyValue(ck), kt = cScl.keyTime(ck);
      if (kv[0] < 92 && (kt - prevClickT) > 0.25) {
        clickTimes.push(kt);
        prevClickT = kt;
      }
    }

    function hasNearbyClick(tStart, tEnd) {
      for (var c = 0; c < clickTimes.length; c++) {
        if (clickTimes[c] >= tStart && clickTimes[c] <= tEnd) return clickTimes[c];
      }
      return -1;
    }

    function findTypingBurstAt(tVal) {
      if (!enableTyping || !typingBursts) return null;
      for (var tb = 0; tb < typingBursts.length; tb++) {
        if (tVal >= typingBursts[tb].tStart - 0.6 && tVal <= typingBursts[tb].tEnd + 0.3) return typingBursts[tb];
      }
      return null;
    }

    /* Sample cursor trajectory at 10 Hz */
    var dt = 0.10, samples = [];
    for (var t = 0.25; t <= Math.max(0.3, dur - 0.55); t += dt) {
      var pv = cPos.valueAtTime(t, false);
      samples.push({ t: Math.round(t * 100) / 100, x: pv[0], y: pv[1] });
    }
    if (samples.length < 2) return { ok: true, compName: comp.name, glides: 0, clickPunches: 0, minDistPx: minDist };

    var pKeys = [{ t: 0, v: [cx, cy] }];
    var sKeys = [{ t: 0, v: [100, 100] }];

    var p0 = samples[0];
    var curFocus = [p0.x, p0.y];
    var curZoom  = baseZoomPct;
    var curCamPt = camTargetForCompPt(p0.x, p0.y, curZoom);
    var initT = Math.min(0.68, dur * 0.25);
    pKeys.push({ t: initT, v: curCamPt });
    sKeys.push({ t: initT, v: [curZoom, curZoom] });

    var lastKeyT = initT;
    var dollyGlides = 1, clickPunches = 0;

    var idx = 1;
    while (idx < samples.length) {
      var s = samples[idx];
      if (s.t <= lastKeyT + 0.12) { idx++; continue; }

      /* Case A: Check if a Click happened right around s.t! -> CLICK = ZOOM FOCUS PUNCH! */
      var clkT = hasNearbyClick(s.t - 0.06, s.t + 0.06);
      if (clkT > lastKeyT + 0.22 && clkT < dur - 0.75) {
        var clkPt = cPos.valueAtTime(clkT, false);
        var tbAfter = findTypingBurstAt(clkT + 0.4);
        var punchZ = clickPunchPct;
        var punchStart = Math.max(lastKeyT + 0.10, clkT - 0.38);

        pKeys.push({ t: punchStart, v: curCamPt });
        sKeys.push({ t: punchStart, v: [curZoom, curZoom] });

        curFocus = [clkPt[0], clkPt[1]];
        curCamPt = camTargetForCompPt(clkPt[0], clkPt[1], punchZ);
        pKeys.push({ t: clkT, v: curCamPt });
        sKeys.push({ t: clkT, v: [punchZ, punchZ] });

        /* Hold closer zoom across typing burst (or 0.85s focus pulse on normal click), then ease back to base Dolly zoom */
        var holdUntil = tbAfter ? Math.min(dur - 0.9, tbAfter.tEnd + 0.25) : Math.min(dur - 0.9, clkT + 0.85);
        var relaxEnd  = Math.min(dur - 0.75, holdUntil + 0.48);
        if (relaxEnd > holdUntil + 0.15 && punchZ > baseZoomPct) {
          pKeys.push({ t: holdUntil, v: curCamPt });
          sKeys.push({ t: holdUntil, v: [punchZ, punchZ] });
          curZoom  = baseZoomPct;
          curCamPt = camTargetForCompPt(curFocus[0], curFocus[1], curZoom);
          pKeys.push({ t: relaxEnd, v: curCamPt });
          sKeys.push({ t: relaxEnd, v: [curZoom, curZoom] });
          lastKeyT = relaxEnd;
        } else {
          curZoom = punchZ;
          lastKeyT = clkT;
        }
        clickPunches++;
        while (idx < samples.length && samples[idx].t <= lastKeyT + 0.1) idx++;
        continue;
      }

      /* Case B: Check Cursor Distance from curFocus -> >= minDist = SMOOTH DOLLY TRAVEL! */
      var dx = s.x - curFocus[0], dy = s.y - curFocus[1];
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        idx++;
        continue;
      }

      var departIdx = Math.max(0, idx - 2);
      var j = idx, maxLook = Math.min(samples.length - 1, idx + 14);
      while (j < maxLook) {
        var stepSpd = Math.sqrt(Math.pow(samples[j + 1].x - samples[j].x, 2) + Math.pow(samples[j + 1].y - samples[j].y, 2)) / dt;
        if (stepSpd < 220) break;
        j++;
      }

      var dest = samples[j];
      var destDist = Math.sqrt(Math.pow(dest.x - curFocus[0], 2) + Math.pow(dest.y - curFocus[1], 2));
      if (destDist < minDist) { idx = j + 1; continue; }

      var panStart = Math.max(lastKeyT + 0.16, samples[departIdx].t);
      var panEnd   = Math.max(panStart + 0.62, dest.t + 0.12);
      if (panEnd > dur - 0.75) break;

      pKeys.push({ t: panStart, v: curCamPt });
      sKeys.push({ t: panStart, v: [curZoom, curZoom] });

      curFocus = [dest.x, dest.y];
      curZoom  = baseZoomPct;
      curCamPt = camTargetForCompPt(dest.x, dest.y, curZoom);

      pKeys.push({ t: panEnd, v: curCamPt });
      sKeys.push({ t: panEnd, v: [curZoom, curZoom] });

      lastKeyT = panEnd;
      dollyGlides++;
      idx = j + 3;
    }

    if (dur > lastKeyT + 0.85) {
      var hEnd = Math.max(lastKeyT + 0.15, dur - 0.82);
      pKeys.push({ t: hEnd, v: curCamPt });
      sKeys.push({ t: hEnd, v: [curZoom, curZoom] });
      pKeys.push({ t: dur - 0.06, v: [cx, cy] });
      sKeys.push({ t: dur - 0.06, v: [100, 100] });
    }

    setBatch(camPos, pKeys, dur);
    setBatch(camScl, sKeys, dur);
    easeSteady(camPos);
    easeSteady(camScl);

    var vp = readStudioV2Prefs();
    if (vp.bgImagePath) applyBandicamHdWallpaper(comp, vp.bgImagePath);

    var rampInfo = enableTyping ? buildSynchronizedTypingSpeedRamp(comp, typingBursts) : null;

    return {
      ok: true,
      compName: rampInfo ? rampInfo.masterName : comp.name,
      glides: dollyGlides,
      clickPunches: clickPunches,
      typingHidden: hiddenBursts,
      typingRamps: rampInfo ? rampInfo.ramps : 0,
      motionBlur3Way: enableBlur,
      minDistPx: minDist
    };
  }

  $.global.PixopikApplyFocuSeeEngine = function (b64OrJsonOpts) {
    if (!app.project) return '{"ok":false,"error":"No project"}';
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      for (var i = app.project.numItems; i >= 1; i--) {
        if (app.project.item(i) instanceof CompItem) { comp = app.project.item(i); break; }
      }
    }
    if (!comp || !(comp instanceof CompItem)) return '{"ok":false,"error":"Open a composition first!"}';
    app.beginUndoGroup("Apply Pixopik v4.0 FocuSee Engine");
    try {
      var opts = {};
      if (typeof b64OrJsonOpts === "string" && b64OrJsonOpts.length > 1) {
        opts = eval("(" + b64OrJsonOpts + ")");
      } else if (typeof b64OrJsonOpts === "number") {
        opts = { minDollyPx: b64OrJsonOpts };
      }
      var vp = readStudioV2Prefs();
      if (!opts.minDollyPx) opts.minDollyPx = vp.minDollyPx || 550;
      if (!opts.zoomPercent) opts.zoomPercent = vp.zoomPercent || 148;
      if (vp.cameraMode === "static_lock") return toJson({ ok: true, compName: comp.name, glides: 0, clickPunches: 0, minDistPx: opts.minDollyPx });
      return toJson(applyFocuSee3LayerEngine(comp, opts));
    } catch (e) {
      return toJson({ ok: false, error: String(e) });
    } finally {
      app.endUndoGroup();
    }
  };

  /* Keep backward compatibility alias */
  $.global.PixopikApplyDollyDistance = function (minPx, zoomOpt) {
    return $.global.PixopikApplyFocuSeeEngine(toJson({ minDollyPx: minPx || 550, zoomPercent: zoomOpt || 148 }));
  };
})();
