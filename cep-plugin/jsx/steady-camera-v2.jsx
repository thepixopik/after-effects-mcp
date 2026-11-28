(function () {
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
    if (n < 2 || n > 180) return;
    var dims = (prop.keyValue(1) instanceof Array) ? prop.keyValue(1).length : 1;
    var eIn = [], eOut = [];
    for (var d = 0; d < dims; d++) { eIn.push(new KeyframeEase(0, 86)); eOut.push(new KeyframeEase(0, 86)); }
    for (var k = 1; k <= n; k++) {
      try {
        prop.setTemporalEaseAtKey(k, eIn, eOut);
        prop.setSpatialContinuousAtKey(k, false);
      } catch (_e) {}
    }
  }

  /* =========================================================================
   * v3.4.1 SMART CURSOR + CLICK DISTANCE-LOCKED TRAVEL DOLLY!
   * - Cursor moves < minDollyPx (default 550px) => 0% Camera Move (100% Locked!)
   * - Cursor moves >= minDollyPx (even WITHOUT clicking, e.g. corner-to-corner!)
   *   => Waits for cursor to settle at destination & smoothly glides there!
   * ========================================================================= */
  function applyCursorAndClickDistanceDolly(comp, minDollyPx, zoomPct) {
    var camNull = null, curLayer = null, scrLayer = null;
    for (var l = 1; l <= comp.numLayers; l++) {
      var lyr = comp.layer(l);
      if (lyr.name === "05_Smart_Camera_Rig") camNull = lyr;
      if (lyr.name === "04_Vector_Cursor") curLayer = lyr;
      if (!scrLayer && (lyr.name.indexOf("Screen") !== -1 || lyr.name.indexOf("screen.mp4") !== -1 || lyr.name.indexOf("02_") === 0) && lyr.width > 200) {
        scrLayer = lyr;
      }
    }
    if (!camNull || !curLayer) return { ok: false, error: "Camera Rig or Vector Cursor layer missing in " + comp.name };

    var minDist = Math.max(80, parseFloat(minDollyPx) || 550);
    var zPct    = parseFloat(zoomPct) || 148;
    var z       = zPct / 100.0;

    try {
      var fx = camNull.property("ADBE Effect Parade");
      var sl = fx.property("Dolly_Min_Distance_Px");
      if (!sl) { sl = fx.addProperty("ADBE Slider Control"); sl.name = "Dolly_Min_Distance_Px"; }
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

    /* Tight Edge-Clamp Lock */
    var fitHalfW = comp.width * 0.475, fitHalfH = comp.height * 0.475;
    if (scrLayer) {
      try {
        var scVal = scrLayer.property("ADBE Transform Group").property("ADBE Scale").value;
        fitHalfW = (scrLayer.width * (scVal[0] / 100.0)) / 2.0;
        fitHalfH = (scrLayer.height * (scVal[1] / 100.0)) / 2.0;
      } catch (_esc) {}
    }
    var maxPanX = Math.max(0, z * fitHalfW - cx + 22);
    var maxPanY = Math.max(0, z * fitHalfH - cy + 22);

    function camTargetForCompPt(px, py) {
      var tx = cx - z * (px - cx);
      var ty = cy - z * (py - cy);
      return [
        Math.max(cx - maxPanX, Math.min(cx + maxPanX, tx)),
        Math.max(cy - maxPanY, Math.min(cy + maxPanY, ty))
      ];
    }

    /* Sample cursor trajectory at 10 Hz across entire timeline */
    var cPos = curLayer.property("ADBE Transform Group").property("ADBE Position");
    var dt = 0.10;
    var samples = [];
    for (var t = 0.25; t <= Math.max(0.3, dur - 0.55); t += dt) {
      var pv = cPos.valueAtTime(t, false);
      samples.push({ t: Math.round(t * 100) / 100, x: pv[0], y: pv[1] });
    }
    if (samples.length < 2) return { ok: true, compName: comp.name, glides: 0, lockedSamples: 0, minDistPx: minDist };

    var pKeys = [{ t: 0, v: [cx, cy] }];
    var sKeys = [{ t: 0, v: [100, 100] }];

    /* Smooth initial zoom-in onto starting cursor region */
    var p0 = samples[0];
    var curFocus = [p0.x, p0.y];
    var curCamPt = camTargetForCompPt(p0.x, p0.y);
    var initT = Math.min(0.70, dur * 0.25);
    pKeys.push({ t: initT, v: curCamPt });
    sKeys.push({ t: initT, v: [zPct, zPct] });

    var lastKeyT = initT;
    var glides = 1, lockedSamples = 0;

    var i = 1;
    while (i < samples.length) {
      var s = samples[i];
      var dx = s.x - curFocus[0], dy = s.y - curFocus[1];
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        /* Below threshold => 0% Camera Move! */
        lockedSamples++;
        i++;
        continue;
      }

      /* Cursor crossed >= minDist! Advance forward while cursor is still actively moving fast
         so we glide cleanly to the final destination corner instead of stopping mid-flight! */
      var departIdx = Math.max(0, i - 2);
      var j = i;
      var maxLook = Math.min(samples.length - 1, i + 14); /* up to 1.4s transit */
      while (j < maxLook) {
        var nx = samples[j + 1].x - samples[j].x;
        var ny = samples[j + 1].y - samples[j].y;
        var stepSpeed = Math.sqrt(nx * nx + ny * ny) / dt;
        if (stepSpeed < 220) break; /* Cursor settled at destination! */
        j++;
      }

      var dest = samples[j];
      var destDist = Math.sqrt((dest.x - curFocus[0]) * (dest.x - curFocus[0]) + (dest.y - curFocus[1]) * (dest.y - curFocus[1]));
      if (destDist < minDist) {
        lockedSamples++;
        i = j + 1;
        continue;
      }

      var panStart = Math.max(lastKeyT + 0.18, samples[departIdx].t);
      var panEnd   = Math.max(panStart + 0.62, dest.t + 0.12);
      if (panEnd > dur - 0.75) break;

      /* Hold previous focus rock-steady until panStart, then smooth Dolly glide to dest! */
      pKeys.push({ t: panStart, v: curCamPt });
      sKeys.push({ t: panStart, v: [zPct, zPct] });

      curFocus = [dest.x, dest.y];
      curCamPt = camTargetForCompPt(dest.x, dest.y);

      pKeys.push({ t: panEnd, v: curCamPt });
      sKeys.push({ t: panEnd, v: [zPct, zPct] });

      lastKeyT = panEnd;
      glides++;
      i = j + 3; /* Brief settle cooldown */
    }

    /* Clean zoom-out at very end of video */
    if (dur > lastKeyT + 0.9) {
      var holdEnd = Math.max(lastKeyT + 0.15, dur - 0.85);
      pKeys.push({ t: holdEnd, v: curCamPt });
      sKeys.push({ t: holdEnd, v: [zPct, zPct] });
      pKeys.push({ t: dur - 0.08, v: [cx, cy] });
      sKeys.push({ t: dur - 0.08, v: [100, 100] });
    }

    setBatch(camPos, pKeys, dur);
    setBatch(camScl, sKeys, dur);
    easeSteady(camPos);
    easeSteady(camScl);

    var vp = readStudioV2Prefs();
    if (vp.bgImagePath) applyBandicamHdWallpaper(comp, vp.bgImagePath);

    return { ok: true, compName: comp.name, glides: glides, lockedSamples: lockedSamples, minDistPx: minDist };
  }

  $.global.PixopikApplyDollyDistance = function (minPx, zoomOpt) {
    if (!app.project) return '{"ok":false,"error":"No project"}';
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      for (var i = app.project.numItems; i >= 1; i--) {
        if (app.project.item(i) instanceof CompItem) { comp = app.project.item(i); break; }
      }
    }
    if (!comp || !(comp instanceof CompItem)) return '{"ok":false,"error":"Open a composition first!"}';
    app.beginUndoGroup("Apply " + minPx + "px Cursor Travel Dolly");
    try {
      var vp = readStudioV2Prefs();
      if (vp.cameraMode === "static_lock") {
        return toJson({ ok: true, compName: comp.name, glides: 0, lockedSamples: 0, minDistPx: minPx });
      }
      var res = applyCursorAndClickDistanceDolly(comp, minPx || vp.minDollyPx || 550, zoomOpt || vp.zoomPercent || 148);
      return toJson(res);
    } catch (e) {
      return toJson({ ok: false, error: String(e) });
    } finally {
      app.endUndoGroup();
    }
  };
})();
