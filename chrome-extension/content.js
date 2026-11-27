(function () {
  if (window.__pixopikPresenterLoaded) return;
  window.__pixopikPresenterLoaded = true;

  var activeTool = "cursor"; // cursor | spotlight | box | arrow | pen | blur | step | laser
  var stepCounter = 1;
  var spotLocked = false;
  var drawing = false;
  var startX = 0, startY = 0;
  var currentSvgEl = null;
  var penPoints = [];
  var blurredEls = [];
  var mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;

  // Root overlay container (only shows clean visual highlights, ZERO UI buttons!)
  var root = document.createElement("div");
  root.id = "px-studio-overlay-root";
  root.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;";
  document.documentElement.appendChild(root);

  // Spotlight dim layer with smooth rounded hole via huge box-shadow
  var spotHole = document.createElement("div");
  spotHole.style.cssText = [
    "position:fixed;left:-9999px;top:-9999px;width:0;height:0;border-radius:14px;",
    "box-shadow:0 0 0 9999px rgba(6,10,22,0.68), 0 0 28px 3px rgba(99,102,241,0.75);",
    "border:2px solid rgba(129,140,248,0.9);transition:all 0.14s cubic-bezier(0.22,1,0.36,1);",
    "pointer-events:none;opacity:0;"
  ].join("");
  root.appendChild(spotHole);

  // SVG Drawing Canvas for Boxes, Arrows, Pen & Laser
  var svgNS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("style", "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;overflow:visible;");
  var defs = document.createElementNS(svgNS, "defs");
  defs.innerHTML = [
    '<filter id="pxGlow" x="-30%" y="-30%" width="160%" height="160%">',
    '  <feGaussianBlur stdDeviation="4" result="blur"/>',
    '  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>',
    '</filter>',
    '<marker id="pxArrowHead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">',
    '  <path d="M0,1 L9,5 L0,9 Z" fill="#6366F1" />',
    '</marker>'
  ].join("");
  svg.appendChild(defs);
  root.appendChild(svg);

  // Laser Dot
  var laserDot = document.createElement("div");
  laserDot.style.cssText = [
    "position:fixed;width:18px;height:18px;border-radius:50%;left:-100px;top:-100px;",
    "background:radial-gradient(circle,#fff 20%,#ef4444 65%,transparent 100%);",
    "box-shadow:0 0 18px 6px rgba(239,68,68,0.85);pointer-events:none;opacity:0;transform:translate(-50%,-50%);"
  ].join("");
  root.appendChild(laserDot);

  function setInteractiveCapture(captureMouse) {
    root.style.pointerEvents = captureMouse ? "auto" : "none";
    root.style.cursor = captureMouse ? "crosshair" : "default";
  }

  function clearAllAnnotations() {
    while (svg.childNodes.length > 1) svg.removeChild(svg.lastChild);
    var badges = root.querySelectorAll(".px-step-badge");
    for (var i = 0; i < badges.length; i++) badges[i].remove();
    stepCounter = 1;
    spotLocked = false;
    if (activeTool !== "spotlight") spotHole.style.opacity = "0";
  }

  function unblurAll() {
    for (var i = 0; i < blurredEls.length; i++) {
      blurredEls[i].style.filter = blurredEls[i].__pxOrigFilter || "";
      delete blurredEls[i].__pxBlurred;
    }
    blurredEls = [];
  }

  function setTool(toolName) {
    if (toolName === "clear") { clearAllAnnotations(); return; }
    if (toolName === "unblur_all") { unblurAll(); return; }
    if (toolName === "reset_steps") { stepCounter = 1; return; }

    activeTool = (activeTool === toolName && toolName !== "cursor") ? "cursor" : toolName;
    spotLocked = false;
    spotHole.style.opacity = (activeTool === "spotlight") ? "1" : "0";
    laserDot.style.opacity = (activeTool === "laser") ? "1" : "0";

    var needsDrawOverlay = (activeTool === "box" || activeTool === "arrow" || activeTool === "pen" || activeTool === "step");
    setInteractiveCapture(needsDrawOverlay);
    if (activeTool === "spotlight") updateSpotlightAt(mouseX, mouseY);
  }

  function updateSpotlightAt(x, y) {
    if (activeTool !== "spotlight" || spotLocked) return;
    spotHole.style.display = "none";
    var el = document.elementFromPoint(x, y);
    spotHole.style.display = "block";
    if (!el || el === document.body || el === document.documentElement) {
      spotHole.style.left = (x - 140) + "px";
      spotHole.style.top = (y - 80) + "px";
      spotHole.style.width = "280px";
      spotHole.style.height = "160px";
      return;
    }
    // Snap cleanly to meaningful UI card/button/input
    var cur = el;
    while (cur && cur.parentElement && cur !== document.body) {
      var r = cur.getBoundingClientRect();
      if (r.width >= 48 && r.height >= 26 && r.width <= window.innerWidth * 0.88 && r.height <= window.innerHeight * 0.82) {
        spotHole.style.left = Math.max(4, r.left - 8) + "px";
        spotHole.style.top = Math.max(4, r.top - 8) + "px";
        spotHole.style.width = (r.width + 16) + "px";
        spotHole.style.height = (r.height + 16) + "px";
        return;
      }
      cur = cur.parentElement;
    }
  }

  window.addEventListener("mousemove", function (e) {
    mouseX = e.clientX; mouseY = e.clientY;
    if (activeTool === "spotlight") updateSpotlightAt(mouseX, mouseY);
    if (activeTool === "laser") {
      laserDot.style.left = mouseX + "px";
      laserDot.style.top = mouseY + "px";
    }
    if (!drawing || !currentSvgEl) return;

    if (activeTool === "box") {
      var x = Math.min(startX, mouseX), y = Math.min(startY, mouseY);
      var w = Math.max(6, Math.abs(mouseX - startX)), h = Math.max(6, Math.abs(mouseY - startY));
      currentSvgEl.setAttribute("x", x);
      currentSvgEl.setAttribute("y", y);
      currentSvgEl.setAttribute("width", w);
      currentSvgEl.setAttribute("height", h);
    } else if (activeTool === "arrow") {
      currentSvgEl.setAttribute("x2", mouseX);
      currentSvgEl.setAttribute("y2", mouseY);
    } else if (activeTool === "pen") {
      penPoints.push(mouseX + "," + mouseY);
      currentSvgEl.setAttribute("points", penPoints.join(" "));
    }
  }, true);

  window.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;

    if (activeTool === "spotlight" && e.altKey) {
      spotLocked = !spotLocked;
      e.preventDefault(); e.stopPropagation();
      return;
    }

    if (activeTool === "blur") {
      e.preventDefault(); e.stopPropagation();
      root.style.display = "none";
      var target = document.elementFromPoint(e.clientX, e.clientY);
      root.style.display = "block";
      if (target && target !== document.body && target !== document.documentElement) {
        if (target.__pxBlurred) {
          target.style.filter = target.__pxOrigFilter || "";
          delete target.__pxBlurred;
        } else {
          target.__pxOrigFilter = target.style.filter || "";
          target.style.filter = "blur(10px)";
          target.style.transition = "filter 0.2s ease";
          target.__pxBlurred = true;
          blurredEls.push(target);
        }
      }
      return;
    }

    if (activeTool === "step") {
      e.preventDefault(); e.stopPropagation();
      var badge = document.createElement("div");
      badge.className = "px-step-badge";
      badge.textContent = String(stepCounter++);
      badge.style.cssText = [
        "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;",
        "width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#ec4899);",
        "color:#fff;font:800 16px 'Segoe UI',Inter,sans-serif;display:flex;align-items:center;justify-content:center;",
        "border:2.5px solid #fff;box-shadow:0 6px 18px rgba(99,102,241,0.65);transform:translate(-50%,-50%) scale(0);",
        "transition:transform 0.25s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;"
      ].join("");
      root.appendChild(badge);
      requestAnimationFrame(function () { badge.style.transform = "translate(-50%,-50%) scale(1)"; });
      return;
    }

    if (activeTool === "box" || activeTool === "arrow" || activeTool === "pen") {
      e.preventDefault(); e.stopPropagation();
      drawing = true;
      startX = e.clientX; startY = e.clientY;
      if (activeTool === "box") {
        var rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", startX); rect.setAttribute("y", startY);
        rect.setAttribute("width", 4); rect.setAttribute("height", 4);
        rect.setAttribute("rx", "12");
        rect.setAttribute("fill", "rgba(99,102,241,0.08)");
        rect.setAttribute("stroke", "#6366F1");
        rect.setAttribute("stroke-width", "3.5");
        rect.setAttribute("filter", "url(#pxGlow)");
        svg.appendChild(rect);
        currentSvgEl = rect;
      } else if (activeTool === "arrow") {
        var line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", startX); line.setAttribute("y1", startY);
        line.setAttribute("x2", startX + 4); line.setAttribute("y2", startY + 4);
        line.setAttribute("stroke", "#6366F1");
        line.setAttribute("stroke-width", "4");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("marker-end", "url(#pxArrowHead)");
        line.setAttribute("filter", "url(#pxGlow)");
        svg.appendChild(line);
        currentSvgEl = line;
      } else if (activeTool === "pen") {
        penPoints = [startX + "," + startY];
        var poly = document.createElementNS(svgNS, "polyline");
        poly.setAttribute("points", penPoints.join(" "));
        poly.setAttribute("fill", "none");
        poly.setAttribute("stroke", "#EC4899");
        poly.setAttribute("stroke-width", "4.5");
        poly.setAttribute("stroke-linecap", "round");
        poly.setAttribute("stroke-linejoin", "round");
        poly.setAttribute("filter", "url(#pxGlow)");
        svg.appendChild(poly);
        currentSvgEl = poly;
      }
    }
  }, true);

  window.addEventListener("mouseup", function () {
    if (!drawing) return;
    drawing = false;
    if (activeTool === "pen" && currentSvgEl) {
      var elToFade = currentSvgEl;
      setTimeout(function () {
        elToFade.style.transition = "opacity 0.7s ease";
        elToFade.style.opacity = "0";
        setTimeout(function () { try { elToFade.remove(); } catch (_e) {} }, 750);
      }, 3600);
    }
    currentSvgEl = null;
  }, true);

  // Instant Keyboard Shortcuts inside Chrome!
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { setTool("cursor"); return; }
    if (!e.altKey) return;
    var k = (e.key || "").toLowerCase();
    if (k === "s") { e.preventDefault(); setTool("spotlight"); }
    else if (k === "d") { e.preventDefault(); setTool("box"); }
    else if (k === "a") { e.preventDefault(); setTool("arrow"); }
    else if (k === "p") { e.preventDefault(); setTool("pen"); }
    else if (k === "b" && e.shiftKey) { e.preventDefault(); unblurAll(); }
    else if (k === "b") { e.preventDefault(); setTool("blur"); }
    else if (k === "l") { e.preventDefault(); setTool("laser"); }
    else if (k === "1") { e.preventDefault(); setTool("step"); }
    else if (k === "c") { e.preventDefault(); clearAllAnnotations(); }
  }, true);

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.tool) setTool(msg.tool);
  });
})();
