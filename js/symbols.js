/* symbols.js — build SVG fragment strings (world-px) for every element type.
   These strings are used both for the on-screen editor and the clean export,
   so what you see is what you get.                                           */
(function (FP) {
  'use strict';
  const G = FP.geom;

  // visual style — tweak here to restyle everything
  FP.STYLE = {
    wall: '#20232a',
    wallThickness: 12,      // world px (~0.12 m)
    opening: '#ffffff',     // fill used to "cut" a gap in a wall
    door: '#20232a',
    window: '#20232a',
    windowGlass: '#8fd0ff',
    fan: '#3a3f4b',
    fanBg: '#c9ced8',
    dim: '#6b7280',
    label: '#374151',
    sensor: '#111827',
    // Home Assistant on/off appearance (also used by the editor's Preview mode)
    lightOn: '#ffd54f',    // yellow when the light is on
    lightOff: '#9e9e9e',   // grey when the light is off
    tempText: '#263238',   // temperature text — dark so it's readable on the floor
    iconOn: '#2f7ff0',     // default colour a material device icon takes when "on"
    iconOff: '#9e9e9e',    // default colour a material device icon takes when "off"
    // Inkscape layer highlight colours, by category (shown in the Objects panel).
    // Must be 6-digit RGB hex — Inkscape doesn't parse 8-digit RGBA here.
    layerHA: '#27ae60',          // Home Assistant entities (areas, sensors, fans)
    layerStructural: '#607d8b',  // structural (walls, doors, windows)
    layerAnnotation: '#e0a021',  // annotations (labels, dimensions)
    areaPalette: ['#f7c9b6', '#cfc6ef', '#f3b6c2', '#c9d3dd',
                  '#bfe3c9', '#f6e2a8', '#b6d8ef', '#e3c9dd', '#d6d6c2'],
  };

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const r2 = (n) => G.round(n, 2);

  const S = {};
  S.esc = esc;

  // The SVG element id must equal the Home Assistant entity id, because the
  // generated rules use the implicit form (element defaults to the entity).
  // Fall back to a domain-prefixed slug until an entity has been entered.
  S.fanElementId = (f) =>
    (f.entity && f.entity.trim()) ? f.entity.trim() : ('switch.' + (f.slug || 'fan'));
  S.sensorElementId = (s) =>
    (s.entity && s.entity.trim()) ? s.entity.trim() : ('sensor.' + (s.slug || 'sensor'));
  S.iconElementId = (ic) =>
    (ic.entity && ic.entity.trim()) ? ic.entity.trim() : ('icon.' + (ic.slug || 'icon'));

  // A "momentary" icon fires an action but has no on/off state (a button press, a
  // script/scene run). It should sit at its off/neutral colour, never light up.
  S.isMomentary = (ic) => {
    const doms = ['button', 'scene', 'script', 'input_button'];
    const tapDom = String(ic.tap || '').split('.')[0];
    const entDom = String(ic.entity || '').split('.')[0];
    return doms.indexOf(tapDom) >= 0 || doms.indexOf(entDom) >= 0;
  };

  // ---- Area (room floor / lighting overlay) --------------------------------
  // id="area.<slug>" so ha-floorplan can toggle it with the room light.
  S.area = (a) => {
    const d = G.pathData(a.points, true);
    return `<path id="area.${esc(a.slug)}" class="ha-entity area" ` +
           `d="${d}" fill="${a.fill}" fill-opacity="0.5" stroke="none"/>`;
  };

  // ---- Wall ----------------------------------------------------------------
  S.wall = (w) => {
    const d = G.pathData(w.points, !!w.closed);
    const th = w.thickness || FP.STYLE.wallThickness;
    return `<path class="wall" d="${d}" fill="none" stroke="${FP.STYLE.wall}" ` +
           `stroke-width="${th}" stroke-linejoin="miter" stroke-linecap="square"/>`;
  };

  // ---- Opening (the white gap a door/window carves into a wall) ------------
  function openingRect(o, extra) {
    const w = o.width, t = (o.wallThickness || FP.STYLE.wallThickness) + 2;
    const cx = o.x, cy = o.y, ang = G.deg(o.angle || 0);
    return `<rect class="fp-mask" x="${r2(cx - w / 2)}" y="${r2(cy - t / 2)}" ` +
           `width="${r2(w)}" height="${r2(t)}" fill="${FP.STYLE.opening}" ` +
           `stroke="none" transform="rotate(${r2(ang)} ${r2(cx)} ${r2(cy)})" ${extra || ''}/>`;
  }

  // ---- Door ----------------------------------------------------------------
  // A door = white opening + leaf line + swing arc, matching a standard plan symbol.
  S.door = (d) => {
    const w = d.width;
    const a = d.angle || 0;
    const dir = { x: Math.cos(a), y: Math.sin(a) };            // along the wall
    const p1 = G.add({ x: d.x, y: d.y }, G.mul(dir, -w / 2));  // jamb 1
    const p2 = G.add({ x: d.x, y: d.y }, G.mul(dir, w / 2));   // jamb 2

    const hinge = d.hinge === 'right' ? p2 : p1;
    const closedDir = d.hinge === 'right' ? G.mul(dir, -1) : dir;
    const closedTip = G.add(hinge, G.mul(closedDir, w));
    const swingSign = d.swing === 'out' ? -1 : 1;
    const openDir = G.rotate(closedDir, swingSign * Math.PI / 2);
    const openTip = G.add(hinge, G.mul(openDir, w));
    const sweep = swingSign > 0 ? 1 : 0;

    const leaf = `<line class="fp-line" x1="${r2(hinge.x)}" y1="${r2(hinge.y)}" ` +
                 `x2="${r2(openTip.x)}" y2="${r2(openTip.y)}" ` +
                 `stroke="${FP.STYLE.door}" stroke-width="2"/>`;
    const arc = `<path class="fp-line" d="M ${r2(closedTip.x)} ${r2(closedTip.y)} ` +
                `A ${r2(w)} ${r2(w)} 0 0 ${sweep} ${r2(openTip.x)} ${r2(openTip.y)}" ` +
                `fill="none" stroke="${FP.STYLE.door}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    return openingRect(d) + leaf + arc;
  };

  // ---- Window --------------------------------------------------------------
  S.window = (o) => {
    const w = o.width;
    const t = (o.wallThickness || FP.STYLE.wallThickness);
    const ang = G.deg(o.angle || 0);
    const cx = o.x, cy = o.y;
    const frame = `<rect class="fp-frame" x="${r2(cx - w / 2)}" y="${r2(cy - t / 2)}" ` +
      `width="${r2(w)}" height="${r2(t)}" fill="#ffffff" stroke="${FP.STYLE.window}" ` +
      `stroke-width="1.5" transform="rotate(${r2(ang)} ${r2(cx)} ${r2(cy)})"/>`;
    const glass = `<line class="fp-line" x1="${r2(cx - w / 2)}" y1="${r2(cy)}" ` +
      `x2="${r2(cx + w / 2)}" y2="${r2(cy)}" stroke="${FP.STYLE.window}" ` +
      `stroke-width="1.5" transform="rotate(${r2(ang)} ${r2(cx)} ${r2(cy)})"/>`;
    return openingRect(o) + frame + glass;
  };

  // ---- Sensor (temperature text) -------------------------------------------
  // id="sensor.<slug>" — ha-floorplan writes the value into the <tspan>.
  S.sensor = (s) => {
    const label = s.text || '20.0°';
    return `<text id="${esc(S.sensorElementId(s))}" class="ha-entity sensor" ` +
           `x="${r2(s.x)}" y="${r2(s.y)}" text-anchor="middle" dominant-baseline="central" ` +
           `font-family="Helvetica, Arial, sans-serif" font-size="${s.size || 16}">` +
           `<tspan>${esc(label)}</tspan></text>`;
  };

  // ---- Fan (spinning element) ----------------------------------------------
  // id="switch.<slug>" — ha-floorplan toggles the "spinning" class on this group.
  S.fan = (f) => {
    const r = f.r || 26;
    const cx = f.x, cy = f.y;
    let blades = '';
    for (let i = 0; i < 3; i++) {
      const rot = i * 120;
      blades +=
        `<path d="M ${r2(cx)} ${r2(cy)} ` +
        `q ${r2(r * 0.55)} ${r2(-r * 0.35)} ${r2(r)} ${r2(-r * 0.05)} ` +
        `q ${r2(-r * 0.45)} ${r2(r * 0.4)} ${r2(-r)} ${r2(r * 0.05)} Z" ` +
        `fill="${FP.STYLE.fan}" transform="rotate(${rot} ${r2(cx)} ${r2(cy)})"/>`;
    }
    return `<g id="${esc(S.fanElementId(f))}" class="ha-entity fan" ` +
      `inkscape:highlight-color="${FP.STYLE.layerHA}">` +
      `<circle id="${esc(f.slug)}_background" cx="${r2(cx)}" cy="${r2(cy)}" ` +
        `r="${r2(r * 1.15)}" fill="${FP.STYLE.fanBg}" fill-opacity="0.6"/>` +
      blades +
      `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r * 0.14)}" fill="${FP.STYLE.fan}"/>` +
      `</g>`;
  };

  // ---- Device icon (clickable image bound to an HA entity) -----------------
  // id="<entity>" so ha-floorplan can act on it; the device-on/off class is
  // toggled from state to dim/brighten (colour) the image.
  S.icon = (ic) => {
    const w = ic.w || 60, h = ic.h || 60;
    const id = esc(S.iconElementId(ic));
    const x = r2(ic.x - w / 2), y = r2(ic.y - h / 2);
    const hl = `inkscape:highlight-color="${FP.STYLE.layerHA}"`;
    // Momentary buttons sit at their off colour. Stateful entities start off until HA
    // reports their state. Plain custom-service buttons stay full colour.
    const mom = S.isMomentary(ic);
    const dev = (mom || (ic.stateColor && ic.entity && ic.entity.trim())) ? ' device-off' : '';
    const btn = mom ? ' momentary' : '';   // lets the editor preview it as "off" too
    if (ic.pathData) {
      // Material Design Icon — a 24×24 path scaled into place, recoloured via CSS fill.
      // On colour = currentColor; off colour is read from --icon-off by the CSS.
      const color = ic.color || FP.STYLE.iconOn;
      const off = ic.colorOff || FP.STYLE.iconOff;
      // an invisible full-size rect makes the whole icon box clickable, not just
      // the painted parts (many MDI icons are hollow outlines)
      return `<g id="${id}" class="ha-entity icon mdi${dev}${btn}" ` +
             `transform="translate(${x} ${y}) scale(${r2(w / 24)} ${r2(h / 24)})" ` +
             `style="color:${esc(color)};--icon-off:${esc(off)}" ${hl}>` +
             `<rect width="24" height="24" fill="none" stroke="none" pointer-events="all"/>` +
             `<path d="${esc(ic.pathData)}" fill="currentColor"/></g>`;
    }
    return `<image id="${id}" class="ha-entity icon${dev}${btn}" ` +
           `x="${x}" y="${y}" width="${r2(w)}" height="${r2(h)}" href="${esc(ic.href)}" ` +
           `preserveAspectRatio="xMidYMid meet" ${hl}/>`;
  };

  // ---- Room name label (plain, not an entity) ------------------------------
  S.label = (l) =>
    `<text class="room-label" x="${r2(l.x)}" y="${r2(l.y)}" text-anchor="middle" ` +
    `dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" ` +
    `font-size="${l.size || 15}" fill="${FP.STYLE.label}">${esc(l.text)}</text>`;

  // ---- Dimension line ------------------------------------------------------
  // Draws an offset dimension between a and b with tick marks and a metre label.
  S.dimension = (a, b, offset, fontSize) => {
    const dir = G.norm(G.sub(b, a));
    const n = G.perp(dir);                 // offset direction
    const off = G.mul(n, offset);
    const A = G.add(a, off), B = G.add(b, off);
    const tick = 6;
    const tA1 = G.add(A, G.mul(n, tick)), tA2 = G.add(A, G.mul(n, -tick));
    const tB1 = G.add(B, G.mul(n, tick)), tB2 = G.add(B, G.mul(n, -tick));
    const fsz = fontSize || 12;
    const mid = G.mul(G.add(A, B), 0.5);
    const labelPos = G.add(mid, G.mul(n, fsz));
    const lenTxt = G.fmtMeters(G.dist(a, b));
    const c = FP.STYLE.dim;
    let ang = G.deg(G.angle(A, B));
    if (ang > 90 || ang < -90) ang += 180;   // keep text upright
    const ln = (x1, y1, x2, y2) =>
      `<line class="fp-dim-line" x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" ` +
      `stroke="${c}" stroke-width="1"/>`;
    return (
      ln(A.x, A.y, B.x, B.y) +
      ln(tA1.x, tA1.y, tA2.x, tA2.y) +
      ln(tB1.x, tB1.y, tB2.x, tB2.y) +
      `<text class="fp-dim-text" x="${r2(labelPos.x)}" y="${r2(labelPos.y)}" fill="${c}" ` +
      `text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fsz}" ` +
      `transform="rotate(${r2(ang)} ${r2(labelPos.x)} ${r2(labelPos.y)})">${lenTxt}</text>`
    );
  };

  FP.sym = S;
})(window.FP = window.FP || {});
