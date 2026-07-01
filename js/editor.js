/* editor.js — the interactive canvas: rendering, tools, hit-testing, pan/zoom. */
(function (FP) {
  'use strict';
  const G = FP.geom;
  const st = FP.state;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const DEFAULTS = {
    doorWidth: 80, windowWidth: 100, wallThickness: 12,
    fanR: 26, sensorSize: 16,
  };

  let stage, viewport, bgG, gridG, floorG, overlayG;
  let drag = null;          // active drag state
  let panning = null;       // active pan state
  let create = null;        // in-progress door/window drag-to-create
  let measure = null;       // in-progress scale-calibration line
  let lastMeasure = null;   // captured line awaiting a real-length entry
  let spaceDown = false;
  let hoverWorld = null;    // last cursor position (world)
  let snapMark = null;      // last snap point for indicator

  const Ed = {};

  Ed.init = function (stageEl) {
    stage = stageEl;
    viewport = document.getElementById('viewport');
    bgG = document.getElementById('background');
    gridG = document.getElementById('grid');
    floorG = document.getElementById('floorplan');
    overlayG = document.getElementById('overlay');

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dblclick', onDblClick);
    stage.addEventListener('contextmenu', (e) => { if (st.draft) e.preventDefault(); });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

    resize();
    window.addEventListener('resize', resize);
    Ed.ready = true;
    Ed.render();
  };

  function resize() {
    const r = stage.getBoundingClientRect();
    stage.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    renderGrid();
  }

  // ---- coordinate transforms ----------------------------------------------
  function screenToWorld(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    return { x: (sx - st.view.tx) / st.view.zoom, y: (sy - st.view.ty) / st.view.zoom };
  }
  function tolWorld(px) { return px / st.view.zoom; }

  // ---- snapping ------------------------------------------------------------
  function snapWorld(p, opts) {
    opts = opts || {};
    let best = null, bestDist = tolWorld(12);
    if (!opts.noVertex) {
      const consider = (q) => {
        const d = G.dist(p, q);
        if (d < bestDist) { best = { x: q.x, y: q.y }; bestDist = d; }
      };
      for (const w of FP.model.walls) for (const q of w.points) consider(q);
      for (const a of FP.model.areas) for (const q of a.points) consider(q);
    }
    if (best) { snapMark = best; return best; }
    if (st.snap) {
      const g = G.snapPoint(p, st.grid);
      snapMark = g; return g;
    }
    snapMark = null;
    return p;
  }

  // nearest wall point + angle, for placing doors / windows
  function nearestWall(p, maxPx) {
    const max = tolWorld(maxPx || 40);
    let best = null;
    for (const w of FP.model.walls) {
      if (w.points.length < 2) continue;
      const r = G.closestOnPolyline(p, w.points, w.closed);
      if (r && r.dist < max && (!best || r.dist < best.dist)) {
        best = { point: r.point, angle: r.angle, dist: r.dist, thickness: w.thickness || DEFAULTS.wallThickness };
      }
    }
    return best;
  }

  // ---- hit testing ---------------------------------------------------------
  function hitTest(p) {
    const tol = tolWorld(8);
    // fans
    for (let i = FP.model.fans.length - 1; i >= 0; i--) {
      const f = FP.model.fans[i];
      if (G.dist(p, f) <= f.r * 1.2 + tol) return { type: 'fans', id: f.id };
    }
    // device icons
    for (let i = FP.model.icons.length - 1; i >= 0; i--) {
      const ic = FP.model.icons[i];
      if (Math.abs(p.x - ic.x) <= ic.w / 2 + tol && Math.abs(p.y - ic.y) <= ic.h / 2 + tol)
        return { type: 'icons', id: ic.id };
    }
    // sensors
    for (let i = FP.model.sensors.length - 1; i >= 0; i--) {
      const s = FP.model.sensors[i];
      if (Math.abs(p.x - s.x) < 30 + tol && Math.abs(p.y - s.y) < (s.size || 16) + tol)
        return { type: 'sensors', id: s.id };
    }
    // doors / windows (rotated bbox)
    for (const type of ['doors', 'windows']) {
      const arr = FP.model[type];
      for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i];
        const local = G.rotate(p, -(o.angle || 0), { x: o.x, y: o.y });
        const halfT = (o.wallThickness || DEFAULTS.wallThickness) / 2 + tol;
        const extra = type === 'doors' ? o.width : halfT; // door swing area
        if (Math.abs(local.x - o.x) < o.width / 2 + tol &&
            local.y - o.y > -extra - tol && local.y - o.y < halfT + tol)
          return { type, id: o.id };
      }
    }
    // walls
    for (let i = FP.model.walls.length - 1; i >= 0; i--) {
      const w = FP.model.walls[i];
      if (w.points.length < 2) continue;
      const r = G.closestOnPolyline(p, w.points, w.closed);
      if (r && r.dist <= (w.thickness || DEFAULTS.wallThickness) / 2 + tol)
        return { type: 'walls', id: w.id };
    }
    // areas
    for (let i = FP.model.areas.length - 1; i >= 0; i--) {
      const a = FP.model.areas[i];
      if (a.points.length >= 3 && G.pointInPolygon(p, a.points))
        return { type: 'areas', id: a.id };
    }
    // background image (lowest priority; ignored while locked so you can draw over it)
    const bg = FP.model.background;
    if (bg && !bg.locked && p.x >= bg.x && p.x <= bg.x + bg.width &&
        p.y >= bg.y && p.y <= bg.y + bg.height)
      return { type: 'background' };
    return null;
  }

  // editing handles for the currently selected object
  function handlesFor(sel, o) {
    const hs = [];
    if (!sel || !o) return hs;
    if (sel.type === 'walls' || sel.type === 'areas') {
      o.points.forEach((q, i) => hs.push({ kind: 'vertex', index: i, x: q.x, y: q.y }));
    } else if (sel.type === 'doors' || sel.type === 'windows') {
      const dir = { x: Math.cos(o.angle || 0), y: Math.sin(o.angle || 0) };
      const e1 = G.add(o, G.mul(dir, -o.width / 2));
      const e2 = G.add(o, G.mul(dir, o.width / 2));
      hs.push({ kind: 'resize', end: 'e1', x: e1.x, y: e1.y });
      hs.push({ kind: 'resize', end: 'e2', x: e2.x, y: e2.y });
      if (sel.type === 'doors') {
        const n = { x: -dir.y, y: dir.x };
        const halfT = (o.wallThickness || DEFAULTS.wallThickness) / 2;
        const side = (o.swing === 'out' ? 1 : -1);       // opposite the swing arc
        const base = G.add(o, G.mul(n, side * (halfT + 22)));
        hs.push({ kind: 'flipSwing', x: base.x - dir.x * 14, y: base.y - dir.y * 14 });
        hs.push({ kind: 'flipHinge', x: base.x + dir.x * 14, y: base.y + dir.y * 14 });
      }
    }
    return hs;
  }

  function hitHandle(p) {
    const sel = st.selection;
    if (!sel) return null;
    const o = FP.find(sel);
    if (!o) return null;
    const tol = tolWorld(10);
    for (const h of handlesFor(sel, o)) {
      if (G.dist(p, h) <= tol) { h.obj = o; h.sel = sel; return h; }
    }
    return null;
  }

  // ---- pointer handlers ----------------------------------------------------
  function onPointerDown(e) {
    if (e.button === 1 || spaceDown) {          // pan
      panning = { x: e.clientX, y: e.clientY, tx: st.view.tx, ty: st.view.ty };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = screenToWorld(e.clientX, e.clientY);

    if (st.preview) return previewClick(p);

    switch (st.tool) {
      case 'select': return startSelect(p, e);
      case 'wall':   return draftAddPoint(p, 'wall');
      case 'area':   return draftAddPoint(p, 'area');
      case 'door':   return startOpening(p, 'doors', e);
      case 'window': return startOpening(p, 'windows', e);
      case 'sensor': return placeSensor(p);
      case 'fan':    return placeFan(p);
      case 'icon':   return armIcon(p);
      case 'scale':  return startMeasure(p, e);
      case 'delete': return deleteAt(p);
    }
  }

  function onPointerMove(e) {
    if (panning) {
      st.view.tx = panning.tx + (e.clientX - panning.x);
      st.view.ty = panning.ty + (e.clientY - panning.y);
      applyView(); renderGrid(); return;
    }
    const p = screenToWorld(e.clientX, e.clientY);
    hoverWorld = p;

    if (measure) { measure.b = p; Ed.render(); return; }
    if (create) { updateCreate(p); return; }
    if (drag) { doDrag(p); return; }

    if (st.tool === 'wall' || st.tool === 'area') { renderOverlay(p); return; }
    if ((st.tool === 'door' || st.tool === 'window')) { snapWorld(p); renderOverlay(p); return; }
    if (st.tool === 'sensor' || st.tool === 'fan') { snapWorld(p); renderOverlay(p); return; }
  }

  function onPointerUp(e) {
    if (panning) { panning = null; return; }
    if (measure) { finishMeasure(); return; }
    if (create) { finishCreate(); return; }
    if (drag) {
      if (drag.moved) FP.commitChange();
      else FP.onChange && FP.onChange();  // simple click-select refresh
      drag = null;
    }
  }

  // ---- select / move -------------------------------------------------------
  function startSelect(p, e) {
    const h = hitHandle(p);
    if (h) {
      if (h.kind === 'vertex') {
        FP.beginChange();
        drag = { kind: 'vertex', obj: h.obj, index: h.index, moved: false };
        return;
      }
      if (h.kind === 'resize') {
        const o = h.obj;
        const dir = { x: Math.cos(o.angle || 0), y: Math.sin(o.angle || 0) };
        const e1 = G.add(o, G.mul(dir, -o.width / 2));
        const e2 = G.add(o, G.mul(dir, o.width / 2));
        FP.beginChange();
        drag = { kind: 'resize', obj: o, sel: h.sel, dir,
                 fixed: h.end === 'e2' ? e1 : e2, sign: h.end === 'e2' ? 1 : -1, moved: false };
        return;
      }
      if (h.kind === 'flipSwing') { FP.beginChange(); h.obj.swing = h.obj.swing === 'out' ? 'in' : 'out'; FP.commitChange(); return; }
      if (h.kind === 'flipHinge') { FP.beginChange(); h.obj.hinge = h.obj.hinge === 'right' ? 'left' : 'right'; FP.commitChange(); return; }
    }
    const hit = hitTest(p);
    st.selection = hit;
    if (hit) {
      FP.beginChange();
      // point objects (sensor/fan/icon) snap their anchor to the grid while moving
      const o = FP.find(hit);
      const snappable = hit.type === 'sensors' || hit.type === 'fans' || hit.type === 'icons';
      const grabOffset = (snappable && o && typeof o.x === 'number')
        ? { x: o.x - p.x, y: o.y - p.y } : null;
      drag = { kind: 'move', sel: hit, last: p, grabOffset, moved: false };
    }
    FP.onChange && FP.onChange();
  }

  function doDrag(p) {
    if (drag.kind === 'vertex') {
      const snapped = snapWorld(p, { noVertex: true });
      drag.obj.points[drag.index] = { x: snapped.x, y: snapped.y };
      drag.moved = true;
      Ed.render();
    } else if (drag.kind === 'resize') {
      // slide the grabbed end along the wall axis — length only, thickness untouched
      let t = G.dot(G.sub(p, drag.fixed), drag.dir) * drag.sign;
      if (st.snap) t = G.snap(t, st.grid);
      t = Math.max(t, 20);
      const movingEnd = G.add(drag.fixed, G.mul(drag.dir, drag.sign * t));
      const center = G.mul(G.add(drag.fixed, movingEnd), 0.5);
      drag.obj.x = center.x; drag.obj.y = center.y; drag.obj.width = t;
      snapMark = null;
      drag.moved = true;
      Ed.render();
    } else if (drag.kind === 'move') {
      if (drag.grabOffset) {
        // snap the point object's anchor to the grid
        let np = { x: p.x + drag.grabOffset.x, y: p.y + drag.grabOffset.y };
        if (st.snap) { np = G.snapPoint(np, st.grid); snapMark = np; } else { snapMark = null; }
        const o = FP.find(drag.sel);
        if (o) { o.x = np.x; o.y = np.y; }
      } else {
        const d = G.sub(p, drag.last);
        moveSelection(drag.sel, d);
        drag.last = p;
      }
      drag.moved = true;
      Ed.render();
    }
  }

  function moveSelection(sel, d) {
    const o = FP.find(sel);
    if (!o) return;
    if (sel.type === 'walls' || sel.type === 'areas') {
      o.points = o.points.map((q) => ({ x: q.x + d.x, y: q.y + d.y }));
      if (o.labelPos) o.labelPos = { x: o.labelPos.x + d.x, y: o.labelPos.y + d.y };
    } else {
      o.x += d.x; o.y += d.y;
    }
  }

  // ---- draft (wall / area) -------------------------------------------------
  function draftAddPoint(p, kind) {
    const snapped = snapWorld(p);
    if (!st.draft || st.draft.kind !== kind) {
      st.draft = { kind, points: [snapped] };
    } else {
      const first = st.draft.points[0];
      if (st.draft.points.length >= 2 && G.dist(snapped, first) <= tolWorld(10)) {
        finishDraft(true);
        return;
      }
      st.draft.points.push(snapped);
    }
    renderOverlay(p);
  }

  function finishDraft(closeToStart) {
    const d = st.draft;
    if (!d) return;
    if (d.kind === 'wall' && d.points.length >= 2) {
      FP.beginChange();
      FP.model.walls.push({
        id: FP.newId(), points: d.points.slice(),
        thickness: DEFAULTS.wallThickness, closed: !!closeToStart,
      });
      FP.commitChange();
    } else if (d.kind === 'area' && d.points.length >= 3) {
      FP.beginChange();
      const n = FP.model.areas.length + 1;
      const name = 'Room ' + n;
      const fill = FP.STYLE.areaPalette[(n - 1) % FP.STYLE.areaPalette.length];
      const area = {
        id: FP.newId(), slug: G.slug(name), name, points: d.points.slice(),
        fill, light: '',
      };
      FP.model.areas.push(area);
      st.selection = { type: 'areas', id: area.id };
      FP.commitChange();
    }
    st.draft = null;
    setTool('select');
  }

  function cancelDraft() {
    st.draft = null;
    Ed.render();
  }

  // ---- place openings / sensors / fans -------------------------------------
  // Drag along a wall to set the length; a plain click drops a default-size one.
  function startOpening(p, type, e) {
    const near = nearestWall(p, 45);
    const A = near ? near.point : snapWorld(p);
    create = {
      type, A, end: A,
      angle: near ? near.angle : 0,
      thickness: near ? near.thickness : DEFAULTS.wallThickness,
      wall: !!near, moved: false, pid: null,
    };
    if (e && stage.setPointerCapture) {
      try { stage.setPointerCapture(e.pointerId); create.pid = e.pointerId; } catch (_) {}
    }
    renderOverlay(p);
  }

  // resolve the current create-drag into {center, width, angle}
  function createGeom() {
    const dir = { x: Math.cos(create.angle), y: Math.sin(create.angle) };
    let B, width, angle = create.angle;
    if (create.wall) {
      const t = G.dot(G.sub(create.end, create.A), dir);       // slide along the wall line
      B = G.add(create.A, G.mul(dir, t));
      width = Math.abs(t);
    } else {
      B = create.end;
      width = G.dist(create.A, B);
      if (width > 1) angle = G.angle(create.A, B);             // free: follow the drag
    }
    return { A: create.A, B, center: G.mul(G.add(create.A, B), 0.5), width, angle };
  }

  function updateCreate(p) {
    if (create.wall) { create.end = p; }
    else { create.end = snapWorld(p); }
    if (G.dist(create.A, create.end) > tolWorld(4)) create.moved = true;
    Ed.render();
  }

  function finishCreate() {
    const c = create;
    create = null;
    if (c.pid != null) { try { stage.releasePointerCapture(c.pid); } catch (_) {} }

    let center, width, angle = c.angle;
    const g = (function () { create = c; const r = createGeom(); create = null; return r; })();
    if (!c.moved || g.width < 15) {
      // treated as a click → default size, centred on the start point
      width = c.type === 'doors' ? DEFAULTS.doorWidth : DEFAULTS.windowWidth;
      center = c.A;
    } else {
      width = st.snap ? Math.max(20, G.snap(g.width, st.grid)) : g.width;
      angle = g.angle;
      // re-centre so the snapped width stays anchored at the drag start (A)
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const s = G.dot(G.sub(g.B, c.A), dir) < 0 ? -1 : 1;
      center = G.add(c.A, G.mul(dir, s * width / 2));
    }

    FP.beginChange();
    const o = { id: FP.newId(), x: center.x, y: center.y, angle, width, wallThickness: c.thickness };
    if (c.type === 'doors') { o.hinge = 'left'; o.swing = 'in'; }
    FP.model[c.type].push(o);
    st.selection = { type: c.type, id: o.id };
    FP.commitChange();
  }

  // ---- preview mode (simulate Home Assistant) ------------------------------
  Ed.setPreview = function (on) {
    st.preview = on;
    if (on) { st.selection = null; st.draft = null; create = null; measure = null; lastMeasure = null; }
    document.body.classList.toggle('preview', on);
    if (FP.onPreviewChange) FP.onPreviewChange(on);
    Ed.render();
  };

  function previewClick(p) {
    // fans first (toggle spinning), then rooms (toggle light)
    for (let i = FP.model.fans.length - 1; i >= 0; i--) {
      const f = FP.model.fans[i];
      if (G.dist(p, f) <= f.r * 1.3) { st.previewFans[f.id] = !st.previewFans[f.id]; Ed.render(); return; }
    }
    for (let i = FP.model.icons.length - 1; i >= 0; i--) {
      const ic = FP.model.icons[i];
      if (Math.abs(p.x - ic.x) <= ic.w / 2 && Math.abs(p.y - ic.y) <= ic.h / 2) {
        st.previewIcons[ic.id] = !st.previewIcons[ic.id]; Ed.render(); return;
      }
    }
    for (let i = FP.model.areas.length - 1; i >= 0; i--) {
      const a = FP.model.areas[i];
      if (a.points.length >= 3 && G.pointInPolygon(p, a.points)) {
        st.previewLights[a.id] = !st.previewLights[a.id]; Ed.render(); return;
      }
    }
  }

  function applyPreview() {
    for (const a of FP.model.areas) {
      const el = floorG.querySelector('[id="area.' + a.slug + '"]');
      if (!el) continue;
      const on = !!st.previewLights[a.id];   // grey when off, yellow when on — like HA
      el.style.transition = 'fill .3s ease, opacity .3s ease';
      el.setAttribute('fill', on ? FP.STYLE.lightOn : FP.STYLE.lightOff);
      el.setAttribute('fill-opacity', on ? '0.65' : '0.5');
    }
    for (const f of FP.model.fans) {
      if (!st.previewFans[f.id]) continue;
      const el = floorG.querySelector('[id="' + FP.sym.fanElementId(f) + '"]');
      if (el) el.classList.add('spinning');
    }
    for (const ic of FP.model.icons) {
      if (!ic.stateColor || !(ic.entity && ic.entity.trim()) || FP.sym.isMomentary(ic)) continue;
      const el = floorG.querySelector('[id="' + FP.sym.iconElementId(ic) + '"]');
      if (!el) continue;
      el.classList.remove('device-on', 'device-off');
      el.classList.add(st.previewIcons[ic.id] ? 'device-on' : 'device-off');
    }
  }

  // ---- scale calibration ---------------------------------------------------
  function startMeasure(p, e) {
    measure = { a: p, b: p, pid: null };
    if (e && stage.setPointerCapture) {
      try { stage.setPointerCapture(e.pointerId); measure.pid = e.pointerId; } catch (_) {}
    }
    renderOverlay(p);
  }

  function finishMeasure() {
    const m = measure;
    measure = null;
    if (m.pid != null) { try { stage.releasePointerCapture(m.pid); } catch (_) {} }
    const len = G.dist(m.a, m.b);
    if (len < tolWorld(6)) { Ed.render(); return; }   // too short — ignore
    lastMeasure = { a: m.a, b: m.b, worldLen: len };
    Ed.render();
    if (FP.onScaleMeasured) FP.onScaleMeasured(len / FP.SCALE);   // hand current metres to the dialog
  }

  Ed.applyScale = function (realMeters) {
    if (!lastMeasure || !(realMeters > 0)) { Ed.cancelScale(); return; }
    const f = (realMeters * FP.SCALE) / lastMeasure.worldLen;
    const pivot = lastMeasure.a;
    FP.beginChange();
    FP.scaleModel(f, pivot);
    FP.commitChange();
    lastMeasure = null;
    setTool('select');
    Ed.zoomFit();
  };

  Ed.cancelScale = function () {
    lastMeasure = null;
    measure = null;
    Ed.render();
  };

  // ---- background image -----------------------------------------------------
  Ed.setBackground = function (href, naturalW, naturalH) {
    const r = stage.getBoundingClientRect();
    const center = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    FP.beginChange();
    FP.model.background = {
      href, naturalW, naturalH,
      width: naturalW, height: naturalH,
      x: center.x - naturalW / 2, y: center.y - naturalH / 2,
      opacity: 0.6, locked: false,
    };
    st.selection = { type: 'background' };
    FP.commitChange();
    Ed.zoomFit();
  };

  function placeSensor(p) {
    const pos = snapWorld(p);
    FP.beginChange();
    const n = FP.model.sensors.length + 1;
    const slug = 'sensor_' + n;
    const s = { id: FP.newId(), slug, entity: '', x: pos.x, y: pos.y,
                text: '20.0°', size: Math.round(FP.fontSize(FP.model)) };
    FP.model.sensors.push(s);
    st.selection = { type: 'sensors', id: s.id };
    FP.commitChange();
  }

  // ---- device icons --------------------------------------------------------
  let pendingIconPoint = null;
  function armIcon(p) {
    pendingIconPoint = snapWorld(p);
    if (FP.onIconPlace) FP.onIconPlace();   // main opens the file picker
  }

  function iconPoint() {
    let p = pendingIconPoint;
    if (!p) {
      const r = stage.getBoundingClientRect();
      p = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    }
    pendingIconPoint = null;
    return p;
  }

  Ed.addIcon = function (href, natW, natH) {
    const p = iconPoint();
    const s = 64 / Math.max(natW || 64, natH || 64);   // fit the longest side to ~64px
    const w = Math.round((natW || 64) * s), h = Math.round((natH || 64) * s);
    FP.beginChange();
    const n = FP.model.icons.length + 1;
    const ic = { id: FP.newId(), slug: 'device_' + n, entity: '', x: p.x, y: p.y,
                 w, h, href, tap: 'more-info', stateColor: true };
    FP.model.icons.push(ic);
    st.selection = { type: 'icons', id: ic.id };
    FP.commitChange();
    setTool('select');
  };

  Ed.addMdiIcon = function (name, pathData) {
    const p = iconPoint();
    FP.beginChange();
    const n = FP.model.icons.length + 1;
    const ic = { id: FP.newId(), slug: 'device_' + n, entity: '', x: p.x, y: p.y,
                 w: 60, h: 60, mdi: name, pathData, color: FP.STYLE.iconOn,
                 colorOff: FP.STYLE.iconOff, tap: 'more-info', stateColor: true };
    FP.model.icons.push(ic);
    st.selection = { type: 'icons', id: ic.id };
    FP.commitChange();
    setTool('select');
  };

  function placeFan(p) {
    const pos = snapWorld(p);
    FP.beginChange();
    const n = FP.model.fans.length + 1;
    const slug = 'fan_' + n;
    const f = { id: FP.newId(), slug, entity: '', x: pos.x, y: pos.y, r: DEFAULTS.fanR };
    FP.model.fans.push(f);
    st.selection = { type: 'fans', id: f.id };
    FP.commitChange();
  }

  function deleteAt(p) {
    const hit = hitTest(p);
    if (hit) { FP.beginChange(); FP.remove(hit); FP.commitChange(); }
  }

  // ---- keyboard ------------------------------------------------------------
  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') { spaceDown = true; return; }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) FP.redo(); else FP.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); FP.redo(); return; }

    switch (e.key) {
      case 'Escape':
        if (measure || lastMeasure) { Ed.cancelScale(); if (FP.onScaleCancel) FP.onScaleCancel(); }
        else if (create) { create = null; Ed.render(); }
        else if (st.draft) cancelDraft();
        else { st.selection = null; FP.onChange(); }
        break;
      case 'Enter': if (st.draft) finishDraft(false); break;
      case 'Delete': case 'Backspace':
        if (st.selection) { e.preventDefault(); FP.beginChange(); FP.remove(st.selection); FP.commitChange(); }
        break;
      case 'v': case 'V': setTool('select'); break;
      case 'w': case 'W': setTool('wall'); break;
      case 'r': case 'R': setTool('area'); break;
      case 'd': case 'D': setTool('door'); break;
      case 'n': case 'N': setTool('window'); break;
      case 't': case 'T': setTool('sensor'); break;
      case 'f': case 'F': setTool('fan'); break;
      case 's': case 'S': setTool('scale'); break;
    }
  }

  function setTool(tool) {
    if (st.preview) Ed.setPreview(false);
    st.tool = tool;
    create = null;
    if (tool !== 'scale') { measure = null; lastMeasure = null; }
    if (tool !== 'wall' && tool !== 'area') st.draft = null;
    if (FP.onToolChange) FP.onToolChange(tool);
    Ed.render();
  }
  Ed.setTool = setTool;

  // ---- zoom ----------------------------------------------------------------
  function onWheel(e) {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const world = { x: (sx - st.view.tx) / st.view.zoom, y: (sy - st.view.ty) / st.view.zoom };
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const z = Math.max(0.15, Math.min(6, st.view.zoom * factor));
    st.view.zoom = z;
    st.view.tx = sx - world.x * z;
    st.view.ty = sy - world.y * z;
    applyView(); renderGrid();
  }

  Ed.zoomBy = function (factor) {
    const r = stage.getBoundingClientRect();
    const sx = r.width / 2, sy = r.height / 2;
    const world = { x: (sx - st.view.tx) / st.view.zoom, y: (sy - st.view.ty) / st.view.zoom };
    const z = Math.max(0.15, Math.min(6, st.view.zoom * factor));
    st.view.zoom = z;
    st.view.tx = sx - world.x * z; st.view.ty = sy - world.y * z;
    applyView(); renderGrid();
  };

  function fitBounds() {
    const m = FP.model;
    const hasGeom = m.walls.length || m.areas.length || m.doors.length ||
                    m.windows.length || m.sensors.length || m.fans.length;
    const bg = m.background;
    let b = hasGeom ? FP.contentBounds(m) : null;
    if (bg) {
      const bb = { minX: bg.x, minY: bg.y, maxX: bg.x + bg.width, maxY: bg.y + bg.height };
      b = b ? { minX: Math.min(b.minX, bb.minX), minY: Math.min(b.minY, bb.minY),
                maxX: Math.max(b.maxX, bb.maxX), maxY: Math.max(b.maxY, bb.maxY) } : bb;
    }
    if (!b) b = FP.contentBounds(m);
    b.w = b.maxX - b.minX; b.h = b.maxY - b.minY;
    return b;
  }

  Ed.zoomFit = function () {
    const b = fitBounds();
    const r = stage.getBoundingClientRect();
    const pad = 60;
    const zx = r.width / (b.w + pad * 2);
    const zy = r.height / (b.h + pad * 2);
    let z = Math.min(zx, zy);
    if (!isFinite(z) || z <= 0) z = 1;
    z = Math.max(0.15, Math.min(3, z));
    st.view.zoom = z;
    st.view.tx = r.width / 2 - (b.minX + b.w / 2) * z;
    st.view.ty = r.height / 2 - (b.minY + b.h / 2) * z;
    applyView(); renderGrid();
  };

  function onDblClick(e) {
    if (st.draft) { e.preventDefault(); finishDraft(false); }
  }

  // ---- rendering -----------------------------------------------------------
  function applyView() {
    viewport.setAttribute('transform',
      `translate(${st.view.tx} ${st.view.ty}) scale(${st.view.zoom})`);
  }

  function renderGrid() {
    if (!st.showGrid || st.preview) { gridG.innerHTML = ''; return; }
    const r = stage.getBoundingClientRect();
    const v = st.view;
    const wMin = -v.tx / v.zoom, wMax = (r.width - v.tx) / v.zoom;
    const hMin = -v.ty / v.zoom, hMax = (r.height - v.ty) / v.zoom;
    const step = 100; // 1 m
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const cMinor = dark ? '#282c34' : '#eceef2';
    const cMajor = dark ? '#363c47' : '#d3d8e0';
    let out = '';
    const x0 = Math.floor(wMin / step) * step, x1 = Math.ceil(wMax / step) * step;
    const y0 = Math.floor(hMin / step) * step, y1 = Math.ceil(hMax / step) * step;
    if ((x1 - x0) / step < 500) {
      for (let x = x0; x <= x1; x += step) {
        const major = Math.round(x / step) % 5 === 0;
        out += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" ` +
               `stroke="${major ? cMajor : cMinor}" stroke-width="${(major ? 1.2 : 0.7) / v.zoom}"/>`;
      }
      for (let y = y0; y <= y1; y += step) {
        const major = Math.round(y / step) % 5 === 0;
        out += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" ` +
               `stroke="${major ? cMajor : cMinor}" stroke-width="${(major ? 1.2 : 0.7) / v.zoom}"/>`;
      }
    }
    gridG.innerHTML = out;
  }

  function renderBackground() {
    const bg = FP.model.background;
    if (!bg || !bg.href) { bgG.innerHTML = ''; return; }
    const op = bg.opacity != null ? bg.opacity : 0.6;
    bgG.innerHTML =
      `<image href="${bg.href}" x="${G.round(bg.x, 2)}" y="${G.round(bg.y, 2)}" ` +
      `width="${G.round(bg.width, 2)}" height="${G.round(bg.height, 2)}" ` +
      `opacity="${op}" preserveAspectRatio="none" style="image-rendering:auto"/>`;
  }

  Ed.render = function () {
    applyView();
    renderBackground();
    floorG.innerHTML = FP.buildFloorplanInner(FP.model, { dims: st.showDims && !st.preview });
    if (st.preview) applyPreview();
    renderGrid();
    renderOverlay(hoverWorld);
  };

  function renderOverlay(cursor) {
    if (st.preview) { overlayG.innerHTML = ''; return; }
    const v = st.view;
    const s = 1 / v.zoom;
    let out = '';

    // door/window being dragged into existence
    if (create) {
      const g = createGeom();
      const prev = { x: g.center.x, y: g.center.y, angle: g.angle,
                     width: Math.max(g.width, 2), wallThickness: create.thickness };
      const frag = create.type === 'doors'
        ? FP.sym.door(Object.assign({ hinge: 'left', swing: 'in' }, prev))
        : FP.sym.window(prev);
      out += `<g opacity="0.65">${frag}</g>`;
      out += `<circle cx="${g.A.x}" cy="${g.A.y}" r="${4 * s}" fill="#03A9F4"/>`;
      out += `<circle cx="${g.B.x}" cy="${g.B.y}" r="${4 * s}" fill="#03A9F4"/>`;
      const nrm = { x: -Math.sin(g.angle), y: Math.cos(g.angle) };
      const lp = G.add(g.center, G.mul(nrm, -(create.thickness / 2 + 16)));
      out += textTag(G.fmtMeters(g.width), lp.x, lp.y, s, '#0369a1');
    }

    // scale-calibration line (in progress or captured)
    const ml = measure || lastMeasure;
    if (ml) {
      const a = ml.a, b = ml.b;
      const n = G.mul(G.perp(G.norm(G.sub(b, a) || { x: 1, y: 0 })), 7 * s);
      out += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ` +
             `stroke="#16a34a" stroke-width="${2 * s}"/>`;
      for (const q of [a, b]) {
        out += `<line x1="${q.x - n.x}" y1="${q.y - n.y}" x2="${q.x + n.x}" y2="${q.y + n.y}" ` +
               `stroke="#16a34a" stroke-width="${2 * s}"/>`;
      }
      const mid = G.mul(G.add(a, b), 0.5);
      out += textTag(G.fmtMeters(G.dist(a, b)), mid.x, mid.y - 10 * s, s, '#15803d');
    }

    // draft preview
    if (st.draft) {
      const pts = st.draft.points.slice();
      const preview = cursor ? snapWorld(cursor) : null;
      const all = preview ? pts.concat([preview]) : pts;
      const close = st.draft.kind === 'area';
      out += `<path d="${G.pathData(all, false)}" fill="none" stroke="#03A9F4" ` +
             `stroke-width="${1.5 * s}" stroke-dasharray="${6 * s} ${4 * s}"/>`;
      if (close && all.length >= 3) {
        out += `<line x1="${all[all.length - 1].x}" y1="${all[all.length - 1].y}" ` +
               `x2="${all[0].x}" y2="${all[0].y}" stroke="#03A9F4" stroke-opacity="0.4" ` +
               `stroke-width="${1.2 * s}" stroke-dasharray="${4 * s} ${4 * s}"/>`;
      }
      for (const q of pts)
        out += `<circle cx="${q.x}" cy="${q.y}" r="${4 * s}" fill="#03A9F4"/>`;
      // live length of the segment being drawn
      if (preview && pts.length) {
        const a = pts[pts.length - 1];
        const mid = G.mul(G.add(a, preview), 0.5);
        out += textTag(G.fmtMeters(G.dist(a, preview)), mid.x, mid.y - 8 * s, s, '#0369a1');
      }
    }

    // selection highlight + handles
    const sel = st.selection;
    if (sel) {
      const o = FP.find(sel);
      if (o) {
        if (sel.type === 'background') {
          out += `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="none" ` +
                 `stroke="#f97316" stroke-width="${1.5 * s}" stroke-dasharray="${7 * s} ${4 * s}"/>`;
        } else if (sel.type === 'walls' || sel.type === 'areas') {
          out += `<path d="${G.pathData(o.points, sel.type === 'areas')}" fill="none" ` +
                 `stroke="#f97316" stroke-width="${2 * s}"/>`;
          for (const q of o.points)
            out += `<rect x="${q.x - 4 * s}" y="${q.y - 4 * s}" width="${8 * s}" height="${8 * s}" ` +
                   `fill="#fff" stroke="#f97316" stroke-width="${1.5 * s}"/>`;
          // per-segment lengths
          for (let i = 0; i < o.points.length - (sel.type === 'areas' ? 0 : 1); i++) {
            const a = o.points[i], b = o.points[(i + 1) % o.points.length];
            const mid = G.mul(G.add(a, b), 0.5);
            out += textTag(G.fmtMeters(G.dist(a, b)), mid.x, mid.y, s, '#c2410c');
          }
        } else if (sel.type === 'doors' || sel.type === 'windows') {
          const dir = { x: Math.cos(o.angle || 0), y: Math.sin(o.angle || 0) };
          const e1 = G.add(o, G.mul(dir, -o.width / 2));
          const e2 = G.add(o, G.mul(dir, o.width / 2));
          out += `<line x1="${e1.x}" y1="${e1.y}" x2="${e2.x}" y2="${e2.y}" ` +
                 `stroke="#f97316" stroke-width="${1.5 * s}"/>`;
          for (const h of handlesFor(sel, o)) {
            if (h.kind === 'resize')
              out += `<circle cx="${h.x}" cy="${h.y}" r="${5 * s}" fill="#fff" ` +
                     `stroke="#f97316" stroke-width="${1.6 * s}"/>`;
            else if (h.kind === 'flipSwing' || h.kind === 'flipHinge')
              out += flipHandle(h, s, h.kind === 'flipSwing' ? '⇅' : '⇄');
          }
          // keep the length label clear of the flip handles (put it on the arc side)
          const nrm = { x: -dir.y, y: dir.x };
          const halfT2 = (o.wallThickness || 12) / 2;
          const sideSign = sel.type === 'doors' ? (o.swing === 'out' ? -1 : 1) : -1;
          const lpOff = sel.type === 'doors' ? halfT2 + 40 : halfT2 + 16;
          const lp = G.add(o, G.mul(nrm, sideSign * lpOff));
          out += textTag(G.fmtMeters(o.width), lp.x, lp.y, s, '#c2410c');
        } else {
          const b = selBounds(sel, o);
          out += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" ` +
                 `stroke="#f97316" stroke-width="${1.5 * s}" stroke-dasharray="${5 * s} ${3 * s}"/>`;
        }
      }
    }

    // snap indicator
    if (snapMark && (st.tool !== 'select' || drag)) {
      out += `<circle cx="${snapMark.x}" cy="${snapMark.y}" r="${5 * s}" fill="none" ` +
             `stroke="#16a34a" stroke-width="${1.5 * s}"/>`;
    }

    overlayG.innerHTML = out;
  }

  function selBounds(sel, o) {
    if (sel.type === 'icons') return { x: o.x - o.w / 2, y: o.y - o.h / 2, w: o.w, h: o.h };
    if (sel.type === 'fans') return { x: o.x - o.r * 1.2, y: o.y - o.r * 1.2, w: o.r * 2.4, h: o.r * 2.4 };
    if (sel.type === 'sensors') return { x: o.x - 30, y: o.y - (o.size || 16), w: 60, h: (o.size || 16) * 2 };
    const halfT = (o.wallThickness || DEFAULTS.wallThickness) / 2 + 4;
    return { x: o.x - o.width / 2 - 4, y: o.y - o.width, w: o.width + 8, h: o.width + halfT };
  }

  function flipHandle(h, s, glyph) {
    return `<circle cx="${h.x}" cy="${h.y}" r="${9 * s}" fill="#fff" stroke="#f97316" ` +
      `stroke-width="${1.6 * s}"/>` +
      `<text x="${h.x}" y="${h.y}" text-anchor="middle" dominant-baseline="central" ` +
      `font-size="${12 * s}" fill="#f97316" style="pointer-events:none">${glyph}</text>`;
  }

  function textTag(txt, x, y, s, color) {
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${11 * s}" ` +
           `font-family="Helvetica, Arial, sans-serif" fill="${color}" ` +
           `paint-order="stroke" stroke="#fff" stroke-width="${3 * s}">${FP.sym.esc(txt)}</text>`;
  }

  FP.editor = Ed;
})(window.FP = window.FP || {});
