/* geometry.js — pure math helpers. All coordinates are in "world pixels".
   World pixels = metres * FP.SCALE. Model stores world-pixel coordinates so
   the exported SVG is 1:1 with what the editor shows.                        */
(function (FP) {
  'use strict';

  // pixels per metre — the export scale
  FP.SCALE = 100;

  const G = {};

  G.sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  G.add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  G.mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  G.dot = (a, b) => a.x * b.x + a.y * b.y;
  G.len = (a) => Math.hypot(a.x, a.y);
  G.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  G.norm = (a) => {
    const l = G.len(a) || 1;
    return { x: a.x / l, y: a.y / l };
  };
  // left-hand perpendicular (unit not guaranteed)
  G.perp = (a) => ({ x: -a.y, y: a.x });

  G.angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x); // radians
  G.deg = (rad) => (rad * 180) / Math.PI;
  G.rad = (deg) => (deg * Math.PI) / 180;

  G.rotate = (p, angleRad, origin) => {
    const o = origin || { x: 0, y: 0 };
    const c = Math.cos(angleRad), s = Math.sin(angleRad);
    const dx = p.x - o.x, dy = p.y - o.y;
    return { x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c };
  };

  G.snap = (value, grid) => (grid > 0 ? Math.round(value / grid) * grid : value);
  G.snapPoint = (p, grid) => ({ x: G.snap(p.x, grid), y: G.snap(p.y, grid) });

  G.round = (n, d = 2) => {
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  };

  // metres <-> world px
  G.toMeters = (px) => px / FP.SCALE;
  G.toPx = (m) => m * FP.SCALE;

  // closest point on segment ab to p; returns {point, t, dist}
  G.closestOnSegment = (p, a, b) => {
    const ab = G.sub(b, a);
    const l2 = G.dot(ab, ab);
    let t = l2 === 0 ? 0 : G.dot(G.sub(p, a), ab) / l2;
    t = Math.max(0, Math.min(1, t));
    const point = G.add(a, G.mul(ab, t));
    return { point, t, dist: G.dist(p, point) };
  };

  // nearest point across a polyline (array of points); returns {point,dist,angle,segIndex}
  // pass closed=true to also test the segment from the last point back to the first
  G.closestOnPolyline = (p, points, closed) => {
    let best = null;
    const n = points.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = points[i], b = points[(i + 1) % n];
      const r = G.closestOnSegment(p, a, b);
      if (!best || r.dist < best.dist) {
        best = { point: r.point, dist: r.dist, t: r.t, segIndex: i, angle: G.angle(a, b) };
      }
    }
    return best;
  };

  G.pointInPolygon = (p, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      const intersect =
        yi > p.y !== yj > p.y &&
        p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  G.polygonCentroid = (poly) => {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
      a += cross;
      cx += (poly[j].x + poly[i].x) * cross;
      cy += (poly[j].y + poly[i].y) * cross;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-6) {
      // fallback: average of vertices
      const s = poly.reduce((acc, q) => G.add(acc, q), { x: 0, y: 0 });
      return G.mul(s, 1 / poly.length);
    }
    return { x: cx / (6 * a), y: cy / (6 * a) };
  };

  G.bounds = (points) => {
    if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  };

  // build an SVG path string from points
  G.pathData = (points, close) => {
    if (!points.length) return '';
    let d = 'M ' + G.round(points[0].x, 2) + ' ' + G.round(points[0].y, 2);
    for (let i = 1; i < points.length; i++) {
      d += ' L ' + G.round(points[i].x, 2) + ' ' + G.round(points[i].y, 2);
    }
    if (close) d += ' Z';
    return d;
  };

  // convert a length in world px to a nicely formatted metre string
  G.fmtMeters = (px) => (px / FP.SCALE).toFixed(2) + ' m';

  // turn an arbitrary label into an entity-id-safe slug
  G.slug = (s) =>
    (s || '')
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unnamed';

  FP.geom = G;
})(window.FP = window.FP || {});
