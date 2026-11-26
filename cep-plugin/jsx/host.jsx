var PixopikAE = (function () {
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

  function decodeBase64(input) {
    var str = String(input || "").replace(/[^A-Za-z0-9\+\/\=]/g, "");
    var out = "";
    var i = 0;
    while (i < str.length) {
      var e1 = B64.indexOf(str.charAt(i++));
      var e2 = B64.indexOf(str.charAt(i++));
      var e3 = B64.indexOf(str.charAt(i++));
      var e4 = B64.indexOf(str.charAt(i++));
      var c1 = (e1 << 2) | (e2 >> 4);
      var c2 = ((e2 & 15) << 4) | (e3 >> 2);
      var c3 = ((e3 & 3) << 6) | e4;
      out += String.fromCharCode(c1);
      if (e3 !== 64) out += String.fromCharCode(c2);
      if (e4 !== 64) out += String.fromCharCode(c3);
    }
    try {
      return decodeURIComponent(escape(out));
    } catch (_e) {
      return out;
    }
  }

  function toJson(val) {
    if (typeof JSON !== "undefined" && JSON.stringify) return JSON.stringify(val);
    if (val === null || val === undefined) return "null";
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val === "string") {
      return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
    }
    if (val instanceof Array) {
      var arr = [];
      for (var i = 0; i < val.length; i++) arr.push(toJson(val[i]));
      return "[" + arr.join(",") + "]";
    }
    var pairs = [];
    for (var k in val) {
      if (val.hasOwnProperty(k) && typeof val[k] !== "function") {
        pairs.push(toJson(String(k)) + ":" + toJson(val[k]));
      }
    }
    return "{" + pairs.join(",") + "}";
  }

  function parseJson(txt) {
    if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(txt);
    return eval("(" + txt + ")");
  }

  function hexToRgb01(hex, fallback) {
    var h = String(hex || fallback || "#1E1B4B").replace("#", "");
    if (h.length < 6) h = "1E1B4B";
    var n = parseInt(h.substr(0, 6), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function getActiveComp() {
    var item = app.project ? app.project.activeItem : null;
    if (item && item instanceof CompItem) return item;
    if (app.project) {
      for (var i = 1; i <= app.project.numItems; i++) {
        if (app.project.item(i) instanceof CompItem) return app.project.item(i);
      }
    }
    return null;
  }

  function findLayerByName(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).name === name) return comp.layer(i);
    }
    return null;
  }

  function applyEasyEase(prop) {
    var ease = new KeyframeEase(0, 78);
    for (var k = 1; k <= prop.numKeys; k++) {
      try {
        var dims = (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) ? 1 : prop.value.length;
        if (!dims || dims < 1) dims = 1;
        var inArr = [];
        var outArr = [];
        for (var d = 0; d < dims; d++) {
          inArr.push(ease);
          outArr.push(ease);
        }
        prop.setTemporalEaseAtKey(k, inArr, outArr);
      } catch (_e) {}
    }
  }

  function addStudioBackdrop(comp, startHex, endHex) {
    var c1 = hexToRgb01(startHex, "#312E81");
    var c2 = hexToRgb01(endHex, "#0F172A");
    var bg = comp.layers.addSolid(c1, "01_Studio_Backdrop", comp.width, comp.height, 1);
    bg.moveToEnd();
    try {
      var ramp = bg.property("ADBE Effect Parade").addProperty("ADBE Ramp");
      ramp.property("ADBE Ramp-0001").setValue([comp.width * 0.2, 0]);
      ramp.property("ADBE Ramp-0002").setValue(c1);
      ramp.property("ADBE Ramp-0003").setValue([comp.width * 0.8, comp.height]);
      ramp.property("ADBE Ramp-0004").setValue(c2);
    } catch (_e) {}
    return bg;
  }

  function buildVectorCursor(comp, fillHex, strokeHex, scalePct) {
    var shpLayer = comp.layers.addShape();
    shpLayer.name = "04_Pro_Vector_Cursor";
    var root = shpLayer.property("ADBE Root Vectors Group");
    var grp = root.addProperty("ADBE Vector Group");
    grp.name = "Cursor_Arrow";
    var contents = grp.property("ADBE Vectors Group");

    var pathGrp = contents.addProperty("ADBE Vector Shape - Group");
    var myShape = new Shape();
    myShape.vertices = [[0, 0], [0, 28], [7, 22], [12.5, 33], [17, 30.8], [11.5, 19.8], [20, 19.8]];
    myShape.closed = true;
    pathGrp.property("ADBE Vector Shape").setValue(myShape);

    var fill = contents.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(hexToRgb01(fillHex, "#FFFFFF"));

    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue(hexToRgb01(strokeHex, "#0F172A"));
    stroke.property("ADBE Vector Stroke Width").setValue(2.5);

    shpLayer.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
    var sc = scalePct || 135;
    shpLayer.property("ADBE Transform Group").property("ADBE Scale").setValue([sc, sc]);
    shpLayer.motionBlur = true;

    try {
      var ds = shpLayer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
      ds.property("ADBE Drop Shadow-0002").setValue(110);
      ds.property("ADBE Drop Shadow-0004").setValue(6);
      ds.property("ADBE Drop Shadow-0005").setValue(14);
    } catch (_e) {}

    return shpLayer;
  }

  function addClickRipple(comp, x, y, t, camNull) {
    var rip = comp.layers.addShape();
    rip.name = "Click_Ripple_" + Math.round(t * 10);
    var contents = rip.property("ADBE Root Vectors Group");
    var ell = contents.addProperty("ADBE Vector Shape - Ellipse");
    ell.property("ADBE Vector Ellipse Size").setValue([64, 64]);
    var st = contents.addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue(hexToRgb01("#818CF8"));
    st.property("ADBE Vector Stroke Width").setValue(4);

    var tr = rip.property("ADBE Transform Group");
    tr.property("ADBE Position").setValue([x, y]);
    tr.property("ADBE Scale").setValueAtTime(t, [20, 20]);
    tr.property("ADBE Scale").setValueAtTime(t + 0.42, [145, 145]);
    tr.property("ADBE Opacity").setValueAtTime(t, 95);
    tr.property("ADBE Opacity").setValueAtTime(t + 0.42, 0);
    rip.inPoint = t;
    rip.outPoint = t + 0.45;
    if (camNull) rip.parent = camNull;
    return rip;
  }

  function applyZoomSegmentOnRig(camNull, compW, compH, startTime, endTime, targetX, targetY, zoomPct, transSec) {
    var tr = camNull.property("ADBE Transform Group");
    var anchor = tr.property("ADBE Anchor Point");
    var scale = tr.property("ADBE Scale");
    var d = transSec || 0.45;
    var z = zoomPct || 190;
    var cx = compW / 2;
    var cy = compH / 2;

    var t0 = Math.max(0, startTime - d);
    var t1 = startTime;
    var t2 = Math.max(t1 + 0.2, endTime);
    var t3 = t2 + d;

    anchor.setValueAtTime(t0, [cx, cy]);
    anchor.setValueAtTime(t1, [targetX, targetY]);
    anchor.setValueAtTime(t2, [targetX, targetY]);
    anchor.setValueAtTime(t3, [cx, cy]);

    scale.setValueAtTime(t0, [100, 100]);
    scale.setValueAtTime(t1, [z, z]);
    scale.setValueAtTime(t2, [z, z]);
    scale.setValueAtTime(t3, [100, 100]);

    applyEasyEase(anchor);
    applyEasyEase(scale);
  }

  var handlers = {
    get_project_info: function () {
      var comps = [];
      if (app.project) {
        for (var i = 1; i <= app.project.numItems; i++) {
          var it = app.project.item(i);
          if (it instanceof CompItem) {
            comps.push({ name: it.name, width: it.width, height: it.height, fps: it.frameRate, duration: it.duration, numLayers: it.numLayers });
          }
        }
      }
      var active = getActiveComp();
      var layers = [];
      if (active) {
        for (var l = 1; l <= active.numLayers; l++) {
          layers.push({ index: l, name: active.layer(l).name, enabled: active.layer(l).enabled });
        }
      }
      return {
        ok: true,
        aeVersion: app.version,
        compositions: comps,
        activeComp: active ? { name: active.name, width: active.width, height: active.height, time: active.time, duration: active.duration, layers: layers } : null
      };
    },

    create_composition: function (args) {
      var preset = args.preset || "youtube_16_9";
      var w = args.width || 1920;
      var h = args.height || 1080;
      if (preset === "shorts_9_16") { w = 1080; h = 1920; }
      else if (preset === "square_1_1") { w = 1080; h = 1080; }
      var fps = args.fps || 60;
      var dur = args.duration || 30;
      var cname = args.name || "Pixopik_SaaS_Edit";

      app.beginUndoGroup("Pixopik: Create Composition");
      var comp = app.project.items.addComp(cname, w, h, 1, dur, fps);
      comp.motionBlur = true;
      addStudioBackdrop(comp, args.bgStartHex || "#312E81", args.bgEndHex || "#0F172A");
      comp.openInViewer();
      app.endUndoGroup();
      return { ok: true, compName: comp.name, width: w, height: h, fps: fps, duration: dur };
    },

    import_and_autorig_recording: function (args) {
      var vFile = new File(args.videoPath);
      if (!vFile.exists) throw new Error("Video file not found: " + args.videoPath);

      app.beginUndoGroup("Pixopik: Auto-Rig Screen Studio");
      var io = new ImportOptions(vFile);
      var footage = app.project.importFile(io);

      var preset = args.aspectPreset || "youtube_16_9";
      var compW = 1920, compH = 1080;
      if (preset === "shorts_9_16") { compW = 1080; compH = 1920; }
      else if (preset === "square_1_1") { compW = 1080; compH = 1080; }

      var dur = Math.max(2, footage.duration || (args.motion && args.motion.duration) || 15);
      var fps = 60;
      var compName = "StudioEdit_" + vFile.name.replace(/\.[^\.]+$/, "");
      var comp = app.project.items.addComp(compName, compW, compH, 1, dur, fps);
      comp.motionBlur = true;

      addStudioBackdrop(comp, args.bgStartHex || "#312E81", args.bgEndHex || "#0F172A");

      var camNull = comp.layers.addNull();
      camNull.name = "05_Smart_Camera_Rig";
      camNull.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([compW / 2, compH / 2]);
      camNull.property("ADBE Transform Group").property("ADBE Position").setValue([compW / 2, compH / 2]);

      var vidLayer = comp.layers.add(footage);
      vidLayer.name = "02_Screen_Recording";
      vidLayer.motionBlur = true;

      var padPct = (args.windowPaddingPercent || (preset === "shorts_9_16" ? 94 : 86)) / 100;
      var fitScale = Math.min((compW * padPct) / footage.width, (compH * padPct) / footage.height);
      var scalePct = fitScale * 100;
      vidLayer.property("ADBE Transform Group").property("ADBE Scale").setValue([scalePct, scalePct]);
      vidLayer.property("ADBE Transform Group").property("ADBE Position").setValue([compW / 2, compH / 2]);

      try {
        var ds = vidLayer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
        ds.property("ADBE Drop Shadow-0002").setValue(135);
        ds.property("ADBE Drop Shadow-0003").setValue(180);
        ds.property("ADBE Drop Shadow-0004").setValue(24);
        ds.property("ADBE Drop Shadow-0005").setValue(65);
      } catch (_e) {}

      vidLayer.parent = camNull;

      var winLeft = (compW - footage.width * fitScale) / 2;
      var winTop  = (compH - footage.height * fitScale) / 2;
      var motion = args.motion;
      var srcW = (motion && motion.screenWidth) || footage.width;
      var srcH = (motion && motion.screenHeight) || footage.height;

      function mapPt(sx, sy) {
        return [
          winLeft + (sx / srcW) * (footage.width * fitScale),
          winTop  + (sy / srcH) * (footage.height * fitScale)
        ];
      }

      if (motion && args.vectorCursor !== false && motion.cursorKeys && motion.cursorKeys.length > 0) {
        var curLayer = buildVectorCursor(comp, "#FFFFFF", "#0F172A", args.cursorScale || 135);
        curLayer.parent = camNull;
        var posProp = curLayer.property("ADBE Transform Group").property("ADBE Position");
        var times = [];
        var vals = [];
        for (var i = 0; i < motion.cursorKeys.length; i++) {
          var ck = motion.cursorKeys[i];
          if (ck.t <= dur) {
            times.push(ck.t);
            vals.push(mapPt(ck.x, ck.y));
          }
        }
        if (times.length > 0) {
          posProp.setValuesAtTimes(times, vals);
        }

        if (motion.clicks && motion.clicks.length > 0) {
          var cScale = curLayer.property("ADBE Transform Group").property("ADBE Scale");
          var baseS = args.cursorScale || 135;
          for (var c = 0; c < motion.clicks.length; c++) {
            var cl = motion.clicks[c];
            if (cl.t < dur - 0.25) {
              cScale.setValueAtTime(Math.max(0, cl.t - 0.04), [baseS, baseS]);
              cScale.setValueAtTime(cl.t + 0.05, [baseS * 0.78, baseS * 0.78]);
              cScale.setValueAtTime(cl.t + 0.16, [baseS * 1.08, baseS * 1.08]);
              cScale.setValueAtTime(cl.t + 0.26, [baseS, baseS]);
              if (args.clickRipples !== false && c < 35) {
                var rp = mapPt(cl.x, cl.y);
                addClickRipple(comp, rp[0], rp[1], cl.t, camNull);
              }
            }
          }
        }
      }

      if (motion && args.autoZoom !== false && motion.zoomSegments && motion.zoomSegments.length > 0) {
        var peakZ = args.zoomPercent || (preset === "shorts_9_16" ? 225 : 185);
        for (var z = 0; z < motion.zoomSegments.length; z++) {
          var seg = motion.zoomSegments[z];
          if (seg.startTime < dur) {
            var zp = mapPt(seg.x, seg.y);
            applyZoomSegmentOnRig(camNull, compW, compH, seg.startTime, Math.min(dur - 0.2, seg.endTime), zp[0], zp[1], peakZ, 0.45);
          }
        }
      }

      camNull.moveToBeginning();
      comp.openInViewer();
      app.endUndoGroup();

      return {
        ok: true,
        compName: comp.name,
        aspectPreset: preset,
        width: compW,
        height: compH,
        cursorKeyframes: motion && motion.cursorKeys ? motion.cursorKeys.length : 0,
        autoZoomClusters: motion && motion.zoomSegments ? motion.zoomSegments.length : 0
      };
    },

    add_smart_zoom_segment: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      app.beginUndoGroup("Pixopik: Smart Zoom");
      var camNull = findLayerByName(comp, "05_Smart_Camera_Rig");
      if (!camNull) {
        camNull = comp.layers.addNull();
        camNull.name = "05_Smart_Camera_Rig";
        for (var i = 2; i <= comp.numLayers; i++) {
          if (comp.layer(i).name !== "01_Studio_Backdrop" && !comp.layer(i).parent) {
            comp.layer(i).parent = camNull;
          }
        }
      }
      applyZoomSegmentOnRig(camNull, comp.width, comp.height, args.startTime, args.endTime, args.targetX, args.targetY, args.zoomPercent || 195, args.transitionSec || 0.45);
      app.endUndoGroup();
      return { ok: true, comp: comp.name, startTime: args.startTime, endTime: args.endTime };
    },

    add_smart_zoom_at_playhead: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      return handlers.add_smart_zoom_segment({
        startTime: comp.time,
        endTime: Math.min(comp.duration, comp.time + 2.0),
        targetX: comp.width / 2,
        targetY: comp.height / 2,
        zoomPercent: (args && args.zoomPercent) || 195
      });
    },

    add_spotlight_focus: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      var st = args.startTime !== undefined ? args.startTime : comp.time;
      var dur = args.duration || 3;
      app.beginUndoGroup("Pixopik: Spotlight Focus");

      var dim = comp.layers.addSolid([0.03, 0.04, 0.08], "Spotlight_Dim_Overlay", comp.width, comp.height, 1);
      dim.inPoint = st;
      dim.outPoint = st + dur;
      var op = dim.property("ADBE Transform Group").property("ADBE Opacity");
      var maxOp = args.dimOpacity || 65;
      op.setValueAtTime(st, 0);
      op.setValueAtTime(st + 0.25, maxOp);
      op.setValueAtTime(st + dur - 0.25, maxOp);
      op.setValueAtTime(st + dur, 0);

      var m1 = dim.Masks.addProperty("ADBE Mask Atom");
      var s1 = new Shape();
      s1.vertices = [[0, 0], [comp.width, 0], [comp.width, comp.height], [0, comp.height]];
      s1.closed = true;
      m1.property("ADBE Mask Shape").setValue(s1);

      var m2 = dim.Masks.addProperty("ADBE Mask Atom");
      m2.maskMode = MaskMode.SUBTRACT;
      var s2 = new Shape();
      s2.vertices = [[args.x, args.y], [args.x + args.width, args.y], [args.x + args.width, args.y + args.height], [args.x, args.y + args.height]];
      s2.closed = true;
      m2.property("ADBE Mask Shape").setValue(s2);
      m2.property("ADBE Mask Feather").setValue([18, 18]);

      var border = comp.layers.addShape();
      border.name = "Spotlight_Glow_Frame";
      border.inPoint = st;
      border.outPoint = st + dur;
      var rGrp = border.property("ADBE Root Vectors Group");
      var rect = rGrp.addProperty("ADBE Vector Shape - Rect");
      rect.property("ADBE Vector Rect Size").setValue([args.width, args.height]);
      rect.property("ADBE Vector Rect Roundness").setValue(14);
      var strk = rGrp.addProperty("ADBE Vector Graphic - Stroke");
      strk.property("ADBE Vector Stroke Color").setValue(hexToRgb01(args.glowHex, "#818CF8"));
      strk.property("ADBE Vector Stroke Width").setValue(4);
      border.property("ADBE Transform Group").property("ADBE Position").setValue([args.x + args.width / 2, args.y + args.height / 2]);

      app.endUndoGroup();
      return { ok: true, startTime: st, duration: dur };
    },

    add_spotlight_at_playhead: function () {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      return handlers.add_spotlight_focus({
        x: comp.width * 0.3,
        y: comp.height * 0.3,
        width: comp.width * 0.4,
        height: comp.height * 0.25,
        startTime: comp.time,
        duration: 3
      });
    },

    add_blur_redact_zone: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      var st = args.startTime !== undefined ? args.startTime : 0;
      var dur = args.duration || (comp.duration - st);
      app.beginUndoGroup("Pixopik: Privacy Blur");

      var adj = comp.layers.addSolid([1, 1, 1], "Privacy_Blur_Zone", comp.width, comp.height, 1);
      adj.adjustmentLayer = true;
      adj.inPoint = st;
      adj.outPoint = st + dur;

      var mask = adj.Masks.addProperty("ADBE Mask Atom");
      var sh = new Shape();
      sh.vertices = [[args.x, args.y], [args.x + args.width, args.y], [args.x + args.width, args.y + args.height], [args.x, args.y + args.height]];
      sh.closed = true;
      mask.property("ADBE Mask Shape").setValue(sh);
      mask.property("ADBE Mask Feather").setValue([14, 14]);

      try {
        var gb = adj.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        gb.property("ADBE Gaussian Blur 2-0001").setValue(args.blurAmount || 38);
      } catch (_e) {}

      app.endUndoGroup();
      return { ok: true, layer: adj.name };
    },

    add_blur_at_playhead: function () {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      return handlers.add_blur_redact_zone({
        x: comp.width * 0.35,
        y: comp.height * 0.4,
        width: 360,
        height: 90,
        startTime: comp.time,
        duration: 4
      });
    },

    add_saas_callout: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      var st = args.startTime !== undefined ? args.startTime : comp.time;
      var dur = args.duration || 3;
      app.beginUndoGroup("Pixopik: SaaS Callout");

      var pillW = Math.max(220, String(args.text).length * 15 + 56);
      var pillH = 54;

      var bg = comp.layers.addShape();
      bg.name = "Callout_Pill_" + Math.round(st * 10);
      bg.inPoint = st;
      bg.outPoint = st + dur;
      var rv = bg.property("ADBE Root Vectors Group");
      var rc = rv.addProperty("ADBE Vector Shape - Rect");
      rc.property("ADBE Vector Rect Size").setValue([pillW, pillH]);
      rc.property("ADBE Vector Rect Roundness").setValue(27);
      var fl = rv.addProperty("ADBE Vector Graphic - Fill");
      fl.property("ADBE Vector Fill Color").setValue(hexToRgb01(args.accentHex, "#6366F1"));
      bg.property("ADBE Transform Group").property("ADBE Position").setValue([args.x, args.y]);

      var sc = bg.property("ADBE Transform Group").property("ADBE Scale");
      sc.setValueAtTime(st, [0, 0]);
      sc.setValueAtTime(st + 0.22, [106, 106]);
      sc.setValueAtTime(st + 0.34, [100, 100]);
      sc.setValueAtTime(st + dur - 0.2, [100, 100]);
      sc.setValueAtTime(st + dur, [0, 0]);

      var txt = comp.layers.addText(String(args.text));
      txt.name = "Callout_Label_" + Math.round(st * 10);
      txt.inPoint = st;
      txt.outPoint = st + dur;
      var srcText = txt.property("ADBE Text Properties").property("ADBE Text Document");
      var td = srcText.value;
      td.fontSize = 24;
      td.fillColor = [1, 1, 1];
      td.justification = ParagraphJustification.CENTER_JUSTIFY;
      srcText.setValue(td);
      txt.property("ADBE Transform Group").property("ADBE Position").setValue([args.x, args.y + 8]);
      txt.parent = bg;

      app.endUndoGroup();
      return { ok: true, callout: args.text, startTime: st };
    },

    add_callout_at_playhead: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      return handlers.add_saas_callout({
        text: (args && args.text) || "Click Here",
        x: comp.width / 2,
        y: comp.height * 0.22,
        startTime: comp.time,
        duration: 3
      });
    },

    add_kinetic_title: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      var st = args.startTime !== undefined ? args.startTime : comp.time;
      var dur = args.duration || 3.5;
      app.beginUndoGroup("Pixopik: Kinetic Title");

      var tLayer = comp.layers.addText(String(args.headline || "SaaS Demo"));
      tLayer.name = "Kinetic_Headline";
      tLayer.inPoint = st;
      tLayer.outPoint = st + dur;
      var prop = tLayer.property("ADBE Text Properties").property("ADBE Text Document");
      var doc = prop.value;
      doc.fontSize = args.style === "shorts_hook" ? 68 : 60;
      doc.fillColor = [1, 1, 1];
      doc.justification = ParagraphJustification.CENTER_JUSTIFY;
      prop.setValue(doc);

      var yTarget = args.style === "lower_third" ? comp.height * 0.84 : comp.height * 0.16;
      var pos = tLayer.property("ADBE Transform Group").property("ADBE Position");
      pos.setValueAtTime(st, [comp.width / 2, yTarget + 45]);
      pos.setValueAtTime(st + 0.35, [comp.width / 2, yTarget]);
      applyEasyEase(pos);

      var op = tLayer.property("ADBE Transform Group").property("ADBE Opacity");
      op.setValueAtTime(st, 0);
      op.setValueAtTime(st + 0.3, 100);
      op.setValueAtTime(st + dur - 0.3, 100);
      op.setValueAtTime(st + dur, 0);

      app.endUndoGroup();
      return { ok: true, headline: args.headline };
    },

    convert_comp_for_shorts: function (args) {
      var src = getActiveComp();
      if (!src) throw new Error("No active composition to convert.");
      app.beginUndoGroup("Pixopik: Convert to 9:16 Shorts");

      var shortsComp = app.project.items.addComp(src.name + "_Shorts_9x16", 1080, 1920, 1, src.duration, src.frameRate);
      shortsComp.motionBlur = true;
      addStudioBackdrop(shortsComp, "#312E81", "#0F172A");

      var nested = shortsComp.layers.add(src);
      var z = args.zoomPercent || 205;
      var baseFit = (1080 / src.width) * (z / 100) * 100;
      nested.property("ADBE Transform Group").property("ADBE Scale").setValue([baseFit, baseFit]);
      nested.property("ADBE Transform Group").property("ADBE Position").setValue([540, 960]);
      shortsComp.openInViewer();

      app.endUndoGroup();
      return { ok: true, shortsComp: shortsComp.name, width: 1080, height: 1920 };
    },

    apply_3d_saas_perspective: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      app.beginUndoGroup("Pixopik: 3D SaaS Perspective");

      var target = findLayerByName(comp, "05_Smart_Camera_Rig") || findLayerByName(comp, "02_Screen_Recording");
      if (!target) throw new Error("Screen recording layer not found.");
      target.threeDLayer = true;
      for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).parent === target) comp.layer(i).threeDLayer = true;
      }

      var st = (args && args.startTime !== undefined) ? args.startTime : comp.time;
      var dur = (args && args.duration) || 4;
      var tr = target.property("ADBE Transform Group");
      tr.property("ADBE Rotate X").setValue((args && args.rotX) || 5);
      var ry = tr.property("ADBE Rotate Y");
      ry.setValueAtTime(st, (args && args.rotYStart !== undefined) ? args.rotYStart : -11);
      ry.setValueAtTime(st + dur, (args && args.rotYEnd !== undefined) ? args.rotYEnd : 6);
      applyEasyEase(ry);

      app.endUndoGroup();
      return { ok: true, layer: target.name };
    },

    customize_cursor_style: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      var cur = findLayerByName(comp, "04_Pro_Vector_Cursor");
      if (!cur) throw new Error("Vector cursor layer not found.");
      app.beginUndoGroup("Pixopik: Customize Cursor");
      if (args.scalePercent) {
        cur.property("ADBE Transform Group").property("ADBE Scale").setValue([args.scalePercent, args.scalePercent]);
      }
      if (args.motionBlur !== undefined) cur.motionBlur = Boolean(args.motionBlur);
      app.endUndoGroup();
      return { ok: true };
    },

    set_studio_background: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      app.beginUndoGroup("Pixopik: Update Studio Background");
      var oldBg = findLayerByName(comp, "01_Studio_Backdrop");
      if (oldBg) oldBg.remove();
      addStudioBackdrop(comp, args.startHex, args.endHex);
      app.endUndoGroup();
      return { ok: true };
    },

    trim_or_speed_ramp: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      var vid = findLayerByName(comp, "02_Screen_Recording");
      if (!vid) throw new Error("02_Screen_Recording layer not found.");
      app.beginUndoGroup("Pixopik: Speed Ramp");
      vid.timeRemapEnabled = true;
      var tr = vid.property("ADBE Time Remapping");
      var s = args.startTime;
      var e = args.endTime;
      var mult = Math.max(1.1, args.speedMultiplier || 2.5);
      var newEnd = s + (e - s) / mult;
      tr.setValueAtTime(s, s);
      tr.setValueAtTime(newEnd, e);
      app.endUndoGroup();
      return { ok: true, savedSeconds: (e - s) - (newEnd - s) };
    },

    export_frame_preview: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      var t = (args && args.timeSeconds !== undefined) ? Number(args.timeSeconds) : comp.time;
      var outFile = new File(args.outPath);
      comp.saveFrameToPng(t, outFile);
      return { ok: true, comp: comp.name, timeSeconds: t };
    },

    render_video: function (args) {
      var comp = getActiveComp();
      if (!comp) throw new Error("No active composition.");
      var rqi = app.project.renderQueue.items.add(comp);
      if (args && args.outputPath) {
        rqi.outputModule(1).file = new File(args.outputPath);
      }
      if (args && args.startRender) {
        app.project.renderQueue.render();
      }
      return { ok: true, comp: comp.name, status: String(rqi.status) };
    },

    run_extendscript: function (args) {
      app.beginUndoGroup("Pixopik: Custom ExtendScript");
      try {
        var fn = new Function(String(args.script || ""));
        var res = fn();
        app.endUndoGroup();
        return { ok: true, result: res };
      } catch (err) {
        app.endUndoGroup();
        throw err;
      }
    }
  };

  return {
    dispatch: function (action, b64Args) {
      try {
        var args = b64Args ? parseJson(decodeBase64(b64Args)) : {};
        if (!handlers[action]) {
          return toJson({ ok: false, error: "Unknown AE action: " + action });
        }
        var out = handlers[action](args);
        return toJson(out);
      } catch (e) {
        return toJson({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    }
  };
})();
