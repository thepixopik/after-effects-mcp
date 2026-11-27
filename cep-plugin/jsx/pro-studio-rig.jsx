(function () {
  if (typeof PixopikAE === "undefined") return;

  var THEMES = {
    cosmic_indigo:  ["#4F46E5", "#9333EA", "#1E1B4B", "#0F172A"],
    ocean_breeze:   ["#0284C7", "#2563EB", "#0F766E", "#0F172A"],
    sunset_saas:    ["#F97316", "#EC4899", "#6D28D9", "#1E1B4B"],
    dark_carbon:    ["#3F3F46", "#27272A", "#18181B", "#09090B"],
    clean_daylight: ["#C7D2FE", "#BAE6FD", "#F1F5F9", "#E0E7FF"]
  };

  var GIMBAL_EXPR = [
    "var w = [0.05, 0.09, 0.12, 0.15, 0.18, 0.15, 0.12, 0.09, 0.05];",
    "var acc = [0, 0];",
    "for (var i = 0; i < 9; i++) {",
    "  var tt = Math.max(0, Math.min(thisComp.duration - 0.01, time + (i - 4) * 0.11));",
    "  acc += valueAtTime(tt) * w[i];",
    "}",
    "acc;"
  ].join("\n");

  function hexToRgb(hex) {
    var s = String(hex || "#4F46E5").replace("#", "");
    var n = parseInt(s, 16);
    if (isNaN(n)) return [0.31, 0.27, 0.9];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* Native C++ Batch Keyframe Setter: 50x faster than setValueAtTime loops! */
  function setBatchKeys(prop, pairs, maxDur) {
    if (!pairs || pairs.length === 0) return 0;
    pairs.sort(function (a, b) { return a.t - b.t; });
    var ts = [], vs = [], lastT = -999;
    var limit = (maxDur && maxDur > 0.1) ? (maxDur - 0.005) : 99999;
    for (var i = 0; i < pairs.length; i++) {
      var t = Math.max(0, Math.min(limit, pairs[i].t));
      if (t <= lastT + 0.003) t = lastT + 0.004;
      if (t > limit) break;
      ts.push(t);
      vs.push(pairs[i].v);
      lastT = t;
    }
    if (ts.length === 0) return 0;
    if (ts.length === 1) {
      prop.setValueAtTime(ts[0], vs[0]);
      return 1;
    }
    prop.setValuesAtTimes(ts, vs);
    return ts.length;
  }

  function easeProp(prop, inf, smoothSpatial) {
    var influence = inf || 85;
    var n = prop.numKeys;
    if (n === 0 || n > 120) return; /* Only ease sparse camera/UI keys, never heavy cursor tracks! */
    var dims = 1;
    try { var vt = prop.keyValue(1); if (vt instanceof Array) dims = vt.length; } catch (_e) {}
    var eIn = [], eOut = [];
    for (var d = 0; d < dims; d++) {
      eIn.push(new KeyframeEase(0, influence));
      eOut.push(new KeyframeEase(0, influence));
    }
    for (var k = 1; k <= n; k++) {
      try { prop.setTemporalEaseAtKey(k, eIn, eOut); } catch (_e2) {}
      if (smoothSpatial) {
        try { prop.setSpatialContinuousAtKey(k, true); prop.setSpatialAutoBezierAtKey(k, true); } catch (_es) {}
      }
    }
  }

  function addProBackdrop(comp, themeName, isTutorial) {
    var pal = THEMES[themeName] || (isTutorial ? THEMES.dark_carbon : THEMES.cosmic_indigo);
    var c1 = hexToRgb(pal[0]), c2 = hexToRgb(pal[1]), c3 = hexToRgb(pal[2]), c4 = hexToRgb(pal[3]);
    var bg = comp.layers.addSolid(c1, "01_Studio_Backdrop", comp.width, comp.height, 1);
    bg.moveToEnd();
    var tr = bg.property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").setValue([comp.width / 2, comp.height / 2]);
    tr.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    tr.property("ADBE Scale").setValue([120, 120]);

    try {
      var g4 = bg.property("ADBE Effect Parade").addProperty("ADBE 4ColorGradient");
      g4.property(1).setValue([comp.width * 0.15, comp.height * 0.18]); g4.property(2).setValue(c1);
      g4.property(3).setValue([comp.width * 0.85, comp.height * 0.20]); g4.property(4).setValue(c2);
      g4.property(5).setValue([comp.width * 0.18, comp.height * 0.85]); g4.property(6).setValue(c3);
      g4.property(7).setValue([comp.width * 0.85, comp.height * 0.82]); g4.property(8).setValue(c4);
    } catch (_e) {}
    return bg;
  }

  function addWindowChrome(comp, camNull, vidLayer, winW, winH, style, useBlur) {
    var cx = comp.width / 2, cy = comp.height / 2;
    var headerH = (style === "macos_glass") ? 34 : 0;
    var radius = (style === "sharp_clean") ? 0 : 20;
    var cardW = winW + 4, cardH = winH + headerH + 4;
    var vidCenterY = cy + (headerH / 2);

    vidLayer.property("ADBE Transform Group").property("ADBE Position").setValue([cx, vidCenterY]);

    var card = comp.layers.addShape();
    card.name = "01B_Studio_Window_Frame";
    card.parent = camNull;
    card.moveAfter(vidLayer);
    card.property("ADBE Transform Group").property("ADBE Position").setValue([cx, cy]);
    var sub = card.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
    var rect = sub.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([cardW, cardH]);
    rect.property("ADBE Vector Rect Roundness").setValue(radius + 2);
    sub.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([0.09, 0.11, 0.16]);

    if (style !== "sharp_clean") {
      var st = sub.addProperty("ADBE Vector Graphic - Stroke");
      st.property("ADBE Vector Stroke Color").setValue([1, 1, 1]);
      st.property("ADBE Vector Stroke Opacity").setValue(22);
      st.property("ADBE Vector Stroke Width").setValue(2);
    }
    try {
      var ds1 = card.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
      ds1.property("ADBE Drop Shadow-0002").setValue(160);
      ds1.property("ADBE Drop Shadow-0004").setValue(24);
      ds1.property("ADBE Drop Shadow-0005").setValue(72);
    } catch (_e) {}

    if (radius > 0) {
      var matte = comp.layers.addShape();
      matte.name = "02B_Rounded_Screen_Matte";
      matte.parent = camNull;
      matte.moveBefore(vidLayer);
      matte.property("ADBE Transform Group").property("ADBE Position").setValue([cx, vidCenterY]);
      var mGrp = matte.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
      var mRect = mGrp.addProperty("ADBE Vector Shape - Rect");
      mRect.property("ADBE Vector Rect Size").setValue([winW, winH]);
      mRect.property("ADBE Vector Rect Roundness").setValue(radius);
      mGrp.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([1, 1, 1]);
      try {
        if (vidLayer.setTrackMatte) vidLayer.setTrackMatte(matte, TrackMatteType.ALPHA);
        else { matte.enabled = false; vidLayer.trackMatteType = TrackMatteType.ALPHA; }
      } catch (_tm) { matte.remove(); }
    }

    if (style === "macos_glass") {
      var topBar = comp.layers.addShape();
      topBar.name = "02C_macOS_Header_Dots";
      topBar.parent = camNull;
      topBar.moveBefore(vidLayer);
      topBar.property("ADBE Transform Group").property("ADBE Position").setValue([cx - (winW / 2) + 22, cy - (cardH / 2) + (headerH / 2) + 2]);
      var dotColors = [[1.0, 0.37, 0.34], [1.0, 0.74, 0.18], [0.15, 0.79, 0.25]];
      var rootVec = topBar.property("ADBE Root Vectors Group");
      for (var d = 0; d < 3; d++) {
        var ds = rootVec.addProperty("ADBE Vector Group").property("ADBE Vectors Group");
        var el = ds.addProperty("ADBE Vector Shape - Ellipse");
        el.property("ADBE Vector Ellipse Size").setValue([11, 11]);
        el.property("ADBE Vector Ellipse Position").setValue([d * 19, 0]);
        ds.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(dotColors[d]);
      }
      if (useBlur) topBar.motionBlur = true;
    }
    if (useBlur) { card.motionBlur = true; vidLayer.motionBlur = true; }
    return vidCenterY;
  }

  function createAgencyCursor(comp, scalePct, useBlur) {
    var cur = comp.layers.addShape();
    cur.name = "04_Vector_Cursor";
    cur.moveToBeginning();
    var g = cur.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
    var p = g.addProperty("ADBE Vector Shape - Group");
    var sh = new Shape();
    sh.vertices = [[0, 0], [0, 26], [6.8, 19.8], [11.6, 29.5], [16.2, 27.2], [11.3, 17.6], [19.5, 17.6]];
    sh.closed = true;
    p.property("ADBE Vector Shape").setValue(sh);
    g.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([0.07, 0.09, 0.14]);
    var st = g.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue([1, 1, 1]);
    st.property("ADBE Vector Stroke Width").setValue(2.4);

    var tr = cur.property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").setValue([0, 0]);
    tr.property("ADBE Scale").setValue([scalePct, scalePct]);
    try {
      var ds = cur.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
      ds.property("ADBE Drop Shadow-0002").setValue(145);
      ds.property("ADBE Drop Shadow-0004").setValue(6);
      ds.property("ADBE Drop Shadow-0005").setValue(12);
    } catch (_e) {}
    if (useBlur) cur.motionBlur = true;
    return cur;
  }

  /* 1 Single Reusable Ripple Layer for ALL Clicks (Zero Layer Bloat, Instant Speed!) */
  function createSingleMasterRipple(comp, camNull, clicks, toCompFn, dur) {
    if (!clicks || clicks.length === 0) return;
    var filtered = [];
    var lastT = -2;
    for (var i = 0; i < clicks.length; i++) {
      if (clicks[i].t - lastT >= 0.48) {
        filtered.push(clicks[i]);
        lastT = clicks[i].t;
      }
    }
    if (filtered.length === 0) return;

    var rip = comp.layers.addShape();
    rip.name = "03_Click_Ripple_FX";
    rip.parent = camNull;
    var g = rip.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
    var sz = g.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size");
    var st = g.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue([0.39, 0.40, 0.96]);
    st.property("ADBE Vector Stroke Width").setValue(4.2);

    var tr = rip.property("ADBE Transform Group");
    var pos = tr.property("ADBE Position");
    var op  = tr.property("ADBE Opacity");
    op.setValue(0);

    var posPairs = [], szPairs = [], opPairs = [];
    opPairs.push({ t: 0, v: 0 });
    for (var c = 0; c < filtered.length; c++) {
      var t = filtered[c].t;
      if (t + 0.05 >= dur) break;
      var cp = toCompFn(filtered[c].x, filtered[c].y);
      var endT = Math.min(dur - 0.01, t + 0.42);
      posPairs.push({ t: Math.max(0, t - 0.01), v: cp });
      szPairs.push({ t: Math.max(0, t - 0.01), v: [12, 12] });
      szPairs.push({ t: endT, v: [92, 92] });
      opPairs.push({ t: Math.max(0, t - 0.015), v: 0 });
      opPairs.push({ t: t, v: 92 });
      opPairs.push({ t: endT, v: 0 });
    }

    setBatchKeys(pos, posPairs, dur);
    for (var pk = 1; pk <= pos.numKeys; pk++) {
      try { pos.setInterpolationTypeAtKey(pk, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); } catch (_eh) {}
    }
    setBatchKeys(sz, szPairs, dur);
    setBatchKeys(op, opPairs, dur);
  }

  function buildSmoothTravelBatch(compW, compH, dur, camPos, camScl, swivel, tilt, pts, travelZoom, isTutorial) {
    var cx = compW / 2, cy = compH / 2, z = travelZoom / 100;
    function clampPt(px, py) {
      var tx = cx - z * (px - cx), ty = cy - z * (py - cy);
      var maxPX = (compW * (z - 1)) * 0.46, maxPY = (compH * (z - 1)) * 0.46;
      return [Math.max(cx - maxPX, Math.min(cx + maxPX, tx)), Math.max(cy - maxPY, Math.min(cy + maxPY, ty))];
    }

    var stops = [], lastStop = null;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.t < 0.9 || p.t > dur - 1.1) continue;
      if (!lastStop || ((p.t - lastStop.t) >= 1.05 && Math.sqrt((p.x-lastStop.x)*(p.x-lastStop.x) + (p.y-lastStop.y)*(p.y-lastStop.y)) > 125)) {
        stops.push(p);
        lastStop = p;
      }
    }

    var pKeys = [{ t: 0, v: [cx, cy] }];
    var sKeys = [{ t: 0, v: [100, 100] }];
    var swKeys = [], tlKeys = [];

    if (stops.length > 0) {
      var firstT = Math.max(1.25, stops[0].t);
      var startEase = Math.max(0.05, firstT - 1.2);
      pKeys.push({ t: startEase, v: [cx, cy] });
      sKeys.push({ t: startEase, v: [100, 100] });

      for (var s = 0; s < stops.length; s++) {
        var st = stops[s];
        if (s > 0 && (st.t - stops[s - 1].t) > 8.5) {
          pKeys.push({ t: stops[s - 1].t + 1.2, v: [cx, cy] });
          sKeys.push({ t: stops[s - 1].t + 1.2, v: [100, 100] });
          pKeys.push({ t: st.t - 1.2, v: [cx, cy] });
          sKeys.push({ t: st.t - 1.2, v: [100, 100] });
        }
        pKeys.push({ t: st.t, v: clampPt(st.x, st.y) });
        sKeys.push({ t: st.t, v: [travelZoom, travelZoom] });
        if (swivel && tilt && !isTutorial) {
          swKeys.push({ t: st.t, v: ((st.x - cx) / cx) * 2.8 });
          tlKeys.push({ t: st.t, v: -((st.y - cy) / cy) * 1.8 });
        }
      }

      var endS = stops[stops.length - 1];
      var holdEnd = Math.min(dur - 1.25, endS.t + 0.8);
      if (holdEnd > endS.t + 0.05) {
        pKeys.push({ t: holdEnd, v: clampPt(endS.x, endS.y) });
        sKeys.push({ t: holdEnd, v: [travelZoom, travelZoom] });
      }
      var outT = Math.min(dur - 0.05, Math.max(holdEnd + 1.15, dur - 0.12));
      pKeys.push({ t: outT, v: [cx, cy] });
      sKeys.push({ t: outT, v: [100, 100] });
      if (swivel && tilt && !isTutorial) {
        swKeys.push({ t: outT, v: 0 });
        tlKeys.push({ t: outT, v: 0 });
      }
    }

    setBatchKeys(camPos, pKeys, dur);
    setBatchKeys(camScl, sKeys, dur);
    if (swivel && swKeys.length) setBatchKeys(swivel, swKeys, dur);
    if (tilt && tlKeys.length) setBatchKeys(tilt, tlKeys, dur);

    easeProp(camPos, 90, true);
    easeProp(camScl, 90, false);
    camPos.expression = GIMBAL_EXPR;
    camScl.expression = GIMBAL_EXPR;
    return stops.length;
  }

  function proAutoRig(rawArgs) {
    var args = rawArgs || {};
    if (args.payloadFile) {
      var pf = new File(args.payloadFile);
      if (pf.exists) {
        pf.encoding = "UTF-8";
        if (pf.open("r")) {
          var txt = pf.read();
          pf.close();
          args = eval("(" + txt + ")");
        }
      }
    }

    var vFile = new File(args.videoPath);
    if (!vFile.exists) throw new Error("Video not found: " + args.videoPath);

    var isTutorial = (args.editMode === "youtube_tutorial");
    var camStyle = args.cameraMode || "smooth_travel";

    app.beginUndoGroup("Pixopik Turbo Studio Rig v1.5");
    try {
      var footage = app.project.importFile(new ImportOptions(vFile));
      var preset = args.aspectPreset || "youtube_16_9";
      var compW = 1920, compH = 1080;
      if (preset === "shorts_9_16") { compW = 1080; compH = 1920; }
      else if (preset === "square_1_1") { compW = 1080; compH = 1080; }
      var cx = compW / 2, cy = compH / 2;

      var dur = Math.max(2, footage.duration || 10);
      var prefix = isTutorial ? "YT_Tutorial_" : "Studio_";
      var comp = app.project.items.addComp((prefix + vFile.name.replace(/\.[^\.]+$/, "")).slice(0, 58), compW, compH, 1, dur, 60);
      comp.resolutionFactor = [2, 2]; /* Opens in fast Half-Res preview so zero initial freeze! */
      var useBlur = (args.motionBlur === true);
      comp.motionBlur = useBlur;

      addProBackdrop(comp, args.wallpaper || (isTutorial ? "dark_carbon" : "cosmic_indigo"), isTutorial);

      var camNull = comp.layers.addNull(dur);
      camNull.name = "05_Smart_Camera_Rig";
      var camTr = camNull.property("ADBE Transform Group");
      camTr.property("ADBE Anchor Point").setValue([cx, cy]);
      camTr.property("ADBE Position").setValue([cx, cy]);
      camTr.property("ADBE Scale").setValue([100, 100]);

      var vidLayer = comp.layers.add(footage);
      vidLayer.name = "02_Screen_Recording";
      vidLayer.audioEnabled = false; /* Pure silent video ready for clean TTS Voiceover! */

      var defaultPad = isTutorial ? 95 : (preset === "shorts_9_16" ? 90 : 84);
      var padPct = (args.windowPaddingPercent || defaultPad) / 100;
      var frameStyle = args.frameStyle || (isTutorial ? "minimal_rounded" : "macos_glass");
      var topReserve = (frameStyle === "macos_glass") ? 40 : 10;
      var fitScale = Math.min((compW * padPct) / footage.width, ((compH - topReserve) * padPct) / footage.height) * 100;
      vidLayer.property("ADBE Transform Group").property("ADBE Scale").setValue([fitScale, fitScale]);
      vidLayer.parent = camNull;

      var winW = footage.width * (fitScale / 100), winH = footage.height * (fitScale / 100);
      var vidCenterY = addWindowChrome(comp, camNull, vidLayer, winW, winH, frameStyle, useBlur);
      var winLeft = cx - (winW / 2), winTop = vidCenterY - (winH / 2);

      var motion = args.motion || null;
      var srcW = (motion && motion.screenWidth) ? motion.screenWidth : footage.width;
      var srcH = (motion && motion.screenHeight) ? motion.screenHeight : footage.height;
      function toComp(sx, sy) { return [winLeft + (sx / srcW) * winW, winTop + (sy / srcH) * winH]; }

      var clicks = (motion && motion.clicks) ? motion.clicks : [];
      var curCount = 0, compCursorPts = [];

      if (args.clickRipples !== false && clicks.length > 0) {
        createSingleMasterRipple(comp, camNull, clicks, toComp, dur);
      }

      if (motion && args.vectorCursor !== false && motion.cursorKeys && motion.cursorKeys.length > 0) {
        var baseS = args.cursorScale || (isTutorial ? 140 : 155);
        var curLayer = createAgencyCursor(comp, baseS, useBlur);
        curLayer.parent = camNull;
        var cPos = curLayer.property("ADBE Transform Group").property("ADBE Position");
        var cScl = curLayer.property("ADBE Transform Group").property("ADBE Scale");

        var posPairs = [];
        for (var k = 0; k < motion.cursorKeys.length; k++) {
          var s = motion.cursorKeys[k];
          var pt = toComp(s.x, s.y);
          posPairs.push({ t: s.t, v: pt });
          compCursorPts.push({ t: s.t, x: pt[0], y: pt[1] });
        }
        curCount = setBatchKeys(cPos, posPairs, dur);

        if (clicks.length > 0) {
          var sclPairs = [];
          for (var c = 0; c < clicks.length; c++) {
            var ct = clicks[c].t;
            if (ct + 0.15 >= dur) break;
            sclPairs.push({ t: Math.max(0, ct - 0.05), v: [baseS, baseS] });
            sclPairs.push({ t: ct, v: [baseS * 0.78, baseS * 0.78] });
            sclPairs.push({ t: ct + 0.14, v: [baseS, baseS] });
          }
          setBatchKeys(cScl, sclPairs, dur);
        }
        curLayer.moveToBeginning();
      }

      var swivel = null, tilt = null;
      if (!isTutorial) {
        var dirAdj = comp.layers.addSolid([1, 1, 1], "06_Cinema_3D_Director", compW, compH, 1);
        dirAdj.adjustmentLayer = true;
        dirAdj.moveToBeginning();
        try {
          var b3d = dirAdj.property("ADBE Effect Parade").addProperty("ADBE Basic 3D");
          swivel = b3d.property(1); tilt = b3d.property(2);
        } catch (_eB) {}
      }

      var camPos = camTr.property("ADBE Position"), camScl = camTr.property("ADBE Scale");
      var zoomClusters = 0;

      if (args.autoZoom !== false) {
        if (camStyle === "smooth_travel" && compCursorPts.length > 0) {
          var tZoom = args.zoomPercent || (isTutorial ? 142 : (preset === "shorts_9_16" ? 195 : 154));
          zoomClusters = buildSmoothTravelBatch(compW, compH, dur, camPos, camScl, swivel, tilt, compCursorPts, tZoom, isTutorial);
        } else if (clicks.length > 0) {
          var zoomPct = args.zoomPercent || (isTutorial ? 145 : (preset === "shorts_9_16" ? 215 : 176));
          var z = zoomPct / 100, idx = 0, minGap = isTutorial ? 2.6 : 1.8;
          var cpKeys = [], csKeys = [];
          while (idx < clicks.length) {
            if (clicks[idx].t < 1.05) { idx++; continue; }
            var enterT = Math.max(1.0, clicks[idx].t - 0.5);
            cpKeys.push({ t: enterT, v: [cx, cy] }); csKeys.push({ t: enterT, v: [100, 100] });
            zoomClusters++;
            var lastHold = clicks[idx].t;
            while (idx < clicks.length) {
              var cn = clicks[idx], ptc = toComp(cn.x, cn.y);
              var zx = cx - z * (ptc[0] - cx), zy = cy - z * (ptc[1] - cy);
              var maxPX = (compW * (z - 1)) / 2, maxPY = (compH * (z - 1)) / 2;
              zx = Math.max(cx - maxPX, Math.min(cx + maxPX, zx));
              zy = Math.max(cy - maxPY, Math.min(cy + maxPY, zy));
              var holdT = cn.t + (isTutorial ? 1.15 : 0.85);
              cpKeys.push({ t: cn.t, v: [zx, zy] });  csKeys.push({ t: cn.t, v: [zoomPct, zoomPct] });
              cpKeys.push({ t: holdT, v: [zx, zy] }); csKeys.push({ t: holdT, v: [zoomPct, zoomPct] });
              lastHold = holdT;
              if (idx + 1 < clicks.length && (clicks[idx + 1].t - holdT) < minGap) idx++;
              else { idx++; break; }
            }
            var exitT = Math.min(dur - 0.1, lastHold + 0.55);
            cpKeys.push({ t: exitT, v: [cx, cy] }); csKeys.push({ t: exitT, v: [100, 100] });
          }
          setBatchKeys(camPos, cpKeys, dur);
          setBatchKeys(camScl, csKeys, dur);
          easeProp(camPos, 82, false); easeProp(camScl, 82, false);
        }
      }

      comp.openInViewer();
      return { ok: true, compName: comp.name, cameraMode: camStyle, cursorKeyframes: curCount, autoZoomClusters: zoomClusters };
    } finally {
      app.endUndoGroup();
    }
  }

  function importTtsVoiceover(args) {
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) throw new Error("Open your composition first!");
    var af = new File(args.audioPath);
    if (!af.exists) throw new Error("TTS audio file not found.");
    app.beginUndoGroup("Add TTS Voiceover");
    try {
      var item = app.project.importFile(new ImportOptions(af));
      if (item.duration > comp.duration) comp.duration = item.duration + 0.5;
      var lyr = comp.layers.add(item);
      lyr.name = "00_TTS_Voiceover";
      lyr.startTime = 0;
      lyr.moveToBeginning();
      return { ok: true, duration: item.duration };
    } finally { app.endUndoGroup(); }
  }

  function applySmoothTravelToActive() {
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) throw new Error("Open a studio composition first!");
    var camNull = null, curLayer = null, dirAdj = null;
    for (var l = 1; l <= comp.numLayers; l++) {
      var nm = comp.layer(l).name;
      if (nm === "05_Smart_Camera_Rig") camNull = comp.layer(l);
      if (nm === "04_Vector_Cursor") curLayer = comp.layer(l);
      if (nm === "06_Cinema_3D_Director") dirAdj = comp.layer(l);
    }
    if (!camNull || !curLayer) throw new Error("05_Smart_Camera_Rig / 04_Vector_Cursor not found.");

    app.beginUndoGroup("Apply Smooth Travel Glide");
    try {
      var camTr = camNull.property("ADBE Transform Group");
      var camPos = camTr.property("ADBE Position"), camScl = camTr.property("ADBE Scale");
      while (camPos.numKeys > 0) camPos.removeKey(camPos.numKeys);
      while (camScl.numKeys > 0) camScl.removeKey(camScl.numKeys);
      camPos.expression = ""; camScl.expression = "";

      var cPos = curLayer.property("ADBE Transform Group").property("ADBE Position");
      var pts = [];
      for (var t = 0.9; t < comp.duration - 1.0; t += 0.95) {
        var pv = cPos.valueAtTime(t, false);
        pts.push({ t: t, x: pv[0], y: pv[1] });
      }
      var swivel = null, tilt = null;
      if (dirAdj) {
        try {
          var b3d = dirAdj.property("ADBE Effect Parade").property("ADBE Basic 3D");
          if (b3d) {
            swivel = b3d.property(1); tilt = b3d.property(2);
            while (swivel.numKeys > 0) swivel.removeKey(swivel.numKeys);
            while (tilt.numKeys > 0) tilt.removeKey(tilt.numKeys);
          }
        } catch (_e3) {}
      }
      var isYT = (comp.name.indexOf("YT_Tutorial_") === 0);
      var wp = buildSmoothTravelBatch(comp.width, comp.height, comp.duration, camPos, camScl, swivel, tilt, pts, isYT ? 142 : 154, isYT);
      return { ok: true, compName: comp.name, travelWaypoints: wp };
    } finally { app.endUndoGroup(); }
  }

  function addYouTubeSubscribePill() {
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) throw new Error("Open a composition first!");
    app.beginUndoGroup("Add YouTube Subscribe Pill");
    try {
      var t0 = comp.time, cx = comp.width / 2, yPos = comp.height - 115;
      var box = comp.layers.addShape();
      box.name = "YT_Subscribe_Pill"; box.moveToBeginning();
      box.inPoint = t0; box.outPoint = Math.min(comp.duration, t0 + 3.4);
      var sub = box.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
      var r = sub.addProperty("ADBE Vector Shape - Rect");
      r.property("ADBE Vector Rect Size").setValue([340, 68]);
      r.property("ADBE Vector Rect Roundness").setValue(34);
      sub.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([0.92, 0.12, 0.15]);

      var tr = box.property("ADBE Transform Group");
      tr.property("ADBE Position").setValue([cx, yPos]);
      var sc = tr.property("ADBE Scale");
      setBatchKeys(sc, [
        { t: t0, v: [0, 0] },
        { t: t0 + 0.32, v: [106, 106] },
        { t: t0 + 0.45, v: [100, 100] },
        { t: t0 + 1.4, v: [100, 100] },
        { t: t0 + 1.5, v: [90, 90] },
        { t: t0 + 1.65, v: [100, 100] },
        { t: t0 + 3.0, v: [100, 100] },
        { t: t0 + 3.35, v: [0, 0] }
      ], comp.duration);
      easeProp(sc, 78, false);

      var txt = comp.layers.addText("SUBSCRIBE  •  🔔");
      txt.name = "YT_Subscribe_Label"; txt.parent = box; txt.moveBefore(box);
      txt.inPoint = box.inPoint; txt.outPoint = box.outPoint;
      var td = txt.property("ADBE Text Properties").property("ADBE Text Document");
      var d = td.value; d.fontSize = 26; d.fillColor = [1, 1, 1]; d.tracking = 80;
      d.justification = ParagraphJustification.CENTER_JUSTIFY; td.setValue(d);
      txt.property("ADBE Transform Group").property("ADBE Position").setValue([0, 9]);
      return { ok: true, added: "YT_Subscribe_Pill" };
    } finally { app.endUndoGroup(); }
  }

  function addYouTubeChapterCard(args) {
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) throw new Error("Open a composition first!");
    app.beginUndoGroup("Add YouTube Chapter Lower-Third");
    try {
      var t0 = comp.time;
      var label = (args && args.title) ? args.title : "STEP 01  •  Getting Started";
      var bar = comp.layers.addShape();
      bar.name = "YT_Chapter_Card"; bar.moveToBeginning();
      bar.inPoint = t0; bar.outPoint = Math.min(comp.duration, t0 + 3.8);
      var sub = bar.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
      var r = sub.addProperty("ADBE Vector Shape - Rect");
      r.property("ADBE Vector Rect Size").setValue([460, 64]);
      r.property("ADBE Vector Rect Roundness").setValue(14);
      sub.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([0.07, 0.09, 0.14]);
      var st = sub.addProperty("ADBE Vector Graphic - Stroke");
      st.property("ADBE Vector Stroke Color").setValue([0.39, 0.40, 0.96]);
      st.property("ADBE Vector Stroke Width").setValue(2.5);

      var pos = bar.property("ADBE Transform Group").property("ADBE Position");
      setBatchKeys(pos, [
        { t: t0, v: [-260, comp.height - 110] },
        { t: t0 + 0.4, v: [290, comp.height - 110] },
        { t: t0 + 3.3, v: [290, comp.height - 110] },
        { t: t0 + 3.75, v: [-260, comp.height - 110] }
      ], comp.duration);
      easeProp(pos, 82, false);

      var txt = comp.layers.addText(label);
      txt.name = "YT_Chapter_Text"; txt.parent = bar; txt.moveBefore(bar);
      txt.inPoint = bar.inPoint; txt.outPoint = bar.outPoint;
      var td = txt.property("ADBE Text Properties").property("ADBE Text Document");
      var d = td.value; d.fontSize = 24; d.fillColor = [1, 1, 1];
      d.justification = ParagraphJustification.CENTER_JUSTIFY; td.setValue(d);
      txt.property("ADBE Transform Group").property("ADBE Position").setValue([0, 8]);
      return { ok: true, added: "YT_Chapter_Card" };
    } finally { app.endUndoGroup(); }
  }

  var prevDispatch = PixopikAE.dispatch;
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
  function toJson(val) {
    if (val === null || val === undefined) return "null";
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val === "string") return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    if (val instanceof Array) { var a = []; for (var i = 0; i < val.length; i++) a.push(toJson(val[i])); return "[" + a.join(",") + "]"; }
    var p = []; for (var k in val) { if (val.hasOwnProperty(k) && typeof val[k] !== "function") p.push(toJson(String(k)) + ":" + toJson(val[k])); }
    return "{" + p.join(",") + "}";
  }

  PixopikAE.dispatch = function (action, b64Args) {
    if (action === "import_and_autorig_recording" || action === "import_tts_voiceover" || action === "apply_smooth_travel" || action === "add_youtube_subscribe" || action === "add_youtube_chapter") {
      try {
        var parsed = b64Args ? eval("(" + decB64(b64Args) + ")") : {};
        if (action === "import_tts_voiceover") return toJson(importTtsVoiceover(parsed));
        if (action === "apply_smooth_travel") return toJson(applySmoothTravelToActive());
        if (action === "add_youtube_subscribe") return toJson(addYouTubeSubscribePill());
        if (action === "add_youtube_chapter") return toJson(addYouTubeChapterCard(parsed));
        return toJson(proAutoRig(parsed));
      } catch (err) {
        return toJson({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    }
    return prevDispatch(action, b64Args);
  };
  PixopikAE._proRigLoaded = true;
})();
