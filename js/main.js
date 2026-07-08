/* main.js — wire up toolbar, inspector, HA entity panel, and exports. */
(function (FP) {
  'use strict';
  const G = FP.geom;
  const st = FP.state;
  const $ = (id) => document.getElementById(id);

  const HINTS = {
    select: 'Click to select · drag to move · drag end handles to resize doors/windows · ⇄/⇅ handles flip a door · Del removes.',
    wall: 'Click to drop wall points. Click the first point, press Enter, or double-click to finish. Esc cancels.',
    area: 'Click to outline a room. Double-click or Enter to close it. Rooms become the lighting areas. Esc cancels.',
    door: 'Drag along a wall to draw a door at that length (or click for a default one). It snaps to the wall angle. Flip/edit in the Inspector.',
    window: 'Drag along a wall to draw a window at that length (or click for a default one). It snaps to the wall angle.',
    sensor: 'Click to place a temperature readout, then set its HA sensor entity.',
    fan: 'Click to place a spinning fan, then set its HA switch entity.',
    icon: 'Click where the device goes, then pick an image (PC, TV…). Set its HA entity and tap action in the Inspector.',
    scale: 'Drag over a known distance (e.g. your plan\'s scale bar), then type its real length — the whole drawing rescales to match.',
    delete: 'Click any element to delete it.',
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    if (!FP.load()) seedExample();
    FP.loadPrefs();

    FP.onChange = () => { FP.editor.render(); refreshInspector(); refreshHA(); refreshTitle(); };
    FP.onToolChange = (tool) => {
      document.body.setAttribute('data-tool', tool);
      document.querySelectorAll('.tool').forEach((b) =>
        b.classList.toggle('active', b.dataset.tool === tool));
      if (!st.preview) $('hint').textContent = HINTS[tool] || '';
    };
    FP.onPreviewChange = onPreviewChange;

    applyTheme(FP.state.theme || currentTheme());

    FP.editor.init($('stage'));
    wireToolbar();
    wireTopbar();
    wireModal();
    wireScaleDialog();

    // reflect toggles
    $('chk-grid').checked = st.showGrid;
    $('chk-snap').checked = st.snap;
    $('chk-dims').checked = st.showDims;
    $('font-size').value = FP.fontSize(FP.model);

    FP.onToolChange('select');
    refreshTitle();
    refreshInspector();
    refreshHA();
    FP.editor.zoomFit();
  }

  // ---- toolbar -------------------------------------------------------------
  function wireToolbar() {
    document.querySelectorAll('.tool').forEach((btn) => {
      btn.addEventListener('click', () => FP.editor.setTool(btn.dataset.tool));
    });
  }

  // ---- top bar -------------------------------------------------------------
  function wireTopbar() {
    $('doc-title').addEventListener('input', (e) => {
      FP.model.meta.title = e.target.value || 'Floorplan';
      FP.persist();
    });
    $('btn-new').addEventListener('click', () => {
      if (confirm('Start a new empty floorplan? Your current one will be cleared (Save first to keep it).')) {
        FP.newDocument(); FP.editor.zoomFit();
      }
    });
    $('btn-save').addEventListener('click', saveProject);
    $('file-load').addEventListener('change', loadProject);
    $('file-image').addEventListener('change', loadImage);
    $('file-icon').addEventListener('change', loadIcon);
    FP.onIconPlace = openDeviceDialog;
    wireDeviceDialog();
    $('btn-zoom-in').addEventListener('click', () => FP.editor.zoomBy(1.2));
    $('btn-zoom-out').addEventListener('click', () => FP.editor.zoomBy(1 / 1.2));
    $('btn-zoom-fit').addEventListener('click', () => FP.editor.zoomFit());
    $('chk-grid').addEventListener('change', (e) => { st.showGrid = e.target.checked; FP.savePrefs(); FP.editor.render(); });
    $('chk-snap').addEventListener('change', (e) => { st.snap = e.target.checked; FP.savePrefs(); });
    $('chk-dims').addEventListener('change', (e) => { st.showDims = e.target.checked; FP.savePrefs(); FP.editor.render(); });
    $('font-size').addEventListener('input', (e) => {
      const n = parseInt(e.target.value, 10);
      if (!isNaN(n) && n >= 6 && n <= 60) { FP.model.meta.fontSize = n; FP.persist(); FP.editor.render(); }
    });
    $('btn-export').addEventListener('click', openExport);
    $('btn-preview').addEventListener('click', () => FP.editor.setPreview(!st.preview));
    $('btn-theme').addEventListener('click', () => {
      applyTheme(st.theme === 'dark' ? 'light' : 'dark');
      FP.savePrefs();
    });
  }

  // ---- theme ----------------------------------------------------------------
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    st.theme = theme;
    const btn = $('btn-theme');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (FP.editor && FP.editor.ready) FP.editor.render();   // refresh the JS-drawn grid
  }

  // keep the Preview button + hint in sync with the mode
  function onPreviewChange(on) {
    const btn = $('btn-preview');
    btn.classList.toggle('active', on);
    btn.textContent = on ? '■ Exit preview' : '▶ Preview';
    $('hint').textContent = on
      ? 'Preview — click a room to toggle its light, click a fan to spin it. Pick a tool or press Exit preview to keep editing.'
      : (HINTS[st.tool] || '');
  }

  function refreshTitle() {
    $('doc-title').value = FP.model.meta.title || 'My Home';
    if (document.activeElement !== $('font-size')) $('font-size').value = FP.fontSize(FP.model);
  }

  function saveProject() {
    const data = JSON.stringify(FP.model, null, 2);
    download(FP.baseName(FP.model) + '.json', data, 'application/json');
  }
  function loadProject(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { FP.loadModel(JSON.parse(reader.result)); FP.editor.zoomFit(); }
      catch (err) { alert('Could not read that file: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function loadImage(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) { loadPdf(file); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        FP.editor.setTool('select');
        FP.editor.setBackground(reader.result, img.naturalWidth || 800, img.naturalHeight || 600);
      };
      img.onerror = () => alert('Could not read that image.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // upload an icon image and either place a new device or replace one's image
  function loadIcon(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) { FP._replaceIconId = null; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        if (FP._replaceIconId) {
          const ic = FP.find({ type: 'icons', id: FP._replaceIconId });
          FP._replaceIconId = null;
          if (ic) { FP.beginChange(); ic.href = reader.result; FP.commitChange(); }
        } else {
          FP.editor.addIcon(reader.result, img.naturalWidth || 64, img.naturalHeight || 64);
        }
      };
      img.onerror = () => { FP._replaceIconId = null; alert('Could not read that image.'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---- Material Design Icons -----------------------------------------------
  const MDI_LIBRARY = 'https://pictogrammers.com/library/mdi/';
  function normalizeMdi(name) {
    return String(name || '').trim().toLowerCase()
      .replace(/^mdi:/, '').replace(/^mdi-/, '').replace(/[^a-z0-9-]/g, '');
  }
  // fetch a single icon's path data by name (from the @mdi/svg CDN, CORS-enabled)
  async function fetchMdiPath(name) {
    const n = normalizeMdi(name);
    if (!n) return null;
    const res = await fetch('https://cdn.jsdelivr.net/npm/@mdi/svg@7/svg/' + n + '.svg');
    if (!res.ok) return null;
    const txt = await res.text();
    const m = txt.match(/\sd="([^"]+)"/);
    return m ? { name: n, path: m[1] } : null;
  }

  function openDeviceDialog() {
    $('device-msg').textContent = '';
    $('device-mdi').value = '';
    $('device-modal').classList.remove('hidden');
    $('device-mdi').focus();
  }
  function closeDeviceDialog() { $('device-modal').classList.add('hidden'); }

  function wireDeviceDialog() {
    const add = async () => {
      const name = $('device-mdi').value;
      if (!name.trim()) { $('device-msg').textContent = 'Enter an icon name, or upload an image.'; return; }
      $('device-msg').textContent = 'Loading…';
      const r = await fetchMdiPath(name);
      if (!r) { $('device-msg').textContent = 'No icon named "' + normalizeMdi(name) + '". Check the library.'; return; }
      closeDeviceDialog();
      FP.editor.addMdiIcon(r.name, r.path);
    };
    $('device-add').addEventListener('click', add);
    $('device-mdi').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    $('device-upload').addEventListener('click', () => { closeDeviceDialog(); $('file-icon').click(); });
    $('device-cancel').addEventListener('click', closeDeviceDialog);
    $('device-modal').addEventListener('click', (e) => { if (e.target.id === 'device-modal') closeDeviceDialog(); });
  }

  // PDF.js is ~1.4 MB, so load it lazily the first time a PDF is opened.
  function ensurePdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (ensurePdfJs._p) return ensurePdfJs._p;
    ensurePdfJs._p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        } else reject(new Error('pdf.js loaded but pdfjsLib is missing'));
      };
      s.onerror = () => reject(new Error('could not load vendor/pdfjs/pdf.min.js'));
      document.head.appendChild(s);
    });
    return ensurePdfJs._p;
  }

  // Rasterise page 1 of the PDF to a PNG and use it as the trace background.
  async function loadPdf(file) {
    let pdfjsLib;
    try { pdfjsLib = await ensurePdfJs(); }
    catch (err) { alert('PDF support failed to load (' + err.message + ').'); return; }
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(1, 1600 / base.width));   // aim for ~1600px wide
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';                                   // PDFs are transparent
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      FP.editor.setTool('select');
      FP.editor.setBackground(canvas.toDataURL('image/png'), canvas.width, canvas.height);
    } catch (err) {
      alert('Could not render that PDF (' + err.message + ').');
    }
  }

  // ---- scale-calibration dialog --------------------------------------------
  function wireScaleDialog() {
    FP.onScaleMeasured = (currentMeters) => {
      $('scale-current').textContent = currentMeters.toFixed(2) + ' m';
      const inp = $('scale-value');
      // sensible default: round the current reading to a tidy number
      inp.value = currentMeters >= 0.75 && currentMeters < 1.5 ? 1 : +currentMeters.toFixed(2);
      $('scale-modal').classList.remove('hidden');
      inp.focus(); inp.select();
    };
    FP.onScaleCancel = () => $('scale-modal').classList.add('hidden');

    const close = () => $('scale-modal').classList.add('hidden');
    $('scale-cancel').addEventListener('click', () => { close(); FP.editor.cancelScale(); });
    $('scale-apply').addEventListener('click', applyScale);
    $('scale-value').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyScale(); });
    $('scale-modal').addEventListener('click', (e) => {
      if (e.target.id === 'scale-modal') { close(); FP.editor.cancelScale(); }
    });
  }

  function applyScale() {
    const v = parseFloat($('scale-value').value);
    $('scale-modal').classList.add('hidden');
    FP.editor.applyScale(v);
  }

  // ---- inspector -----------------------------------------------------------
  function refreshInspector() {
    const body = $('inspector-body');
    const sel = st.selection;
    const o = FP.find(sel);
    if (!o) {
      body.className = 'muted';
      body.textContent = 'Select an element to edit it, or pick a tool and start drawing.';
      return;
    }
    body.className = '';
    body.innerHTML = INSPECTORS[sel.type](o);
    wireInspector(sel, o);
  }

  const mToPx = (m) => parseFloat(m) * FP.SCALE;
  const pxToM = (px) => G.round(px / FP.SCALE, 2);

  const INSPECTORS = {
    background: (o) => `
      <p class="muted small">Trace over this image, then lock it. It is a guide only — it is <b>not</b> included in the exported SVG.</p>
      <div class="field"><label>Opacity</label>
        <input id="i-op" type="range" min="0.1" max="1" step="0.05" value="${o.opacity != null ? o.opacity : 0.6}"></div>
      <label class="toggle"><input id="i-lock" type="checkbox" ${o.locked ? 'checked' : ''}> Lock (draw over it without moving it)</label>
      <div class="field" style="margin-top:12px">
        <button id="i-scale" class="btn block">📏 Set scale from this image</button></div>
      <p class="muted small">Drag over a known length (e.g. the “1 m” scale bar) and enter its real size.</p>
      <div class="btn-row"><button id="i-del" class="btn danger block">Remove image</button></div>`,
    walls: (o) => `
      <div class="field"><label>Thickness (m)</label>
        <input id="i-th" type="number" step="0.01" min="0.02" value="${pxToM(o.thickness || FP.STYLE.wallThickness)}"></div>
      <label class="toggle"><input id="i-closed" type="checkbox" ${o.closed ? 'checked' : ''}> Closed loop</label>
      ${deleteBtn()}`,
    areas: (o) => `
      <div class="field"><label>Room name</label>
        <input id="i-name" type="text" value="${attr(o.name)}"></div>
      <div class="field"><label>SVG element id</label>
        <input type="text" value="area.${attr(o.slug)}" readonly></div>
      <div class="field"><label>Fill colour</label>
        <input id="i-fill" class="color-swatch" type="color" value="${o.fill}"></div>
      <div class="field"><label>Light entity (Home Assistant)</label>
        <input id="i-light" type="text" placeholder="light.${attr(o.slug)}" value="${attr(o.light)}"></div>
      ${deleteBtn()}`,
    doors: (o) => `
      <div class="field"><label>Width (m)</label>
        <input id="i-w" type="number" step="0.05" min="0.3" value="${pxToM(o.width)}"></div>
      <div class="field"><label>Angle (°)</label>
        <input id="i-ang" type="number" step="1" value="${Math.round(G.deg(o.angle || 0))}"></div>
      <div class="field"><label>Hinge</label>
        <span class="seg" id="i-hinge"><button data-v="left" class="${o.hinge!=='right'?'on':''}">Left</button><button data-v="right" class="${o.hinge==='right'?'on':''}">Right</button></span></div>
      <div class="field"><label>Swing</label>
        <span class="seg" id="i-swing"><button data-v="in" class="${o.swing!=='out'?'on':''}">In</button><button data-v="out" class="${o.swing==='out'?'on':''}">Out</button></span></div>
      ${deleteBtn()}`,
    windows: (o) => `
      <div class="field"><label>Width (m)</label>
        <input id="i-w" type="number" step="0.05" min="0.3" value="${pxToM(o.width)}"></div>
      <div class="field"><label>Angle (°)</label>
        <input id="i-ang" type="number" step="1" value="${Math.round(G.deg(o.angle || 0))}"></div>
      ${deleteBtn()}`,
    sensors: (o) => `
      <div class="field"><label>Sensor entity (Home Assistant)</label>
        <input id="i-entity" type="text" placeholder="sensor.livingroom" value="${attr(o.entity)}"></div>
      <div class="field"><label>SVG element id (matches the entity)</label>
        <input id="i-elid" type="text" value="${attr(FP.sym.sensorElementId(o))}" readonly></div>
      <div class="field"><label>Placeholder text</label>
        <input id="i-text" type="text" value="${attr(o.text)}"></div>
      <div class="field row">
        <div><label>Font size</label><input id="i-size" type="number" step="1" min="6" value="${o.size || 16}"></div>
        <div><label>Align</label><span class="seg" id="i-anchor"><button data-v="start" class="${o.anchor === 'start' ? 'on' : ''}">Left</button><button data-v="middle" class="${(o.anchor || 'middle') === 'middle' ? 'on' : ''}">Center</button><button data-v="end" class="${o.anchor === 'end' ? 'on' : ''}">Right</button></span></div>
      </div>
      ${deleteBtn()}`,
    icons: (o) => {
      const presets = ['more-info', 'homeassistant.toggle', 'button.press', 'script.turn_on'];
      const opt = (v, label) => `<option value="${v}" ${o.tap === v ? 'selected' : ''}>${label}</option>`;
      const customSel = presets.includes(o.tap) ? '' : 'selected';
      return `
      <div class="field"><label>Friendly name</label>
        <input id="i-name" type="text" placeholder="e.g. Living-room PC" value="${attr(o.name)}"></div>
      <div class="field"><label>Entity / button / script (Home Assistant)</label>
        <input id="i-entity" type="text" placeholder="switch.pc · button.wake_on_lan_… · script.movie" value="${attr(o.entity)}"></div>
      <div class="field"><label>SVG element id (matches the entity)</label>
        <input id="i-elid" type="text" value="${attr(FP.sym.iconElementId(o))}" readonly></div>
      <div class="field"><label>On tap</label>
        <select id="i-tap">${opt('more-info', 'Show more-info')}${opt('homeassistant.toggle', 'Toggle on/off')}${opt('button.press', 'Press button')}${opt('script.turn_on', 'Run script')}<option value="__custom__" ${customSel}>Custom service…</option></select></div>
      <div class="field"><label>Service called on tap</label>
        <input id="i-tapsvc" type="text" value="${attr(o.tap)}"></div>
      <label class="toggle"><input id="i-statecolor" type="checkbox" ${o.stateColor ? 'checked' : ''}> Grey out when off / colour when on</label>
      ${FP.sym.isMomentary(o)
        ? '<p class="small muted">This is a button (press / run script or scene) — it has no on/off state, so it just uses the <b>off</b> colour and state-colouring is ignored.</p>'
        : (o.entity && o.entity.trim()) ? ''
        : '<p class="small muted">No entity set — a plain button that runs its tap action. It stays full colour; colour-by-state needs an entity.</p>'}
      ${(o.stateColor && o.entity && o.entity.trim() && !FP.sym.isMomentary(o))
        ? `<div class="field"><label>Show as OFF when state is</label>
             <input id="i-offstates" type="text" placeholder="off, idle, docked, paused" value="${attr(o.offStates)}"></div>
           <p class="small muted">Comma-separated. Any other state = on. For a vacuum, use <code>docked</code>.</p>`
        : ''}
      ${o.pathData ? `
      <div class="field" style="margin-top:10px"><label>Material icon</label>
        <input id="i-mdi" type="text" value="${attr(o.mdi || '')}" placeholder="e.g. television"></div>
      <p class="small"><a href="https://pictogrammers.com/library/mdi/" target="_blank" rel="noopener">Browse icon library ↗</a> — type a name, press Enter to change</p>
      <div class="field row">
        <div><label>Colour (on)</label><input id="i-color" class="color-swatch" type="color" value="${o.color || FP.STYLE.iconOn}"></div>
        <div><label>Colour (off)</label><input id="i-coloroff" class="color-swatch" type="color" value="${o.colorOff || FP.STYLE.iconOff}"></div>
      </div>` : ''}
      <div class="field row" style="margin-top:10px">
        <div><label>Width (m)</label><input id="i-w" type="number" step="0.05" min="0.1" value="${pxToM(o.w)}"></div>
        <div><label>Height (m)</label><input id="i-h" type="number" step="0.05" min="0.1" value="${pxToM(o.h)}"></div>
      </div>
      ${o.pathData ? '' : '<div class="btn-row"><button id="i-replace" class="btn block">Replace image…</button></div>'}
      ${deleteBtn()}`;
    },
    fans: (o) => `
      <div class="field"><label>Fan / switch entity (Home Assistant)</label>
        <input id="i-entity" type="text" placeholder="fan.living_room" value="${attr(o.entity)}"></div>
      <div class="field"><label>SVG element id (matches the entity)</label>
        <input id="i-elid" type="text" value="${attr(FP.sym.fanElementId(o))}" readonly></div>
      <div class="field"><label>Radius (m)</label>
        <input id="i-r" type="number" step="0.02" min="0.05" value="${pxToM(o.r)}"></div>
      <p class="muted small">This element spins when its switch is on — the CSS animation is included automatically.</p>
      ${deleteBtn()}`,
  };

  function deleteBtn() {
    return `<div class="btn-row"><button id="i-del" class="btn danger block">Delete element</button></div>`;
  }

  // update model without rebuilding the panel (keeps focus in the field)
  function live(fn) { fn(); FP.editor.render(); FP.persist(); }
  function commit(fn) { FP.beginChange(); fn(); FP.commitChange(); }

  function wireInspector(sel, o) {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on('i-del', 'click', () => commit(() => FP.remove(sel)));

    if (sel.type === 'background') {
      on('i-op', 'input', (e) => live(() => { o.opacity = parseFloat(e.target.value); }));
      on('i-lock', 'change', (e) => commit(() => { o.locked = e.target.checked; }));
      on('i-scale', 'click', () => FP.editor.setTool('scale'));
    }
    if (sel.type === 'walls') {
      on('i-th', 'input', (e) => live(() => { o.thickness = mToPx(e.target.value) || FP.STYLE.wallThickness; }));
      on('i-closed', 'change', (e) => commit(() => { o.closed = e.target.checked; }));
    }
    if (sel.type === 'areas') {
      on('i-name', 'input', (e) => live(() => { o.name = e.target.value; o.slug = G.slug(e.target.value); }));
      on('i-fill', 'input', (e) => live(() => { o.fill = e.target.value; }));
      on('i-light', 'input', (e) => live(() => { o.light = e.target.value.trim(); }));
    }
    if (sel.type === 'doors' || sel.type === 'windows') {
      on('i-w', 'input', (e) => live(() => { o.width = mToPx(e.target.value) || o.width; }));
      on('i-ang', 'input', (e) => live(() => { o.angle = G.rad(parseFloat(e.target.value) || 0); }));
    }
    if (sel.type === 'doors') {
      segClick('i-hinge', (v) => live(() => { o.hinge = v; }));
      segClick('i-swing', (v) => live(() => { o.swing = v; }));
    }
    if (sel.type === 'sensors') {
      on('i-entity', 'input', (e) => {
        live(() => { o.entity = e.target.value.trim(); o.slug = slugFromEntity(o.entity, o.slug); });
        const el = $('i-elid'); if (el) el.value = FP.sym.sensorElementId(o);
      });
      on('i-text', 'input', (e) => live(() => { o.text = e.target.value; }));
      on('i-size', 'input', (e) => live(() => { o.size = parseFloat(e.target.value) || 16; }));
      segClick('i-anchor', (v) => live(() => { o.anchor = v; }));
    }
    if (sel.type === 'fans') {
      on('i-entity', 'input', (e) => {
        live(() => { o.entity = e.target.value.trim(); o.slug = slugFromEntity(o.entity, o.slug); });
        const el = $('i-elid'); if (el) el.value = FP.sym.fanElementId(o);
      });
      on('i-r', 'input', (e) => live(() => { o.r = mToPx(e.target.value) || o.r; }));
    }
    if (sel.type === 'icons') {
      on('i-name', 'input', (e) => { live(() => { o.name = e.target.value; }); refreshHA(); });
      on('i-entity', 'input', (e) => {
        live(() => { o.entity = e.target.value.trim(); o.slug = slugFromEntity(o.entity, o.slug); });
        const el = $('i-elid'); if (el) el.value = FP.sym.iconElementId(o);
      });
      on('i-tap', 'change', (e) => {
        const v = e.target.value;
        if (v === '__custom__') { const t = $('i-tapsvc'); if (t) { t.focus(); t.select(); } }
        else { live(() => { o.tap = v; }); const t = $('i-tapsvc'); if (t) t.value = v; }
      });
      on('i-tapsvc', 'input', (e) => live(() => { o.tap = e.target.value.trim() || 'more-info'; }));
      on('i-statecolor', 'change', (e) => commit(() => { o.stateColor = e.target.checked; }));
      on('i-offstates', 'input', (e) => live(() => { o.offStates = e.target.value; }));
      on('i-w', 'input', (e) => live(() => { o.w = mToPx(e.target.value) || o.w; }));
      on('i-h', 'input', (e) => live(() => { o.h = mToPx(e.target.value) || o.h; }));
      on('i-replace', 'click', () => { FP._replaceIconId = o.id; $('file-icon').click(); });
      on('i-color', 'input', (e) => live(() => { o.color = e.target.value; }));
      on('i-coloroff', 'input', (e) => live(() => { o.colorOff = e.target.value; }));
      on('i-mdi', 'change', async (e) => {
        const r = await fetchMdiPath(e.target.value);
        if (r) commit(() => { o.mdi = r.name; o.pathData = r.path; });
        else { alert('No Material icon named "' + normalizeMdi(e.target.value) + '". Check the library.'); e.target.value = o.mdi || ''; }
      });
    }
  }

  function segClick(id, fn) {
    const seg = $(id);
    if (!seg) return;
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      fn(b.dataset.v);
    }));
  }

  // element id after the domain, e.g. "sensor.livingroom" -> "livingroom"
  function slugFromEntity(entity, fallback) {
    if (!entity) return fallback;
    const dot = entity.indexOf('.');
    return G.slug(dot >= 0 ? entity.slice(dot + 1) : entity) || fallback;
  }

  // ---- HA entity panel -----------------------------------------------------
  function refreshHA() {
    const body = $('ha-body');
    let out = '';

    out += haGroup('Room lights', '#f6c56b', FP.model.areas.map((a) => ({
      key: a.id, type: 'areas', name: a.name || a.slug, val: a.light,
      placeholder: 'light.' + a.slug, field: 'light',
    })));
    out += haGroup('Temperature sensors', '#e57373', FP.model.sensors.map((s) => ({
      key: s.id, type: 'sensors', name: s.slug, val: s.entity,
      placeholder: 'sensor.livingroom', field: 'entity',
    })));
    out += haGroup('Fans (spinning)', '#4fc3f7', FP.model.fans.map((f) => ({
      key: f.id, type: 'fans', name: f.slug, val: f.entity,
      placeholder: 'fan.living_room', field: 'entity',
    })));
    out += haGroup('Devices / icons', '#7e57c2', FP.model.icons.map((ic) => ({
      key: ic.id, type: 'icons', name: ic.name || ic.slug, val: ic.entity,
      placeholder: 'switch.pc · button.wake_on_lan_…', field: 'entity',
    })));

    body.innerHTML = out;

    body.querySelectorAll('input[data-eid]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const type = inp.dataset.etype, id = inp.dataset.eid, field = inp.dataset.field;
        const o = FP.find({ type, id });
        if (!o) return;
        live(() => {
          o[field] = e.target.value.trim();
          if (field === 'entity') o.slug = slugFromEntity(o.entity, o.slug);
        });
      });
      inp.addEventListener('focus', () => {
        st.selection = { type: inp.dataset.etype, id: inp.dataset.eid };
        FP.editor.render(); refreshInspector();
      });
    });
  }

  function haGroup(title, color, rows) {
    let out = `<div class="ha-group"><div class="ha-head"><span class="ha-dot" style="background:${color}"></span>${S(title)}</div>`;
    if (!rows.length) out += `<div class="ha-empty">none yet</div>`;
    for (const r of rows) {
      out += `<div class="ha-row"><span class="name" title="${attr(r.name)}">${S(r.name)}</span>` +
        `<input type="text" data-eid="${r.key}" data-etype="${r.type}" data-field="${r.field}" ` +
        `placeholder="${attr(r.placeholder)}" value="${attr(r.val)}"></div>`;
    }
    return out + '</div>';
  }

  // ---- export modal --------------------------------------------------------
  let currentTab = 'svg';
  function wireModal() {
    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => setTab(t.dataset.tab)));
    $('modal-close').addEventListener('click', () => $('modal').classList.add('hidden'));
    $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('modal').classList.add('hidden'); });
    $('btn-copy').addEventListener('click', () => {
      const ta = $('export-text'); ta.select();
      navigator.clipboard ? navigator.clipboard.writeText(ta.value) : document.execCommand('copy');
      $('btn-copy').textContent = 'Copied ✓';
      setTimeout(() => ($('btn-copy').textContent = 'Copy'), 1200);
    });
    $('btn-download').addEventListener('click', downloadCurrent);
    $('export-base').addEventListener('input', (e) => {
      // path-safe: lowercase, keep letters/numbers/-/_, collapse the rest
      const v = e.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+/, '');
      if (v !== e.target.value) {
        const pos = e.target.selectionStart;
        e.target.value = v;
        e.target.setSelectionRange(pos, pos);
      }
      FP.model.meta.path = v;
      FP.persist();
      setTab(currentTab);   // refresh the shown output + filename note
    });
    $('export-base').addEventListener('change', (e) => {
      // tidy up trailing separators once the user is done typing
      const v = e.target.value.replace(/[_-]+$/, '');
      e.target.value = v;
      FP.model.meta.path = v;
      FP.persist();
      setTab(currentTab);
    });
  }

  function openExport() {
    FP.model.meta.exportVersion = (FP.model.meta.exportVersion || 0) + 1;  // bump cache-buster
    FP.persist();
    const inp = $('export-base');
    inp.value = FP.model.meta.path || '';
    inp.placeholder = G.slug(FP.model.meta.title || 'floorplan');
    setTab(currentTab);
    $('modal').classList.remove('hidden');
  }

  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    const base = FP.baseName(FP.model);
    let text = '', note = '';
    if (tab === 'svg') { text = FP.buildExportSVG(FP.model); note = `Save as ${base}.svg`; }
    else if (tab === 'css') { text = FP.buildCSS(FP.model); note = `Save as ${base}.css` + (FP.model.fans.length ? ' · includes the spin animation' : ' · no spin animation (no fan present)'); }
    else { text = FP.buildYAML(FP.model, base); note = `Paste into your dashboard's raw configuration editor (adds a floorplan view)`; }
    $('export-text').value = text;
    $('export-note').textContent = note;
  }

  function downloadCurrent() {
    const base = FP.baseName(FP.model);
    const map = { svg: [base + '.svg', 'image/svg+xml'], css: [base + '.css', 'text/css'], yaml: [base + '.yaml', 'text/yaml'] };
    const [name, mime] = map[currentTab];
    download(name, $('export-text').value, mime);
  }

  // ---- helpers -------------------------------------------------------------
  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  const S = (s) => FP.sym.esc(s);
  const attr = (s) => FP.sym.esc(s == null ? '' : s);

  // ---- starter example -----------------------------------------------------
  function seedExample() {
    const m = FP.blankModel();
    m.meta.title = 'My Home';
    const P = (x, y) => ({ x, y });
    m.walls.push({ id: 'e' + (m.uid++), thickness: 12, closed: true,
      points: [P(100, 100), P(760, 100), P(760, 500), P(100, 500)] });
    m.walls.push({ id: 'e' + (m.uid++), thickness: 12, closed: false,
      points: [P(470, 100), P(470, 500)] });
    m.areas.push({ id: 'e' + (m.uid++), slug: 'livingroom', name: 'Living', fill: FP.STYLE.areaPalette[0],
      light: 'light.livingroom', points: [P(106, 106), P(464, 106), P(464, 494), P(106, 494)] });
    m.areas.push({ id: 'e' + (m.uid++), slug: 'office', name: 'Home Office', fill: FP.STYLE.areaPalette[3],
      light: 'light.office', points: [P(476, 106), P(754, 106), P(754, 494), P(476, 494)] });
    m.doors.push({ id: 'e' + (m.uid++), x: 470, y: 300, angle: Math.PI / 2, width: 90, wallThickness: 12, hinge: 'left', swing: 'in' });
    m.windows.push({ id: 'e' + (m.uid++), x: 300, y: 100, angle: 0, width: 120, wallThickness: 12 });
    m.sensors.push({ id: 'e' + (m.uid++), slug: 'livingroom', entity: 'sensor.livingroom', x: 200, y: 410, text: '21.0°', size: 18 });
    m.fans.push({ id: 'e' + (m.uid++), slug: 'office_fan', entity: 'switch.office_fan', x: 615, y: 250, r: 30 });
    FP.model = m;
    FP.persist();
  }
})(window.FP = window.FP || {});
