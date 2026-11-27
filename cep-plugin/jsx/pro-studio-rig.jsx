(function () {
  if (typeof PixopikAE === "undefined") return;

  var THEMES = {
    cosmic_indigo:  ["#4F46E5", "#9333EA", "#1E1B4B", "#0F172A"],
    ocean_breeze:   ["#0284C7", "#2563EB", "#0F766E", "#0F172A"],
    sunset_saas:    ["#F97316", "#EC4899", "#6D28D9", "#1E1B4B"],
    dark_carbon:    ["#3F3F46", "#27272A", "#18181B", "#09090B"],
    clean_daylight: ["#C7D2FE", "#BAE6FD", "#F1F5F9", "#E0E7FF"]
  };

  function u16(n) { return String.fromCharCode(n & 255, (n >> 8) & 255); }
  function u32(n) { return String.fromCharCode(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255); }

  function writeWavMono16(fileObj, sr, samples) {
    var dataLen = samples.length * 2;
    var hdr = "RIFF" + u32(36 + dataLen) + "WAVEfmt " + u32(16) + u16(1) + u16(1) + u32(sr) + u32(sr * 2) + u16(2) + u16(16) + "data" + u32(dataLen);
    var chunks = [hdr];
    for (var i = 0; i < samples.length; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      var v = Math.round(s * 32767);
      if (v < 0) v += 65536;
      chunks.push(String.fromCharCode(v & 255, (v >> 8) & 255));
    }
    fileObj.encoding = "BINARY";
    if (fileObj.open("w")) { fileObj.write(chunks.join("")); fileObj.close(); }
  }

  function ensureBalancedClickWav(pathStr) {
    var f = new File(pathStr);
    if (f.exists && f.length > 500) return f;
    var sr = 44100, dur = 0.052, n = Math.floor(sr * dur), arr = [];
    for (var i = 0; i < n; i++) {
      var t = i / sr;
      var snap = Math.exp(-t * 440) * 0.52;
      var thock = Math.sin(2 * Math.PI * (250 + 1320 * Math.exp(-t * 165)) * t) * Math.exp(-t * 120) * 0.65;
      var body = Math.sin(2 * Math.PI * 210 * t) * Math.exp(-t * 90) * 0.30;
      arr.push((snap + thock + body) * 0.56);
    }
    writeWavMono16(f, sr, arr);
    return f;
  }

  function ensureVelvetWhooshWav(pathStr) {
    var f = new File(pathStr);
    if (f.exists && f.length > 1000) return f;
    var sr = 44100, dur = 0.27, n = Math.floor(sr * dur), raw = [];
    var seed = 24681357, x1 = 0, x2 = 0, y1a = 0, y2a = 0, y1b = 0, y2b = 0, maxAbs = 0.0001;
    for (var i = 0; i < n; i++) {
      var u = i / n, sSin = Math.sin(Math.PI * u), env = Math.pow(sSin, 1.75);
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff; var r1 = (seed / 1073741824.0) - 1.0;
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff; var r2 = (seed / 1073741824.0) - 1.0;
      var x0 = (r1 + r2) * 0.5;
      var wA = 2 * Math.PI * (210 + 480 * Math.pow(sSin, 1.35)) / sr, alA = Math.sin(wA) / 2.7;
      var ya = (alA * (x0 - x2) - (-2 * Math.cos(wA)) * y1a - (1 - alA) * y2a) / (1 + alA);
      y2a = y1a; y1a = ya;
      var wB = 2 * Math.PI * (420 + 730 * Math.pow(sSin, 1.5)) / sr, alB = Math.sin(wB) / 3.2;
      var yb = (alB * (x0 - x2) - (-2 * Math.cos(wB)) * y1b - (1 - alB) * y2b) / (1 + alB);
      y2b = y1b; y1b = yb;
      x2 = x1; x1 = x0;
      var val = (ya * 0.72 + yb * 0.28) * env;
      raw.push(val);
      if (Math.abs(val) > maxAbs) maxAbs = Math.abs(val);
    }
    var out = [];
    for (var j = 0; j < raw.length; j++) out.push((raw[j] / maxAbs) * 0.34);
    writeWavMono16(f, sr, out);
    return f;
  }

  function hexToRgb(hex) {
    var s = String(hex || "#4F46E5").replace("#", "");
    var n = parseInt(s, 16);
    if (isNaN(n)) return [0.31, 0.27, 0.9];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function easeProp(prop, inf) {
    var influence = inf || 80;
    for (var k = 1; k <= prop.numKeys; k++) {
      var dims = 1;
      try { var vt = prop.keyValue(k); if (vt instanceof Array) dims = vt.length; } catch (_e) {}
      var eIn = [], eOut = [];
      for (var d = 0; d < dims; d++) { eIn.push(new KeyframeEase(0, influence)); eOut.push(new KeyframeEase(0, influence)); }
      try { prop.setTemporalEaseAtKey(k, eIn, eOut); } catch (_e2) {
        try { prop.setTemporalEaseAtKey(k, [new KeyframeEase(0, influence)], [new KeyframeEase(0, influence)]); } catch (_e3) {}
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
    tr.property("ADBE Scale").setValue([122, 122]);

    var fx = bg.property("ADBE Effect Parade");
    try {
      var g4 = fx.addProperty("ADBE 4ColorGradient");
      g4.property(1).setValue([comp.width * 0.15, comp.height * 0.18]);
      g4.property(2).setValue(c1);
      g4.property(3).setValue([comp.width * 0.85, comp.height * 0.20]);
      g4.property(4).setValue(c2);
      g4.property(5).setValue([comp.width * 0.18, comp.height * 0.85]);
      g4.property(6).setValue(c3);
      g4.property(7).setValue([comp.width * 0.85, comp.height * 0.82]);
      g4.property(8).setValue(c4);
      g4.property(1).expression = "[width*0.2 + Math.sin(time*0.7)*220, height*0.2 + Math.cos(time*0.5)*140]";
      g4.property(3).expression = "[width*0.8 + Math.cos(time*0.6)*220, height*0.25 + Math.sin(time*0.8)*140]";
      g4.property(5).expression = "[width*0.25 + Math.cos(time*0.5)*200, height*0.8 + Math.sin(time*0.6)*140]";
    } catch (_e) {}
    return bg;
  }

  function addWindowChrome(comp, camNull, vidLayer, winW, winH, style, useBlur) {
    var cx = comp.width / 2, cy = comp.height / 2;
    var headerH = (style === "macos_glass") ? 34 : 0;
    var radius = (style === "sharp_clean") ? 0 : 22;
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
      st.property("ADBE Vector Stroke Opacity").setValue(24);
      st.property("ADBE Vector Stroke Width").setValue(2);
    }
    try {
      var ds1 = card.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
      ds1.property("ADBE Drop Shadow-0002").setValue(165);
      ds1.property("ADBE Drop Shadow-0004").setValue(28);
      ds1.property("ADBE Drop Shadow-0005").setValue(90);
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
      ds.property("ADBE Drop Shadow-0005").setValue(14);
    } catch (_e) {}
    if (useBlur) cur.motionBlur = true;

    var halo = comp.layers.addShape();
    halo.name = "04B_Cursor_Glow_Halo";
    halo.parent = cur;
    halo.moveAfter(cur);
    halo.property("ADBE Transform Group").property("ADBE Position").setValue([6, 10]);
    var hg = halo.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
    hg.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([38, 38]);
    hg.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([0.39, 0.40, 0.98]);
    halo.property("ADBE Transform Group").property("ADBE Opacity").setValue(26);
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
    var sz = g.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size");
    sz.setValueAtTime(t, [10, 10]);
    sz.setValueAtTime(t + 0.45, [96, 96]);
    easeProp(sz, 75);
    var st = g.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue([0.39, 0.40, 0.95]);
    st.property("ADBE Vector Stroke Width").setValueAtTime(t, 5);
    st.property("ADBE Vector Stroke Width").setValueAtTime(t + 0.45, 1);
    var op = rip.property("ADBE Transform Group").property("ADBE Opacity");
    op.setValueAtTime(t, 92);
    op.setValueAtTime(t + 0.45, 0);
  }

  function proAutoRig(args) {
    var vFile = new File(args.videoPath);
    if (!vFile.exists) throw new Error("Video not found: " + args.videoPath);

    app.beginUndoGroup("Pixopik Agency Studio Rig v2.3");
    try {
      var footage = app.project.importFile(new ImportOptions(vFile));
      var preset = args.aspectPreset || "youtube_16_9";
      var compW = 1920, compH = 1080;
      if (preset === "shorts_9_16") { compW = 1080; compH = 1920; }
      else if (preset === "square_1_1") { compW = 1080; compH = 1080; }
      var cx = compW / 2, cy = compH / 2;

      var dur = Math.max(2, footage.duration || 10);
      var comp = app.project.items.addComp(("AgencyStudio_" + vFile.name.replace(/\.[^\.]+$/, "")).slice(0, 58), compW, compH, 1, dur, 60);
      comp.resolutionFactor = [1, 1];
      var useBlur = (args.motionBlur !== false);
      comp.motionBlur = useBlur;

      addProBackdrop(comp, args.wallpaper || "cosmic_indigo");

      var camNull = comp.layers.addNull(dur);
      camNull.name = "05_Smart_Camera_Rig";
      var camTr = camNull.property("ADBE Transform Group");
      camTr.property("ADBE Anchor Point").setValue([cx, cy]);
      camTr.property("ADBE Position").setValue([cx, cy]);
      camTr.property("ADBE Scale").setValue([100, 100]);

      var vidLayer = comp.layers.add(footage);
      vidLayer.name = "02_Screen_Recording";
      var padPct = (args.windowPaddingPercent || (preset === "shorts_9_16" ? 90 : 84)) / 100;
      var fitScale = Math.min((compW * padPct) / footage.width, ((compH - 40) * padPct) / footage.height) * 100;
      vidLayer.property("ADBE Transform Group").property("ADBE Scale").setValue([fitScale, fitScale]);
      vidLayer.parent = camNull;

      var winW = footage.width * (fitScale / 100);
      var winH = footage.height * (fitScale / 100);
      var vidCenterY = addWindowChrome(comp, camNull, vidLayer, winW, winH, args.frameStyle || "macos_glass", useBlur);
      var winLeft = cx - (winW / 2), winTop = vidCenterY - (winH / 2);

      var motion = args.motion || null;
      var srcW = (motion && motion.screenWidth) ? motion.screenWidth : footage.width;
      var srcH = (motion && motion.screenHeight) ? motion.screenHeight : footage.height;
      function toComp(sx, sy) { return [winLeft + (sx / srcW) * winW, winTop + (sy / srcH) * winH]; }

      var clicks = (motion && motion.clicks) ? motion.clicks : [];
      var curCount = 0;

      if (motion && args.vectorCursor !== false && motion.cursorKeys && motion.cursorKeys.length > 0) {
        var baseS = args.cursorScale || 160;
        var cur = createAgencyCursor(comp, baseS, useBlur);
        cur.parent = camNull;
        var cPos = cur.property("ADBE Transform Group").property("ADBE Position");
        var cScl = cur.property("ADBE Transform Group").property("ADBE Scale");
        for (var k = 0; k < motion.cursorKeys.length; k++) {
          var s = motion.cursorKeys[k];
          cPos.setValueAtTime(s.t, toComp(s.x, s.y));
          curCount++;
        }
        for (var c = 0; c < clicks.length; c++) {
          var clk = clicks[c];
          var cp = toComp(clk.x, clk.y);
          cScl.setValueAtTime(Math.max(0, clk.t - 0.05), [baseS, baseS]);
          cScl.setValueAtTime(clk.t, [baseS * 0.78, baseS * 0.78]);
          cScl.setValueAtTime(clk.t + 0.14, [baseS, baseS]);
          if (args.clickRipples !== false) addDualRipple(comp, camNull, clk.t, cp[0], cp[1]);
        }
        cur.moveToBeginning();
      }

      var dirAdj = comp.layers.addSolid([1, 1, 1], "06_Cinema_3D_Director", compW, compH, 1);
      dirAdj.adjustmentLayer = true;
      dirAdj.moveToBeginning();
      var b3d = null;
      try { b3d = dirAdj.property("ADBE Effect Parade").addProperty("ADBE Basic 3D"); } catch (_eB) {}
      var swivel = b3d ? b3d.property(1) : null, tilt = b3d ? b3d.property(2) : null;

      var camPos = camTr.property("ADBE Position"), camScl = camTr.property("ADBE Scale");
      camPos.setValueAtTime(0, [cx, cy + 36]); camScl.setValueAtTime(0, [85, 85]);
      camPos.setValueAtTime(0.95, [cx, cy]);   camScl.setValueAtTime(0.95, [100, 100]);
      if (swivel && tilt) { swivel.setValueAtTime(0, -8); tilt.setValueAtTime(0, 6); swivel.setValueAtTime(0.95, 0); tilt.setValueAtTime(0.95, 0); }

      var zoomPct = args.zoomPercent || (preset === "shorts_9_16" ? 215 : 178);
      var z = zoomPct / 100, zoomClusters = 0;

      if (args.autoZoom !== false && clicks.length > 0) {
        var idx = 0;
        while (idx < clicks.length) {
          if (clicks[idx].t < 1.05) { idx++; continue; }
          var enterT = Math.max(1.0, clicks[idx].t - 0.45);
          camPos.setValueAtTime(enterT, [cx, cy]); camScl.setValueAtTime(enterT, [100, 100]);
          if (swivel && tilt) { swivel.setValueAtTime(enterT, 0); tilt.setValueAtTime(enterT, 0); }
          zoomClusters++;

          var lastHold = clicks[idx].t;
          while (idx < clicks.length) {
            var cn = clicks[idx];
            var pt = toComp(cn.x, cn.y);
            var zx = cx - z * (pt[0] - cx), zy = cy - z * (pt[1] - cy);
            var maxPX = (compW * (z - 1)) / 2, maxPY = (compH * (z - 1)) / 2;
            zx = Math.max(cx - maxPX, Math.min(cx + maxPX, zx));
            zy = Math.max(cy - maxPY, Math.min(cy + maxPY, zy));

            var holdT = cn.t + 0.85;
            camPos.setValueAtTime(cn.t, [zx, zy]);  camScl.setValueAtTime(cn.t, [zoomPct, zoomPct]);
            camPos.setValueAtTime(holdT, [zx, zy]); camScl.setValueAtTime(holdT, [zoomPct, zoomPct]);
            if (swivel && tilt) {
              var swA = ((pt[0] - cx) / cx) * 5.0, tlA = -((pt[1] - cy) / cy) * 3.2;
              swivel.setValueAtTime(cn.t, swA); tilt.setValueAtTime(cn.t, tlA);
              swivel.setValueAtTime(holdT, swA * 0.5); tilt.setValueAtTime(holdT, tlA * 0.5);
            }
            lastHold = holdT;
            if (idx + 1 < clicks.length && (clicks[idx + 1].t - holdT) < 1.8) idx++;
            else { idx++; break; }
          }
          var exitT = Math.min(dur - 0.1, lastHold + 0.52);
          camPos.setValueAtTime(exitT, [cx, cy]); camScl.setValueAtTime(exitT, [100, 100]);
          if (swivel && tilt) { swivel.setValueAtTime(exitT, 0); tilt.setValueAtTime(exitT, 0); }
        }
      }
      easeProp(camPos, 82); easeProp(camScl, 82);
      if (swivel) easeProp(swivel, 78); if (tilt) easeProp(tilt, 78);

      /* Balanced Click (-2.5dB) + Subtle Biquad Velvet Whoosh (-4dB) on separate layers */
      try {
        var tmp = Folder.temp.fsName.replace(/\\/g, "/");
        var clickItem = app.project.importFile(new ImportOptions(ensureBalancedClickWav(tmp + "/px_balanced_click_v3.wav")));
        var whooshItem = app.project.importFile(new ImportOptions(ensureVelvetWhooshWav(tmp + "/px_velvet_whoosh_v3.wav")));

        var clickComp = app.project.items.addComp("07_Mouse_Click_SFX_" + comp.name.slice(-5), 100, 100, 1, dur, 60);
        for (var sc = 0; sc < clicks.length; sc++) {
          var cl = clickComp.layers.add(clickItem);
          cl.startTime = Math.max(0, clicks[sc].t - 0.004);
        }
        var clickLyr = comp.layers.add(clickComp);
        clickLyr.name = "07_Mouse_Click_SFX"; clickLyr.enabled = false; clickLyr.audioEnabled = true;
        try { clickLyr.property("ADBE Audio Group").property("ADBE Audio Levels").setValue([-2.5, -2.5]); } catch (_ea1) {}

        var wComp = app.project.items.addComp("07B_Soft_Whoosh_SFX_" + comp.name.slice(-5), 100, 100, 1, dur, 60);
        wComp.layers.add(whooshItem).startTime = 0.06;
        var lastW = 0.5;
        for (var wc = 0; wc < clicks.length; wc++) {
          if (clicks[wc].t > 1.1 && (clicks[wc].t - lastW) >= 3.2) {
            wComp.layers.add(whooshItem).startTime = Math.max(0, clicks[wc].t - 0.32);
            lastW = clicks[wc].t;
          }
        }
        var wLyr = comp.layers.add(wComp);
        wLyr.name = "07B_Soft_Whoosh_SFX"; wLyr.enabled = false; wLyr.audioEnabled = true;
        try { wLyr.property("ADBE Audio Group").property("ADBE Audio Levels").setValue([-4, -4]); } catch (_ea2) {}
      } catch (_sfxErr) {}

      comp.openInViewer();
      return { ok: true, compName: comp.name, cursorKeyframes: curCount, autoZoomClusters: zoomClusters, clicksWithSfx: clicks.length };
    } finally {
      app.endUndoGroup();
    }
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
    if (action === "import_and_autorig_recording") {
      try {
        var parsed = b64Args ? eval("(" + decB64(b64Args) + ")") : {};
        return toJson(proAutoRig(parsed));
      } catch (err) {
        return toJson({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    }
    return prevDispatch(action, b64Args);
  };
  PixopikAE._proRigLoaded = true;
})();
