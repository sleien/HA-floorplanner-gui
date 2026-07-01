/* export.js — shared floorplan renderer + SVG / CSS / YAML generators. */
(function (FP) {
  'use strict';
  const G = FP.geom;
  const S = FP.sym;

  // An Inkscape layer: <g inkscape:groupmode="layer" inkscape:label="..."> — used
  // instead of plain groups so the SVG opens as organised layers in Inkscape. The
  // highlight colour is shown in Inkscape's Objects panel to group layers by kind.
  function layer(label, id, content, color) {
    if (!content) return '';
    const hl = color ? ` inkscape:highlight-color="${color}"` : '';
    return `<g inkscape:groupmode="layer" inkscape:label="${label}" id="${id}"${hl}>` +
           content + '</g>';
  }

  // ---- shared: build the layered inner SVG markup --------------------------
  // Used by both the live editor and the export so WYSIWYG holds. Bottom-to-top:
  // Areas · Things (walls+fans) · Doors & Windows · Sensors · Labels · Dimensions.
  FP.buildFloorplanInner = function (model, opts) {
    opts = opts || {};
    const fs = FP.fontSize(model);
    const C = FP.STYLE;

    let areas = '';
    for (const a of model.areas) areas += S.area(a);

    // walls get their own layer so the CSS can target them precisely
    let walls = '';
    for (const w of model.walls) walls += S.wall(w);

    // Home Assistant devices — fans and clickable icons
    let devices = '';
    for (const f of model.fans) devices += S.fan(f);
    for (const ic of model.icons) devices += S.icon(ic);

    // doors + windows — each one wrapped in its own group to keep the file tidy
    let openings = '';
    model.windows.forEach((w, i) => { openings += `<g class="window" id="window${i + 1}">${S.window(w)}</g>`; });
    model.doors.forEach((d, i) => { openings += `<g class="door" id="door${i + 1}">${S.door(d)}</g>`; });

    let sensors = '';
    for (const s of model.sensors) sensors += S.sensor(s);

    let labels = '';
    for (const a of model.areas) {
      if (!a.name) continue;
      const c = a.labelPos || G.polygonCentroid(a.points);
      labels += S.label({ x: c.x, y: c.y, text: a.name, size: fs });
    }

    const dims = opts.dims ? buildDimensions(model) : '';

    let out = '';
    out += layer('Areas', 'layer-areas', areas, C.layerHA);
    out += layer('Walls', 'layer-walls', walls, C.layerStructural);
    out += layer('Doors & Windows', 'layer-openings', openings, C.layerStructural);
    out += layer('Devices', 'layer-devices', devices, C.layerHA);
    out += layer('Sensors', 'layer-sensors', sensors, C.layerHA);
    out += layer('Labels', 'layer-labels', labels, C.layerAnnotation);
    out += layer('Dimensions', 'layer-dims', dims, C.layerAnnotation);

    return out;
  };

  function contentPoints(model) {
    const pts = [];
    for (const w of model.walls) pts.push(...w.points);
    for (const a of model.areas) pts.push(...a.points);
    for (const o of model.doors.concat(model.windows)) {
      // span the width along the opening's actual angle, not diagonally
      const half = o.width / 2;
      const dx = Math.cos(o.angle || 0) * half, dy = Math.sin(o.angle || 0) * half;
      pts.push({ x: o.x - dx, y: o.y - dy });
      pts.push({ x: o.x + dx, y: o.y + dy });
    }
    for (const s of model.sensors) pts.push({ x: s.x, y: s.y });
    for (const f of model.fans) pts.push({ x: f.x - f.r, y: f.y - f.r }, { x: f.x + f.r, y: f.y + f.r });
    for (const ic of model.icons) pts.push({ x: ic.x - ic.w / 2, y: ic.y - ic.h / 2 }, { x: ic.x + ic.w / 2, y: ic.y + ic.h / 2 });
    return pts;
  }

  FP.contentBounds = function (model) {
    const pts = contentPoints(model);
    if (!pts.length) return { minX: 0, minY: 0, maxX: 800, maxY: 600, w: 800, h: 600 };
    return G.bounds(pts);
  };

  function buildDimensions(model) {
    const b = FP.contentBounds(model);
    if (!isFinite(b.w) || b.w <= 0) return '';
    const off = 34;
    const df = Math.max(9, Math.round(FP.fontSize(model) * 0.8));
    // overall width (below) + overall height (to the right), emitted directly
    return S.dimension({ x: b.minX, y: b.maxY }, { x: b.maxX, y: b.maxY }, off, df) +
           S.dimension({ x: b.maxX, y: b.maxY }, { x: b.maxX, y: b.minY }, off, df);
  }

  // ---- SVG export ----------------------------------------------------------
  FP.buildExportSVG = function (model) {
    const b = FP.contentBounds(model);
    const pad = 60;
    const minX = b.minX - pad, minY = b.minY - pad;
    const w = b.w + pad * 2, h = b.h + pad * 2;
    // put each layer (and each door/window group) on its own line for readability
    const inner = FP.buildFloorplanInner(model, { dims: FP.state.showDims })
      .split('</g><g inkscape:groupmode="layer"').join('</g>\n  <g inkscape:groupmode="layer"')
      .split('<g class="window"').join('\n    <g class="window"')
      .split('<g class="door"').join('\n    <g class="door"')
      .split('<image ').join('\n    <image ')
      .split('<g id="').join('\n    <g id="');   // fan + material-icon groups
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
      `viewBox="${G.round(minX, 1)} ${G.round(minY, 1)} ${G.round(w, 1)} ${G.round(h, 1)}" ` +
      `width="${Math.round(w)}" height="${Math.round(h)}">\n` +
      '  ' + inner + '\n' +
      '</svg>\n'
    );
  };

  // ---- CSS export ----------------------------------------------------------
  // "spinning" keyframes are only emitted when a spinning element exists.
  FP.buildCSS = function (model) {
    const hasFan = model.fans.length > 0;
    const S = FP.STYLE;
    let css = `/* Generated by Floorplanner → Home Assistant tool */

/* ── Colours ──────────────────────────────────────────────────────
   Walls, labels, dimensions and text follow the Home Assistant theme
   (light in light mode, light-on-dark in dark mode). The fallbacks are
   used when viewing the SVG standalone. Override any --fp-* to taste. */
svg {
  --fp-light-on: ${S.lightOn};    /* room colour when the light is ON  */
  --fp-light-off: ${S.lightOff};  /* room colour when the light is OFF */
  --fp-wall:  var(--primary-text-color, ${S.wall});      /* walls, doors, windows */
  --fp-label: var(--primary-text-color, ${S.label});     /* room name labels      */
  --fp-temp:  var(--primary-text-color, ${S.tempText});  /* temperature text      */
  --fp-dim:   var(--secondary-text-color, ${S.dim});     /* dimension lines       */
  --fp-gap:   var(--card-background-color, #ffffff);      /* door/window openings  */
}

/* structural elements — recoloured so the plan reads on any HA theme */
.wall, .fp-line { stroke: var(--fp-wall) !important; }
.fp-frame { fill: var(--fp-gap) !important; stroke: var(--fp-wall) !important; }
.fp-mask { fill: var(--fp-gap) !important; }
.room-label { fill: var(--fp-label) !important; }
.fp-dim-line { stroke: var(--fp-dim) !important; }
.fp-dim-text { fill: var(--fp-dim) !important; }

#floorplan {
  padding: 10px;
}

/* Room lighting — grey when off, yellow when on.
   The CSS controls the colour here; the per-room colours baked into the
   SVG are only used for visualisation inside the editor. */
path[id*="area."],
path[id*="area."].light-off {
  fill: var(--fp-light-off, ${S.lightOff}) !important;
  opacity: 0.5;
  transition: fill .3s ease, opacity .3s ease;
}

path[id*="area."].light-on {
  fill: var(--fp-light-on, ${S.lightOn}) !important;
  opacity: 0.65 !important;
}

/* Temperature sensor text — dark so it stays readable on the floor */
text.sensor, text.sensor tspan,
.static-temp, .static-temp tspan {
  fill: var(--fp-temp, ${S.tempText}) !important;
  font-weight: 600;
}

/* Device icons — state is the device-off / device-on class ha-floorplan sets.
   NOTE: floorplan.class_set REPLACES an element's classes, so these rules must
   not depend on the original .icon / .mdi classes (they are gone after the first
   state update). We key off the state class + element type instead. */

/* uploaded images: dim + greyscale when off */
image { transition: opacity .3s ease, filter .3s ease; }
image.device-off { opacity: 0.4; filter: grayscale(0.85); }
image.device-on  { opacity: 1; filter: drop-shadow(0 0 4px #ffd98a); }

/* material icons: recolour via fill — "off" colour when off, "on" colour + glow when on */
g.device-off > path { fill: var(--icon-off, #9e9e9e) !important; transition: fill .3s ease; }
g.device-on  > path { fill: currentColor !important; transition: fill .3s ease; }
g.device-on { filter: drop-shadow(0 0 3px currentColor); }

/* Base text colour (room labels etc.) */
svg tspan {
  fill: var(--primary-text-color);
}

/* Keep strokes crisp */
svg, svg * {
  vector-effect: non-scaling-stroke !important;
}

/* Clickability is keyed off LAYER ids, not element classes — ha-floorplan's
   class_set replaces an element's classes when it writes state, so a class-based
   rule would stop matching after the first update. Areas, devices and sensors stay
   clickable; walls, doors, labels and dimensions pass taps straight through to the
   room area beneath (so the walls can sit on top to cover the borders). */
#layer-areas *, #layer-devices *, #layer-sensors * { pointer-events: all !important; }
#layer-walls *, #layer-openings *, #layer-labels *, #layer-dims *,
svg g#layer-walls > path.wall { pointer-events: none !important; }

/* Hover highlight — rooms only (ha-floorplan adds .floorplan-hover on hover).
   Scoped to area paths so it can't stroke device icons or their hit rects. */
path[id*="area."].floorplan-hover {
  stroke: #03A9F4 !important;
  stroke-width: 1px !important;
  stroke-opacity: 1 !important;
}
`;

    if (hasFan) {
      css += `
/* Spinning fan — class toggled on by ha-floorplan when the switch is on */
.spinning {
  animation-name: spin;
  animation-duration: 5s;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
  transform-origin: center;
  transform-box: fill-box;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;
    }
    return css;
  };

  // ---- YAML export ---------------------------------------------------------
  // The floorplan config body — everything that sits under a card's `config:`
  // key (image, stylesheet, defaults, rules). Indentation is relative: the top
  // keys start at column 0 so the block can be re-indented wherever it's placed.
  function floorplanConfigBody(model, base) {
    const dir = `/local/floorplan/${base}`;
    const rooms = model.areas.filter((a) => a.light && a.light.trim());
    const temps = model.sensors.filter((s) => s.entity && s.entity.trim());
    const fans = model.fans.filter((f) => f.entity && f.entity.trim());
    const icons = model.icons.filter((i) => i.entity && i.entity.trim());
    // icons with no entity but a service tap (e.g. run a script) — bound by element id
    const actionIcons = model.icons.filter((i) =>
      !(i.entity && i.entity.trim()) && i.tap && i.tap.trim() && i.tap !== 'more-info');

    let y = '';
    y += `image: ${dir}/${base}.svg\n`;
    y += `stylesheet: ${dir}/${base}.css\n\n`;
    y += `defaults:\n`;
    y += `  hover_action: hover-info\n`;
    y += `  tap_action: more-info\n\n`;
    y += `rules:\n`;

    if (rooms.length) {
      y += `  - name: Rooms\n`;
      y += `    entities:\n`;
      for (const a of rooms) {
        y += `      - entity: ${a.light.trim()}\n`;
        y += `        element: area.${a.slug}\n`;
      }
      y += `    tap_action: homeassistant.toggle\n`;
      y += `    state_action:\n`;
      y += `      service: floorplan.class_set\n`;
      y += `      service_data: '\${(entity.state === "on") ? "light-on" : "light-off"}'\n`;
    }

    if (temps.length) {
      y += `  - name: Temperature\n`;
      y += `    entities:\n`;
      // element id defaults to the entity id, so keep them matched (sensor.<slug>)
      for (const s of temps) y += `      - ${s.entity.trim()}\n`;
      y += `    state_action:\n`;
      y += `      - service: floorplan.text_set\n`;
      y += `        service_data: '\${(entity.state !== undefined) ? Math.round(entity.state * 10) / 10 + "°" : "unknown"}'\n`;
      y += `      - service: floorplan.class_set\n`;
      y += `        service_data:\n`;
      y += `          class: 'static-temp'\n`;
    }

    for (const f of fans) {
      y += `  - entity: ${f.entity.trim()}\n`;
      y += `    tap_action: toggle\n`;
      y += `    state_action:\n`;
      y += `      service: floorplan.class_set\n`;
      y += `      service_data: '\${(entity.state === "on") ? "spinning" : ""}'\n`;
    }

    for (const ic of icons) {
      y += `  - entity: ${ic.entity.trim()}\n`;
      y += `    tap_action: ${ic.tap || 'more-info'}\n`;
      if (ic.stateColor && !S.isMomentary(ic)) {
        y += `    state_action:\n`;
        y += `      service: floorplan.class_set\n`;
        y += `      service_data: '\${["off","unavailable","idle","standby","unknown"].includes(entity.state) ? "device-off" : "device-on"}'\n`;
      }
    }

    // entity-less action buttons: bind the click to the element and call the service
    for (const ic of actionIcons) {
      y += `  - element: ${FP.sym.iconElementId(ic)}\n`;
      y += `    tap_action:\n`;
      y += `      action: call-service\n`;
      y += `      service: ${ic.tap.trim()}\n`;
    }

    if (!rooms.length && !temps.length && !fans.length && !icons.length && !actionIcons.length) {
      y += `  []  # add lights, sensors, a fan or an icon and set their HA entity ids\n`;
    }
    return y.replace(/\n+$/, '');
  }

  function indentBlock(text, prefix) {
    return text.split('\n').map((l) => (l.length ? prefix + l : l)).join('\n');
  }

  FP.floorplanConfigBody = floorplanConfigBody;

  // The base name for files, the /local/floorplan/<base>/ folder and the view path.
  // Uses the custom meta.path when set, otherwise falls back to a slug of the title.
  FP.baseName = function (model) {
    const p = model.meta && model.meta.path ? String(model.meta.path).trim() : '';
    return p || G.slug(model.meta.title || 'floorplan');
  };

  // base text size (px) for room labels, dimensions and new sensors
  FP.fontSize = function (model) {
    const n = model.meta && model.meta.fontSize;
    return (typeof n === 'number' && n > 0) ? n : 15;
  };

  // Paste-ready Lovelace dashboard: a full-screen view holding the floorplan card.
  FP.buildYAML = function (model, baseName) {
    const base = baseName || FP.baseName(model);
    const title = model.meta.title || 'Floorplan';
    const cfg = indentBlock(floorplanConfigBody(model, base), '          ');
    return (
`# ── ha-floorplan dashboard view ───────────────────────────────────────
# 1. Copy ${base}.svg and ${base}.css into:  config/www/floorplan/${base}/
#    (and make sure ha-floorplan is installed as a resource — via HACS).
# 2. Open your dashboard → pencil (Edit) → top-right ⋮ →
#    "Raw configuration editor", then add this view:
#      • brand-new dashboard  → paste the whole block below
#      • it already has "views:" → paste only the "- title:" item beneath it
# ──────────────────────────────────────────────────────────────────────
views:
  - title: ${title}
    path: ${base}
    icon: mdi:floor-plan
    panel: true            # full-screen; remove this line for a card in the grid
    cards:
      - type: custom:floorplan-card
        full_height: true
        config:
${cfg}
`
    );
  };
})(window.FP = window.FP || {});
