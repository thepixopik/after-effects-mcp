(function () {
  if (typeof PixopikAE === "undefined") return;

  var THEMES = {
    cosmic_indigo:  ["#4F46E5", "#9333EA", "#1E1B4B", "#0F172A"],
    ocean_breeze:   ["#0284C7", "#2563EB", "#0F766E", "#0F172A"],
    sunset_saas:    ["#F97316", "#EC4899", "#6D28D9", "#1E1B4B"],
    dark_carbon:    ["#3F3F46", "#27272A", "#18181B", "#09090B"],
    clean_daylight: ["#C7D2FE", "#BAE6FD", "#F1F5F9", "#E0E7FF"]
  };

  function hexToRgb(hex) {
    var s = String(hex || "#4F46E5").replace("#", "");
    if (s.length === 3) s = s.charAt(0)+s.charAt(0)+s.charAt(1)+s.charAt(1)+s.charAt(2)+s.charAt(2);
    var n = parseInt(s, 16);
    if (isNaN(n)) return [0.31, 0.27, 0.9];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function easeProp(prop, influence) {
    var inf = influence || 80;
    for (var k = 1; k <= prop.numKeys; k++) {
      var dims = 1;
      try {
        var vt = prop.keyValue(k);
        if (vt instanceof Array) dims = vt.length;
      } catch (_e) {}
      var eIn = [], eOut = [];
      for (var d = 0; d < dims; d++) {
        eIn.push(new KeyframeEase(0, inf));
        eOut.push(new KeyframeEase(0, inf));
      }
      try {
        prop.setTemporalEaseAtKey(k, eIn, eOut);
      } catch (_e2) {
        try { prop.setTemporalEaseAtKey(k, [new KeyframeEase(0, inf)], [new KeyframeEase(0, inf)]); } catch (_e3) {}
      }
    }
  }

  function addProBackdrop(comp, themeName) {
    var pal = THEMES[themeName] || THEMES.cosmic_indigo;
    var c1 = hexToRgb(pal[0]), c2 = hexToRgb(pal[1]), c3 = hexToRgb(pal[2]), c4 = hexToRgb(pal[3]);

    for (var i = comp.numLayers; i >= 1; i--) {
      if (comp.layer(i).name === "01_Studio_Backdrop") comp.layer(i).remove();
    }

    var bg = comp.layers.addSolid(c1, "01_Studio_Backdrop", comp.width, comp.height, 1);
    bg.moveToEnd();
    var tr = bg.property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").setValue([comp.width / 2, comp.height / 2]);
    tr.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    tr.property("ADBE Scale").setValue([100, 100]);

    var fx = bg.property("ADBE Effect Parade");
    var g4 = null;
    try { g4 = fx.addProperty("ADBE 4ColorGradient"); } catch (_e) {}
    if (g4) {
      try {
        g4.property(1).setValue([comp.width * 0.15, comp.height * 0.18]);
        g4.property(2).setValue(c1);
        g4.property(3).setValue([comp.width * 0.85, comp.height * 0.20]);
        g4.property(4).setValue(c2);
        g4.property(5).setValue([comp.width * 0.18, comp.height * 0.85]);
        g4.property(6).setValue(c3);
        g4.property(7).setValue([comp.width * 0.85, comp.height * 0.82]);
        g4.property(8).setValue(c4);
      } catch (_e2) {}
    } else {
      try {
        var ramp = fx.addProperty("ADBE Ramp");
        ramp.property("ADBE Ramp-0001").setValue([0, 0]);
        ramp.property("ADBE Ramp-0002").setValue(c1);
        ramp.property("ADBE Ramp-0003").setValue([comp.width, comp.height]);
        ramp.property("ADBE Ramp-0004").setValue(c3);
      } catch (_e3) {}
    }
    return bg;
  }

  function addWindowChrome(comp, camNull, vidLayer, winW, winH, style, useBlur) {
    var cx = comp.width / 2, cy = comp.height / 2;
    var headerH = (style === "macos_glass") ? 34 : 0;
    var radius = (style === "sharp_clean") ? 0 : 22;
    var cardW = winW + 4;
    var cardH = winH + headerH + 4;
    var vidCenterY = cy + (headerH / 2);

    vidLayer.property("ADBE Transform Group").property("ADBE Position").setValue([cx, vidCenterY]);

    /* 1. Card + Glass Border + Deep Studio Shadow */
    var card = comp.layers.addShape();
    card.name = "01B_Studio_Window_Frame";
    card.parent = camNull;
    card.moveAfter(vidLayer);
    card.property("ADBE Transform Group").property("ADBE Position").setValue([cx, cy]);

    var grp = card.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var sub = grp.property("ADBE Vectors Group");
    var rect = sub.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([cardW, cardH]);
    rect.property("ADBE Vector Rect Roundness").setValue(radius + 2);

    var fill = sub.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue([0.09, 0.11, 0.16]);

    if (style !== "sharp_clean") {
      var st = sub.addProperty("ADBE Vector Graphic - Stroke");
      st.property("ADBE Vector Stroke Color").setValue([1, 1, 1]);
      st.property("ADBE Vector Stroke Opacity").setValue(24);
      st.property("ADBE Vector Stroke Width").setValue(2);
    }

    try {
      var ds1 = card.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
      ds1.property("ADBE Drop Shadow-0002").setValue(165);
      ds1.property("ADBE Drop Shadow-0003").setValue(180);
      ds1.property("ADBE Drop Shadow-0004").setValue(28);
      ds1.property("ADBE Drop Shadow-0005").setValue(90);
    } catch (_e) {}

    /* 2. Rounded Alpha Matte on Video */
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
        if (vidLayer.setTrackMatte) {
          vidLayer.setTrackMatte(matte, TrackMatteType.ALPHA);
        } else {
          matte.enabled = false;
          vidLayer.trackMatteType = TrackMatteType.ALPHA;
        }
      } catch (_tm) { matte.remove(); }
    }

    /* 3. macOS Traffic Lights Header Overlay */
    if (style === "macos_glass") {
      var topBar = comp.layers.addShape();
      topBar.name = "02C_macOS_Header_Dots";
      topBar.parent = camNull;
      topBar.moveBefore(vidLayer);
      var barY = cy - (cardH / 2) + (headerH / 2) + 2;
      var leftX = cx - (winW / 2) + 22;
      topBar.property("ADBE Transform Group").property("ADBE Position").setValue([leftX, barY]);

      var dotColors = [[1.0, 0.37, 0.34], [1.0, 0.74, 0.18], [0.15, 0.79, 0.25]];
      var rootVec = topBar.property("ADBE Root Vectors Group");
      for (var d = 0; d < 3; d++) {
        var dg = rootVec.addProperty("ADBE Vector Group");
        var ds = dg.property("ADBE Vectors Group");
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

  function createMacCursor(comp, scalePct, useBlur) {
    var cur = comp.layers.addShape();
    cur.name = "04_Vector_Cursor";
    var g = cur.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
    var p = g.addProperty("ADBE Vector Shape - Group");
    var sh = new Shape();
    sh.vertices = [[0, 0], [0, 26], [6.8, 19.8], [11.6, 29.5], [16.2, 27.2], [11.3, 17.6], [19.5, 17.6]];
    sh.closed = true;
    p.property("ADBE Vector Shape").setValue(sh);

    var fl = g.addProperty("ADBE Vector Graphic - Fill");
    fl.property("ADBE Vector Fill Color").setValue([0.07, 0.09, 0.14]);
    var st = g.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue([1, 1, 1]);
    st.property("ADBE Vector Stroke Width").setValue(2.2);

    var tr = cur.property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").setValue([0, 0]);
    tr.property("ADBE Scale").setValue([scalePct, scalePct]);
    try {
      var ds = cur.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
      ds.property("ADBE Drop Shadow-0002").setValue(135);
      ds.property("ADBE Drop Shadow-0004").setValue(6);
      ds.property("ADBE Drop Shadow-0005").setValue(14);
    } catch (_e) {}
    if (useBlur) cur.motionBlur = true;
    return cur;
  }

  function addDualRipple(comp, camNull, t, x, y) {
    var rip = comp.layers.addShape();
    rip.name = "Click_Ripple_" + t.toFixed(2);
    rip.parent = camNull;
    rip.inPoint = Math.max(0, t - 0.02);
    rip.outPoint = t + 0.55;
    rip.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);

    var g = rip.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
    var el = g.addProperty("ADBE Vector Shape - Ellipse");
    var sz = el.property("ADBE Vector Ellipse Size");
    sz.setValueAtTime(t, [10, 10]);
    sz.setValueAtTime(t + 0.45, [96, 96]);
    easeProp(sz, 75);

    var st = g.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue([0.39, 0.40, 0.95]);
    var sw = st.property("ADBE Vector Stroke Width");
    sw.setValueAtTime(t, 5);
    sw.setValueAtTime(t + 0.45, 1);

    var op = rip.property("ADBE Transform Group").property("ADBE Opacity");
    op.setValueAtTime(t, 92);
    op.setValueAtTime(t + 0.45, 0);
  }

  function applySmoothCameraZooms(camNull, segments, compW, compH, zoomPct) {
    var pos = camNull.property("ADBE Transform Group").property("ADBE Position");
    var scl = camNull.property("ADBE Transform Group").property("ADBE Scale");
    var cx = compW / 2, cy = compH / 2;
    var z = zoomPct / 100;

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var t0 = Math.max(0, seg.startTime - 0.42);
      var t1 = seg.startTime;
      var t2 = seg.endTime;
      var t3 = seg.endTime + 0.48;

      var clampX = Math.max(compW * 0.22, Math.min(compW * 0.78, seg.x));
      var clampY = Math.max(compH * 0.22, Math.min(compH * 0.78, seg.y));
      var zoomedX = cx - z * (clampX - cx);
      var zoomedY = cy - z * (clampY - cy);

      pos.setValueAtTime(t0, [cx, cy]);
      scl.setValueAtTime(t0, [100, 100]);

      pos.setValueAtTime(t1, [zoomedX, zoomedY]);
      scl.setValueAtTime(t1, [zoomPct, zoomPct]);

      pos.setValueAtTime(t2, [zoomedX, zoomedY]);
      scl.setValueAtTime(t2, [zoomPct, zoomPct]);

      pos.setValueAtTime(t3, [cx, cy]);
      scl.setValueAtTime(t3, [100, 100]);
    }
    easeProp(pos, 82);
    easeProp(scl, 82);
  }

  function proAutoRig(args) {
    var vFile = new File(args.videoPath);
    if (!vFile.exists) throw new Error("Video not found: " + args.videoPath);

    app.beginUndoGroup("Pixopik Pro Studio Rig v1.0");
    try {
      var io = new ImportOptions(vFile);
      var footage = app.project.importFile(io);

      var preset = args.aspectPreset || "youtube_16_9";
      var compW = 1920, compH = 1080;
      if (preset === "shorts_9_16") { compW = 1080; compH = 1920; }
      else if (preset === "square_1_1") { compW = 1080; compH = 1080; }

      var dur = Math.max(2, footage.duration || 10);
      var compName = (args.compName || ("ProStudio_" + vFile.name.replace(/\.[^\.]+$/, ""))).slice(0, 58);
      var comp = app.project.items.addComp(compName, compW, compH, 1, dur, 60);
      comp.resolutionFactor = [1, 1];
      var useBlur = (args.motionBlur !== false);
      comp.motionBlur = useBlur;

      addProBackdrop(comp, args.wallpaper || "cosmic_indigo");

      /* Camera Rig Null created BEFORE parenting children */
      var camNull = comp.layers.addNull(dur);
      camNull.name = "05_Smart_Camera_Rig";
      var camTr = camNull.property("ADBE Transform Group");
      camTr.property("ADBE Anchor Point").setValue([compW / 2, compH / 2]);
      camTr.property("ADBE Position").setValue([compW / 2, compH / 2]);
      camTr.property("ADBE Scale").setValue([100, 100]);

      var vidLayer = comp.layers.add(footage);
      vidLayer.name = "02_Screen_Recording";
      var padPct = (args.windowPaddingPercent || (preset === "shorts_9_16" ? 90 : 84)) / 100;
      var fitScale = Math.min((compW * padPct) / footage.width, ((compH - 40) * padPct) / footage.height) * 100;
      vidLayer.property("ADBE Transform Group").property("ADBE Scale").setValue([fitScale, fitScale]);
      vidLayer.parent = camNull;

      var winW = footage.width * (fitScale / 100);
      var winH = footage.height * (fitScale / 100);
      var frameStyle = args.frameStyle || "macos_glass";
      var vidCenterY = addWindowChrome(comp, camNull, vidLayer, winW, winH, frameStyle, useBlur);

      var winLeft = (compW - winW) / 2;
      var winTop  = vidCenterY - (winH / 2);

      var motion = args.motion || null;
      var srcW = (motion && motion.screenWidth) ? motion.screenWidth : footage.width;
      var srcH = (motion && motion.screenHeight) ? motion.screenHeight : footage.height;

      function toComp(sx, sy) {
        return [winLeft + (sx / srcW) * winW, winTop + (sy / srcH) * winH];
      }

      var curCount = 0, zoomCount = 0;
      if (motion && args.vectorCursor !== false && motion.cursorKeys && motion.cursorKeys.length > 0) {
        var cur = createMacCursor(comp, args.cursorScale || 120, useBlur);
        cur.parent = camNull;
        cur.moveBefore(camNull);
        var cPos = cur.property("ADBE Transform Group").property("ADBE Position");
        var cScl = cur.property("ADBE Transform Group").property("ADBE Scale");
        var baseS = args.cursorScale || 120;

        for (var k = 0; k < motion.cursorKeys.length; k++) {
          var s = motion.cursorKeys[k];
          cPos.setValueAtTime(s.t, toComp(s.x, s.y));
          curCount++;
        }

        if (motion.clicks) {
          for (var c = 0; c < motion.clicks.length; c++) {
            var clk = motion.clicks[c];
            var cp = toComp(clk.x, clk.y);
            cScl.setValueAtTime(Math.max(0, clk.t - 0.05), [baseS, baseS]);
            cScl.setValueAtTime(clk.t, [baseS * 0.78, baseS * 0.78]);
            cScl.setValueAtTime(clk.t + 0.14, [baseS, baseS]);
            if (args.clickRipples !== false) addDualRipple(comp, camNull, clk.t, cp[0], cp[1]);
          }
        }
      }

      if (motion && args.autoZoom !== false && motion.zoomSegments && motion.zoomSegments.length > 0) {
        var mappedSegs = [];
        for (var z = 0; z < motion.zoomSegments.length; z++) {
          var zs = motion.zoomSegments[z];
          var pt = toComp(zs.x, zs.y);
          mappedSegs.push({ startTime: zs.startTime, endTime: zs.endTime, x: pt[0], y: pt[1] });
        }
        var zPct = args.zoomPercent || (preset === "shorts_9_16" ? 215 : 180);
        applySmoothCameraZooms(camNull, mappedSegs, compW, compH, zPct);
        zoomCount = mappedSegs.length;
      }

      comp.openInViewer();
      return {
        ok: true,
        compName: comp.name,
        width: compW,
        height: compH,
        wallpaper: args.wallpaper || "cosmic_indigo",
        frameStyle: frameStyle,
        cursorKeyframes: curCount,
        autoZoomClusters: zoomCount
      };
    } finally {
      app.endUndoGroup();
    }
  }

  function upgradeActiveComp(args) {
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) throw new Error("Open a composition first!");
    app.beginUndoGroup("Pixopik Upgrade Active Comp");
    try {
      comp.resolutionFactor = [1, 1];
      comp.motionBlur = true;
      addProBackdrop(comp, (args && args.wallpaper) || "cosmic_indigo");
      return { ok: true, compName: comp.name, upgraded: true };
    } finally {
      app.endUndoGroup();
    }
  }

  /* Hook into PixopikAE.dispatch */
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
    if (action === "import_and_autorig_recording" || action === "upgrade_active_comp") {
      try {
        var parsed = b64Args ? eval("(" + decB64(b64Args) + ")") : {};
        var res = (action === "upgrade_active_comp") ? upgradeActiveComp(parsed) : proAutoRig(parsed);
        return toJson(res);
      } catch (err) {
        return toJson({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    }
    return prevDispatch(action, b64Args);
  };
  PixopikAE._proRigLoaded = true;
})();
