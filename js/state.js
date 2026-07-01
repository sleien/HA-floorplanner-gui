/* state.js — the document model, selection/view state, undo & persistence. */
(function (FP) {
  'use strict';
  const G = FP.geom;
  const STORE_KEY = 'floorplanner_ha_v1';
  const PREFS_KEY = 'floorplanner_ha_prefs_v1';

  function blankModel() {
    return {
      meta: { title: 'My Home', path: '', fontSize: 15 },  // path = base name; fontSize = base text size (px)
      uid: 1,
      background: null,  // {href, x, y, width, height, naturalW, naturalH, opacity, locked} — trace aid, not exported
      walls: [],     // {id, points:[{x,y}], thickness, closed}
      areas: [],     // {id, slug, name, points:[{x,y}], fill, light, labelPos?}
      doors: [],     // {id, x, y, angle, width, wallThickness, hinge, swing}
      windows: [],   // {id, x, y, angle, width, wallThickness}
      sensors: [],   // {id, slug, entity, x, y, text, size}
      fans: [],      // {id, slug, entity, x, y, r}
      icons: [],     // {id, slug, entity, x, y, w, h, href, tap, stateColor}
    };
  }

  FP.model = blankModel();

  FP.state = {
    tool: 'select',
    selection: null,          // {type, id}
    draft: null,              // in-progress geometry (wall/area point list)
    view: { tx: 60, ty: 60, zoom: 1 },
    grid: 10,                 // world px (0.1 m)
    snap: true,
    showGrid: true,
    showDims: true,
    preview: false,           // simulate the Home Assistant interactions
    previewLights: {},        // areaId -> on/off (transient, not exported)
    previewFans: {},          // fanId  -> spinning
    previewIcons: {},         // iconId -> on/off
  };

  // collections keyed by element type
  const COLLECTIONS = ['walls', 'areas', 'doors', 'windows', 'sensors', 'fans', 'icons'];
  FP.COLLECTIONS = COLLECTIONS;

  FP.newId = () => 'e' + FP.model.uid++;

  FP.eachEntity = function (fn) {
    for (const type of ['areas', 'sensors', 'fans', 'icons']) {
      for (const o of FP.model[type]) fn(type, o);
    }
  };

  // editor UI preferences persist independently of the document
  FP.savePrefs = function () {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        showGrid: FP.state.showGrid, snap: FP.state.snap, showDims: FP.state.showDims,
      }));
    } catch (e) { /* ignore */ }
  };
  FP.loadPrefs = function () {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (typeof p.showGrid === 'boolean') FP.state.showGrid = p.showGrid;
      if (typeof p.snap === 'boolean') FP.state.snap = p.snap;
      if (typeof p.showDims === 'boolean') FP.state.showDims = p.showDims;
    } catch (e) { /* ignore */ }
  };

  FP.find = function (sel) {
    if (!sel) return null;
    if (sel.type === 'background') return FP.model.background;
    const arr = FP.model[sel.type];
    if (!arr) return null;
    return arr.find((o) => o.id === sel.id) || null;
  };

  FP.remove = function (sel) {
    if (!sel) return;
    if (sel.type === 'background') {
      FP.model.background = null;
      if (FP.state.selection && FP.state.selection.type === 'background') FP.state.selection = null;
      return;
    }
    const arr = FP.model[sel.type];
    if (!arr) return;
    const i = arr.findIndex((o) => o.id === sel.id);
    if (i >= 0) arr.splice(i, 1);
    if (FP.state.selection && FP.state.selection.id === sel.id) FP.state.selection = null;
  };

  // Uniformly scale the whole scene (drawing + background) about a pivot so a
  // measured length maps to a chosen real length. FP.SCALE stays fixed at 100px/m.
  FP.scaleModel = function (f, pivot) {
    const m = FP.model;
    const sp = (q) => ({ x: pivot.x + (q.x - pivot.x) * f, y: pivot.y + (q.y - pivot.y) * f });
    for (const w of m.walls) {
      w.points = w.points.map(sp);
      if (w.thickness) w.thickness *= f;
    }
    for (const a of m.areas) {
      a.points = a.points.map(sp);
      if (a.labelPos) a.labelPos = sp(a.labelPos);
    }
    for (const o of m.doors.concat(m.windows)) {
      const c = sp(o); o.x = c.x; o.y = c.y;
      o.width *= f;
      if (o.wallThickness) o.wallThickness *= f;
    }
    for (const s of m.sensors) {
      const c = sp(s); s.x = c.x; s.y = c.y;
      if (s.size) s.size *= f;
    }
    for (const fn of m.fans) {
      const c = sp(fn); fn.x = c.x; fn.y = c.y;
      fn.r *= f;
    }
    if (m.background) {
      const tl = sp({ x: m.background.x, y: m.background.y });
      m.background.x = tl.x; m.background.y = tl.y;
      m.background.width *= f; m.background.height *= f;
    }
  };

  // ---- undo / redo ----------------------------------------------------------
  const undoStack = [];
  const redoStack = [];
  let lastSnapshot = null;

  FP.snapshot = () => JSON.stringify(FP.model);

  FP.pushUndo = function () {
    const snap = lastSnapshot != null ? lastSnapshot : FP.snapshot();
    undoStack.push(snap);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    lastSnapshot = null;
  };

  // call before a mutation to capture the pre-state lazily
  FP.beginChange = function () {
    lastSnapshot = FP.snapshot();
  };
  FP.commitChange = function () {
    if (lastSnapshot != null) {
      undoStack.push(lastSnapshot);
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      lastSnapshot = null;
    }
    FP.persist();
    if (FP.onChange) FP.onChange();
  };

  FP.undo = function () {
    if (!undoStack.length) return;
    redoStack.push(FP.snapshot());
    FP.model = JSON.parse(undoStack.pop());
    FP.state.selection = null;
    FP.state.draft = null;
    FP.persist();
    if (FP.onChange) FP.onChange();
  };

  FP.redo = function () {
    if (!redoStack.length) return;
    undoStack.push(FP.snapshot());
    FP.model = JSON.parse(redoStack.pop());
    FP.state.selection = null;
    FP.state.draft = null;
    FP.persist();
    if (FP.onChange) FP.onChange();
  };

  // ---- persistence ----------------------------------------------------------
  FP.persist = function () {
    try {
      const m = FP.model;
      let json;
      if (m.background && m.background.href) {
        // keep the (possibly large) image out of localStorage so autosave never
        // hits the quota — it still travels in the downloadable .json project.
        const bg = Object.assign({}, m.background, { href: null });
        json = JSON.stringify(Object.assign({}, m, { background: bg }));
      } else {
        json = JSON.stringify(m);
      }
      localStorage.setItem(STORE_KEY, json);
    } catch (e) { /* ignore quota / private mode */ }
  };

  FP.load = function () {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const m = JSON.parse(raw);
        if (m && m.walls) { FP.model = normalize(m); return true; }
      }
    } catch (e) { /* ignore */ }
    return false;
  };

  FP.loadModel = function (m) {
    FP.beginChange();
    FP.model = normalize(m);
    FP.state.selection = null;
    FP.state.draft = null;
    FP.commitChange();
  };

  FP.newDocument = function () {
    FP.beginChange();
    FP.model = blankModel();
    FP.state.selection = null;
    FP.state.draft = null;
    FP.commitChange();
  };

  // make sure a loaded model has every collection + a valid uid counter
  function normalize(m) {
    const base = blankModel();
    const out = Object.assign(base, m);
    for (const c of COLLECTIONS) if (!Array.isArray(out[c])) out[c] = [];
    if (!out.meta) out.meta = { title: 'My Home' };
    if (out.meta.fontSize == null) out.meta.fontSize = 15;
    // a background without image data (stripped for autosave) is meaningless
    if (out.background && !out.background.href) out.background = null;
    let maxUid = 1;
    for (const c of COLLECTIONS) {
      for (const o of out[c]) {
        const n = parseInt(String(o.id || '').replace(/\D/g, ''), 10);
        if (!isNaN(n)) maxUid = Math.max(maxUid, n + 1);
      }
    }
    out.uid = Math.max(out.uid || 1, maxUid);
    return out;
  }

  FP.blankModel = blankModel;
})(window.FP = window.FP || {});
