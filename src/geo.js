/* Case Draw geometry: strokes -> clean 2D regions -> extruded meshes -> 3MF.
   Works in the browser (globals earcut, polygonClipping) and in Node (require). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("earcut"), require("polygon-clipping"));
  else root.CaseGeo = factory(root.earcut, root.polygonClipping);
})(typeof self !== "undefined" ? self : this, function (earcut, pc) {
  "use strict";

  // ---------- 2D helpers ----------
  function circle(cx, cy, r, n) {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    ring.push(ring[0]);
    return [ring];
  }
  function roundedRect(w, h, r, segs) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const ring = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= segs; i++) {
        const a = a0 + (i / segs) * (Math.PI / 2);
        ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    corner(w - r, h - r, 0);
    corner(r, h - r, Math.PI / 2);
    corner(r, r, Math.PI);
    corner(w - r, r, 1.5 * Math.PI);
    ring.push(ring[0]);
    return [ring];
  }
  // Phone outline offset outward by o (negative = inset). Corner centres stay fixed; radius becomes R+o.
  function phoneOutline(spec, o, segs) {
    const W = spec.width, L = spec.length;
    const R = Math.max(0.01, Math.min(spec.cornerRadius, W / 2, L / 2));
    const r = R + o;
    if (r <= 0) throw new Error("outline offset smaller than the corner radius");
    const ring = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= segs; i++) {
        const a = a0 + (i / segs) * (Math.PI / 2);
        ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    corner(W - R, L - R, 0);
    corner(R, L - R, Math.PI / 2);
    corner(R, R, Math.PI);
    corner(W - R, R, 1.5 * Math.PI);
    ring.push(ring[0]);
    return [ring];
  }
  function segmentQuad(a, b, hw) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    const nx = (-dy / len) * hw, ny = (dx / len) * hw;
    const ring = [
      [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]
    ];
    ring.push(ring[0]);
    return [ring];
  }
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let maxD = -1, idx = -1;
      const ax = pts[s][0], ay = pts[s][1], bx = pts[e][0], by = pts[e][1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      for (let i = s + 1; i < e; i++) {
        let d;
        if (l2 === 0) d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
        else {
          let t = ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
        }
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function bbox(mp) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of mp) for (const ring of poly) for (const p of ring) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  }
  // Snap coordinates to a 1 µm grid: keeps repeated boolean ops numerically stable.
  function snap(mp) { return mp.map(poly => poly.map(ring => ring.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]))); }
  // polygon-clipping can throw ("Unable to find segment", "Unable to complete output ring") when edges nearly
  // coincide. Inputs go in snapped to the same 1 µm grid as the outputs; if it still throws, retry on coarser
  // grids (10 µm, 50 µm: far below what a printer resolves) before giving up.
  const snapTo = (m, g) => {
    const f = ring => ring.map(p => [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g]);
    return typeof m[0][0][0] === "number" ? m.map(f) : m.map(poly => poly.map(f));
  };
  const robust = fn => (...args) => {
    let err;
    for (const g of [1e-3, 1e-2, 5e-2]) {
      try { return snap(fn(...args.map(m => snapTo(m, g)))); } catch (e) { err = e; }
    }
    throw err;
  };
  const U = robust((...a) => pc.union(...a)), I = robust((a, b) => pc.intersection(a, b)), D = robust((a, ...b) => pc.difference(a, ...b));
  const has = m => m && m.length;
  const ops = {
    union: (...a) => { a = a.filter(has); return a.length ? U(...a) : []; },
    intersection: (a, b) => has(a) && has(b) ? I(a, b) : [],
    difference: (a, ...b) => { if (!has(a)) return []; b = b.filter(has); return b.length ? D(a, ...b) : U(a); }
  };
  // Drop slivers (rings under minA mm²) that boolean ops leave where edges nearly coincide; they can't print
  // and the triangulator can't cap them, which leaves the mesh open.
  function clean(mp, minA) {
    minA = minA || 0.02;
    const area = r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a / 2); };
    // net area too: snapping can leave a polygon whose hole is the whole of it
    return mp.filter(poly => area(poly[0]) - poly.slice(1).reduce((t, h) => t + area(h), 0) >= minA)
      .map(poly => [poly[0], ...poly.slice(1).filter(h => area(h) >= minA)]);
  }
  function bboxHit(a, b) { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; }

  // One stroke -> a single clean MultiPolygon (union of capsules).
  function strokeRegion(stroke) {
    const hw = stroke.w / 2;
    const pts = simplify(stroke.pts, 0.08);
    const n = Math.max(10, Math.min(36, Math.round(hw * 10)));
    const polys = [];
    if (pts.length === 1) return ops.union(circle(pts[0][0], pts[0][1], hw, n));
    for (let i = 0; i < pts.length; i++) {
      polys.push(circle(pts[i][0], pts[i][1], hw, n));
      if (i < pts.length - 1) { const q = segmentQuad(pts[i], pts[i + 1], hw); if (q) polys.push(q); }
    }
    return ops.union(...polys);
  }

  // ---------- paint partition (cached) ----------
  let cellCache = { ref: null, len: -1, inks: -1, cells: [] };
  function paintCells(strokes, inkCount) {
    if (cellCache.ref === strokes && cellCache.len === strokes.length && cellCache.inks === inkCount) return cellCache.cells;
    let cells = []; // { ink, chain, region, bbox }
    for (const st of strokes) {
      if (!(st.c >= 0 && st.c < inkCount)) continue;
      const S = strokeRegion(st), sb = bbox(S);
      let remaining = S;
      const next = [];
      for (const C of cells) {
        if (!remaining.length || !bboxHit(sb, C.bbox)) { next.push(C); continue; }
        let overlap, rest;
        try { overlap = ops.intersection(C.region, S); }
        catch (e) { next.push(C); continue; }               // numerically awkward pair: leave that cell as it was
        if (!overlap.length) { next.push(C); continue; }
        if (C.ink === st.c) { next.push(C); try { remaining = ops.difference(remaining, C.region); } catch (e) {} continue; }
        try { rest = ops.difference(C.region, S); } catch (e) { rest = []; }
        if (rest.length) next.push({ ink: C.ink, chain: C.chain, region: rest, bbox: bbox(rest) });
        next.push({ ink: st.c, chain: C.chain.concat(st.c), region: overlap, bbox: bbox(overlap) });
        try { remaining = ops.difference(remaining, overlap); } catch (e) { remaining = []; }
      }
      if (remaining.length) next.push({ ink: st.c, chain: [st.c], region: remaining, bbox: bbox(remaining) });
      cells = next;
    }
    cellCache = { ref: strokes, len: strokes.length, inks: inkCount, cells };
    return cells;
  }
  // Everything drawn, whatever the colour, as one region straight from the strokes: no seams where colours meet.
  let allCache = {};
  function allInkRegion(strokes, inkCount) {
    if (allCache.ref === strokes && allCache.len === strokes.length && allCache.inks === inkCount) return allCache.region;
    const rs = strokes.filter(st => st.c >= 0 && st.c < inkCount).map(strokeRegion);
    const region = rs.length ? ops.union(...rs) : [];
    allCache = { ref: strokes, len: strokes.length, inks: inkCount, region };
    return region;
  }

  // ---------- regions ----------
  // Returns { plate: MultiPolygon (with cutout holes), inks: [MultiPolygon per ink] } in design coords (mm, y down).
  // Panel: a flat plate the size of the whole case back, glued to the body. Same outline everywhere.
  function plateOffsets(spec) {
    const o = (spec.phoneClearance || 0) + spec.frameWall;
    return { wide: o, narrow: o, skin: o };
  }
  function plateLevels(spec) {
    const skinT = spec.panelThickness || spec.skinThickness || 1.0;
    return { skinT, total: skinT };
  }
  // A back cutout grown by `grow` beyond its clearance: a circle { x, y, d } or a rounded rectangle
  // { x, y, w, h, r } (x, y = centre), e.g. the Phone (3)'s camera island.
  function cutShape(spec, c, grow) {
    const k = (spec.cutoutClearance || 0) / 2 + (grow || 0);
    if (c.w) {
      const w = c.w + 2 * k, h = c.h + 2 * k;
      return [roundedRect(w, h, (c.r || 0) + k, 12)[0].map(p => [p[0] + c.x - w / 2, p[1] + c.y - h / 2])].map(r => [r]);
    }
    return circle(c.x, c.y, c.d / 2 + k, 48);
  }
  const cutRing = (spec, c, wall) => ops.difference(cutShape(spec, c, wall), cutShape(spec, c, 0));
  function throughOn(design) { return design.caseStyle === "extrude"; }
  function collarOn(spec, design) { return spec.collars !== false && design.mode === "inlay" && spec.cutouts.length > 0; }
  function buildRegions(spec, design) {
    const off = plateOffsets(spec);
    const holes = spec.cutouts.map(c => cutShape(spec, c, 0));
    const region = (o, hs) => { const p = phoneOutline(spec, o, 16); return hs.length ? ops.difference(p, ...hs) : ops.union(p); };
    const plateRegion = region(off.narrow, holes);
    const plateWide = region(off.wide, holes);
    // inks keep clear of the plate edge and the cutouts by inkMargin
    // "Through" style: inks run to the outer edge so the drawing carries on down the case sides.
    const m = spec.inkMargin || 0, edgeM = throughOn(design) ? 0 : m;
    const inkArea = m > 0
      ? region(off.narrow - edgeM, spec.cutouts.map(c => cutShape(spec, c, m)))
      : plateRegion;

    // Height field: the plate is partitioned into cells (region, ink) by the strokes in draw order, later
    // strokes covering earlier ones. The partition depends only on the strokes, so it is cached. Each ink
    // has one height above the plate, independent of the others; 0 = pocketed flush into the skin.
    const heights = design.mode === "relief" ? design.inks.map((_, i) => Math.max(0, (design.inkHeights && design.inkHeights[i]) || 0)) : design.inks.map(() => 0);
    const r2 = v => Math.round(v * 100) / 100;
    const cells = paintCells(design.strokes, design.inks.length).map(C => ({ ink: C.ink, top: r2(heights[C.ink]), region: C.region }));
    // groups: one region per (ink, top), clipped to the ink area
    const groupMap = new Map();
    for (const C of cells) {
      const key = C.ink + "@" + C.top;
      if (!groupMap.has(key)) groupMap.set(key, { ink: C.ink, top: C.top, list: [] });
      groupMap.get(key).list.push(C.region);
    }
    const groups = [];
    for (const g of groupMap.values()) {
      const u = g.list.length === 1 ? g.list[0] : ops.union(...g.list);
      const r = ops.intersection(u, inkArea);
      if (r.length) groups.push({ ink: g.ink, top: g.top, region: r });
    }
    groups.sort((a, b) => a.ink - b.ink || a.top - b.top);
    const inks = design.inks.map((_, i) => { const l = groups.filter(g => g.ink === i).map(g => g.region); return l.length ? (l.length === 1 ? l[0] : ops.union(...l)) : []; });
    const all = allInkRegion(design.strokes, design.inks.length);
    const allInk = all.length ? ops.intersection(all, inkArea) : [];
    return { plate: plateRegion, plateWide, inks, groups, allInk, off };
  }

  // ---------- meshing ----------
  function Mesh() { this.v = []; this.t = []; }
  Mesh.prototype.addVertex = function (x, y, z) { this.v.push(x, y, z); return this.v.length / 3 - 1; };
  Mesh.prototype.addTri = function (a, b, c) { this.t.push(a, b, c); };
  Mesh.prototype.triCount = function () { return this.t.length / 3; };
  Mesh.prototype.append = function (o) { const base = this.v.length / 3; for (const x of o.v) this.v.push(x); for (const i of o.t) this.t.push(i + base); };

  function ringArea(r) {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    return a / 2;
  }
  function open(ring) { // drop closing duplicate
    const r = ring.slice();
    if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    return r;
  }

  // Drop repeated points and zero-width spikes (a point that doubles back within 2 µm): they have no area to cap,
  // so their walls would be left open. Straight-through points are kept, since another ring may touch there.
  function tidyRing(r) {
    let pts = r.slice(), changed = true;
    while (changed && pts.length >= 3) {
      changed = false;
      for (let i = 0; i < pts.length && pts.length >= 3; i++) {
        const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
        const ex = c[0] - a[0], ey = c[1] - a[1], len = Math.hypot(ex, ey);
        const dist = len < 1e-6 ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Math.abs(ex * (b[1] - a[1]) - ey * (b[0] - a[0])) / len;
        const back = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) <= 0;
        if (dist < 2e-3 && (back || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6)) { pts.splice(i, 1); i--; changed = true; }
      }
    }
    return pts;
  }
  // Rings of one polygon in model space: outer CCW, holes CW.
  function normRings(poly, xf, map) {
    return poly.map((ring, i) => {
      let r = tidyRing(open(ring)).map(p => { if (map) p = map(p); return xf(p[0], p[1]); });
      if (r.length < 3 || Math.abs(ringArea([...r, r[0]])) < 1e-3) return null;
      const area = ringArea([...r, r[0]]);
      if ((i === 0 && area < 0) || (i > 0 && area > 0)) r.reverse();
      return r;
    }).filter(Boolean);
  }
  // For a triangulation of the points in flat, returns f(a, b, c): null, or the triangle's corners with any other
  // points that lie on its edges inserted in order (earcut can bridge collinear points and leave T-junctions).
  function tJunctions(flat, tris, starts) {
    const n = flat.length / 2, G = 2, grid = new Map(), tol = 1e-4;
    // outline edges (consecutive points of a ring) are shared with the walls and stay whole; only diagonals split
    const next = new Int32Array(n);
    for (let r = 0; r < starts.length; r++) { const s0 = starts[r], s1 = r + 1 < starts.length ? starts[r + 1] : n; for (let i = s0; i < s1; i++) next[i] = i + 1 < s1 ? i + 1 : s0; }
    const cell = (x, y) => Math.floor(x / G) + "," + Math.floor(y / G);
    for (let i = 0; i < n; i++) { const k = cell(flat[2 * i], flat[2 * i + 1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
    const onEdge = (a, b) => {
      if (next[a] === b || next[b] === a) return [];
      const ax = flat[2 * a], ay = flat[2 * a + 1], bx = flat[2 * b], by = flat[2 * b + 1];
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2; if (L2 < 1e-12) return [];
      const found = [];
      const x0 = Math.floor(Math.min(ax, bx) / G), x1 = Math.floor(Math.max(ax, bx) / G), y0 = Math.floor(Math.min(ay, by) / G), y1 = Math.floor(Math.max(ay, by) / G);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) return [];
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const list = grid.get(gx + "," + gy); if (!list) continue;
        for (const i of list) {
          if (i === a || i === b) continue;
          const px = flat[2 * i], py = flat[2 * i + 1];
          const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2;
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          if (Math.abs((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / Math.sqrt(L2) > tol) continue;
          if ((px === ax && py === ay) || (px === bx && py === by)) continue;
          found.push([t, i]);
        }
      }
      return found.sort((p, q) => p[0] - q[0]).map(p => p[1]);
    };
    return (a, b, c) => {
      const e1 = onEdge(a, b), e2 = onEdge(b, c), e3 = onEdge(c, a);
      if (!e1.length && !e2.length && !e3.length) return null;
      return [a, ...e1, b, ...e2, c, ...e3];
    };
  }
  // Flat cap for a MultiPolygon at height z. up=true -> normal +z.
  function cap(mp, z, up, mesh, xf, map) {
    for (const poly of mp) {
      const rings = normRings(poly, xf, map);
      if (!rings.length) continue;
      const flat = [], holeIdx = [];
      rings.forEach((r, i) => { if (i > 0) holeIdx.push(flat.length / 2); for (const p of r) flat.push(p[0], p[1]); });
      const tris = earcut(flat, holeIdx.length ? holeIdx : undefined);
      const base = [];
      for (let i = 0; i < flat.length / 2; i++) base.push(mesh.addVertex(flat[2 * i], flat[2 * i + 1], z));
      const tj = tJunctions(flat, tris, [0, ...holeIdx]);
      // earcut gives every triangle the same winding: read it once from the total signed area, since a sliver's
      // own cross product is noise, then face every triangle (and every split piece) the same way
      let tot = 0;
      for (let i = 0; i < tris.length; i += 3) { const a = tris[i], b = tris[i + 1], c = tris[i + 2]; tot += (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]); }
      const keep = (tot > 0) === up;
      const emit = (a, b, c) => { if (keep) mesh.addTri(a, b, c); else mesh.addTri(a, c, b); };
      for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i], b = tris[i + 1], c = tris[i + 2];
        const split = tj(a, b, c);
        if (!split) { emit(base[a], base[b], base[c]); continue; }
        // a boundary point sits on an edge of this triangle: fan it so every edge is shared exactly
        const ring = split.map(k => base[k]);
        const area2 = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
        if (Math.abs(area2) < 1e-6) { for (let k = 1; k < ring.length - 1; k++) emit(ring[0], ring[k], ring[k + 1]); continue; }
        const m = mesh.addVertex((flat[2 * a] + flat[2 * b] + flat[2 * c]) / 3, (flat[2 * a + 1] + flat[2 * b + 1] + flat[2 * c + 1]) / 3, z);
        for (let k = 0; k < ring.length; k++) emit(m, ring[k], ring[(k + 1) % ring.length]);
      }
    }
  }
  // Vertical walls along every ring of a MultiPolygon. outward=true -> normals point away from the region.
  function walls(mp, z0, z1, mesh, xf, outward, topMap) {
    for (const poly of mp) {
      const botRings = normRings(poly, xf), topRings = normRings(poly, xf, topMap);
      for (let k = 0; k < botRings.length; k++) {
        const r = botRings[k], rt = topRings[k];
        const n = r.length, bot = [], top = [];
        for (let i = 0; i < n; i++) { bot.push(mesh.addVertex(r[i][0], r[i][1], z0)); top.push(mesh.addVertex(rt[i][0], rt[i][1], z1)); }
        for (let i = 0; i < n; i++) {
          const a = i, b = (i + 1) % n;
          if (outward) { mesh.addTri(bot[a], bot[b], top[b]); mesh.addTri(bot[a], top[b], top[a]); }
          else { mesh.addTri(bot[a], top[b], bot[b]); mesh.addTri(bot[a], top[a], top[b]); }
        }
      }
    }
  }
  function pointInRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  const inPoly = (p, poly) => pointInRing(p, poly[0]) && !poly.slice(1).some(h => pointInRing(p, h));
  // True when every vertex of `inner` lies strictly inside `outer` (so its rings can be used as holes of it).
  function ringsInside(outer, inner) {
    return inner.every(poly => poly.every(ring => ring.every(p => outer.some(o => inPoly(p, o)))));
  }
  // outer minus inner, assembled from the two regions' own rings rather than a fresh boolean op, so the
  // face shares exactly the vertices of the pocket walls built from `inner`. Requires ringsInside(outer, inner).
  function minusFrom(outer, inner) {
    const outers = outer.map(poly => poly[0]).concat(...inner.map(poly => poly.slice(1)));
    const holes = [].concat(...outer.map(poly => poly.slice(1))).concat(inner.map(poly => poly[0]));
    const area = r => Math.abs(ringArea(r));
    const polys = outers.map(r => [r]);
    for (const h of holes) {
      let best = -1;   // smallest outer ring containing the hole
      polys.forEach((P, i) => { if (pointInRing(h[0], P[0]) && (best < 0 || area(P[0]) < area(polys[best][0]))) best = i; });
      if (best >= 0) polys[best].push(h);
    }
    return polys;
  }
  // Simple extrusion between z0 and z1.
  function extrude(mp, z0, z1, mesh, xf, topMap) {
    cap(mp, z1, true, mesh, xf, topMap);
    cap(mp, z0, false, mesh, xf);
    walls(mp, z0, z1, mesh, xf, true, topMap);
  }
  // Slab 0..T with pockets (depth d, open at z=0) for the given regions: one closed shell.
  function extrudePocketed(mp, pockets, d, T, mesh, xf, topMap) {
    cap(mp, T, true, mesh, xf, topMap);
    walls(mp, 0, T, mesh, xf, true, topMap);
    if (!pockets.length) { cap(mp, 0, false, mesh, xf); return; }
    const pocket = ops.union(...pockets); // one region: no coincident inner walls
    cap(ringsInside(mp, pocket) ? minusFrom(mp, pocket) : ops.difference(mp, pocket), 0, false, mesh, xf);
    cap(pocket, d, false, mesh, xf);        // pocket ceiling faces down into the pocket
    walls(pocket, 0, d, mesh, xf, false);   // pocket walls face into the pocket
  }

  // ---------- parts ----------
  // Returns { parts: [{ name, color, mesh }], mode, notes }
  function buildParts(spec, design, clip) {
    const lv = plateLevels(spec);
    const K = mp => (clip && mp.length) ? ops.intersection(mp, clip) : mp;
    const d = Math.min(design.inkDepth || 0.6, lv.skinT - 0.3);
    const W = spec.width, L = spec.length;
    const regions = buildRegions(spec, design);
    if (clip) { regions.plate = K(regions.plate); regions.inks = regions.inks.map(K); regions.groups = regions.groups.map(g => ({ ...g, region: K(g.region) })).filter(g => g.region.length); }
    const parts = [], eps = 0.02;
    const inks = regions.inks.filter(r => r.length);
    const collars = collarOn(spec, design);
    const collarWall = spec.collarWall || 0.8, collarH = Math.max(0.4, (spec.slabThickness || 1.0) - 0.1);

    if (throughOn(design)) {
      // Inks run the full panel thickness: the panel edge shows the drawing, no plate-colour stripe.
      const inlay = design.mode === "inlay";
      const xf = inlay ? (x, y) => [W - x, L - y] : (x, y) => [x, L - y];
      const T = lv.skinT, used = K(regions.allInk);   // colour-blind: no seams where two inks meet
      const bare = used.length ? clean(ops.difference(regions.plate, used)) : regions.plate;
      const m = new Mesh();
      if (bare.length) extrude(bare, 0, T, m, xf);
      if (collars) for (const c of spec.cutouts) {
        const ring = K(cutRing(spec, c, collarWall));
        if (ring.length) extrude(ring, T - eps, T + collarH, m, xf);
      }
      parts.push({ name: "Panel", color: design.plateColor, mesh: m });
      let maxTop = 0;
      design.inks.forEach((col, i) => {
        const gs = inlay ? (regions.inks[i].length ? [{ top: 0, region: regions.inks[i] }] : []) : regions.groups.filter(g => g.ink === i);
        if (!gs.length) return;
        const im = new Mesh();
        for (const g of gs) { extrude(g.region, 0, T + g.top, im, xf); maxTop = Math.max(maxTop, g.top); }
        parts.push({ name: `Ink ${i + 1}`, color: col, mesh: im });
      });
      return { parts, mode: design.mode, inkDepth: T, total: T, top: T + maxTop };
    }
    if (design.mode === "inlay") {
      // Outer face on the bed. Rotate 180° about Y so the design reads correctly on the outside.
      const xf = (x, y) => [W - x, L - y];
      const m = new Mesh();
      extrudePocketed(regions.plate, regions.allInk.length ? [K(regions.allInk)] : [], d, lv.skinT, m, xf);
      if (collars) {
        // short collars round each camera hole key into the body's oversized cutouts
        for (const c of spec.cutouts) {
          const ring = K(cutRing(spec, c, collarWall));
          if (ring.length) extrude(ring, lv.skinT - eps, lv.skinT + collarH, m, xf);
        }
      }
      parts.push({ name: "Panel", color: design.plateColor, mesh: m });
      inks.forEach(r => { const i = regions.inks.indexOf(r); const im = new Mesh(); extrude(r, 0, d, im, xf); parts.push({ name: `Ink ${i + 1}`, color: design.inks[i], mesh: im }); });
      return { parts, mode: design.mode, inkDepth: d, total: lv.total, top: lv.total };
    }
    // Relief: inner face on the bed, inks on top. Each ink at its own height; 0 = pocketed flush.
    const xf = (x, y) => [x, L - y];
    const m = new Mesh();
    const top = lv.total;
    const flush = regions.groups.filter(g => g.top === 0).map(g => g.region);
    const skin = new Mesh();
    extrudePocketed(regions.plate, flush, d, lv.skinT, skin, xf);
    m.append(transformMesh(skin, p => [p[0], p[1], top - p[2]], true));
    parts.push({ name: "Panel", color: design.plateColor, mesh: m });
    let maxTop = 0;
    design.inks.forEach((col, i) => {
      const gs = regions.groups.filter(g => g.ink === i);
      if (!gs.length) return;
      const im = new Mesh();
      let allFlush = true;
      for (const g of gs) {
        if (g.top === 0) extrude(g.region, top - d, top, im, xf);
        else { extrude(g.region, top, top + g.top, im, xf); allFlush = false; maxTop = Math.max(maxTop, g.top); }
      }
      parts.push({ name: `Ink ${i + 1}${allFlush ? " (flush)" : ""}`, color: col, mesh: im });
    });
    return { parts, mode: design.mode, inkDepth: d, total: lv.total, top: top + maxTop };
  }

  // ---------- body ----------
  // One-piece case body in its own print coordinates: z=0 is the outer back face (on the bed), walls rise from it.
  function frameLevels(spec) {
    const slabT = spec.slabThickness || 1.0, c = spec.phoneClearance || 0, lipT = spec.lipThickness || 0.8;
    const zPhone = slabT + c;                       // where the phone's back rests
    const zLip = zPhone + spec.thickness;           // top of the side wall
    return { slabT, zPhone, zLip, H: zLip + lipT };
  }
  // Button windows through the wall only; inset shortens both ends (used to round the corners).
  function windowRects(spec, inset) {
    const c = spec.phoneClearance || 0, wall = spec.frameWall, W = spec.width, L = spec.length, m = c + wall + 1;
    const out = [];
    for (const k of spec.sideCutouts || []) {
      const a = Math.min(k.from, k.to) + inset, b = Math.max(k.from, k.to) - inset;
      if (b - a < 0.2) continue;
      let x0, y0, x1, y1;
      if (k.side === "left") { x0 = -m; x1 = 1; y0 = a; y1 = b; }
      else if (k.side === "right") { x0 = W - 1; x1 = W + m; y0 = a; y1 = b; }
      else if (k.side === "top") { y0 = -m; y1 = 1; x0 = a; x1 = b; }
      else { y0 = L - 1; y1 = L + m; x0 = a; x1 = b; }
      out.push([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]);
    }
    return out;
  }
  // Drawn area per ink in plan (not clipped to the panel), later strokes covering earlier ones.
  function inkPlanRegions(design) {
    const n = (design.inks || []).length, lists = Array.from({ length: n }, () => []);
    for (const C of paintCells(design.strokes || [], n)) lists[C.ink].push(C.region);
    return lists.map(l => !l.length ? [] : l.length === 1 ? l[0] : ops.union(...l));
  }
  function stripeKeys(design) {
    const list = (design.stripeColors && design.stripeColors.length) ? design.stripeColors : ["case", "ink0"];
    const ok = list.filter(k => k === "case" || k === "plate" || /^ink\d+$/.test(k));
    return ok.length ? ok : ["case"];
  }
  function keyColor(key, design) {
    if (key === "case") return design.frameColor || "#3A3A3A";
    if (key === "plate") return design.plateColor || "#F2F2EF";
    const i = parseInt(key.slice(3), 10);
    return (design.inks && design.inks[i]) || "#888888";
  }
  function keyName(key) {
    if (key === "case") return "Case";
    if (key === "plate") return "Case (panel colour)";
    return "Case ink " + (parseInt(key.slice(3), 10) + 1);
  }

  // One-piece case body. Returns { parts:[{key,name,color,mesh}], H, ... }. Styles: plain | extrude | stripes.
  function buildFrame(spec, design, clip) {
    design = design || { mode: "inlay", inks: [], strokes: [] };
    const K = mp => (clip && mp.length) ? ops.intersection(mp, clip) : mp;
    const style = design.caseStyle || "plain";
    const c = spec.phoneClearance || 0, wall = spec.frameWall, lipDepth = spec.lipDepth || 0;
    const { slabT, zPhone, zLip, H } = frameLevels(spec);
    const outer = phoneOutline(spec, c + wall, 16);
    const collars = collarOn(spec, design);
    const extra = collars ? (spec.collarWall || 0.8) + (spec.collarClearance || 0.15) : 0;
    const holes = spec.cutouts.map(k => cutShape(spec, k, extra));
    const minusHoles = mp => holes.length ? ops.difference(mp, ...holes) : mp;

    // 2D colour layouts
    let wallRuns = [{ key: "case", region: ops.difference(outer, phoneOutline(spec, c, 16)) }];
    let lipRuns = [{ key: "case", region: ops.difference(outer, phoneOutline(spec, c - lipDepth, 16)) }];
    let slabBand = null;
    if (style === "extrude") {
      // The case continues the panel straight down: colour each part of the wall by what is drawn directly above it.
      const inkPlan = inkPlanRegions(design);
      const colourBy = band => {
        const runs = [];
        inkPlan.forEach((r, i) => { if (r.length) { const x = clean(ops.intersection(band, r)); if (x.length) runs.push({ key: "ink" + i, region: x }); } });
        const used = inkPlan.filter(r => r.length);
        const bare = used.length ? clean(ops.difference(band, ...used)) : band;
        if (bare.length) runs.unshift({ key: "plate", region: bare });
        return runs;
      };
      wallRuns = colourBy(wallRuns[0].region);
      lipRuns = colourBy(lipRuns[0].region);
      slabBand = wallRuns;
    }
    const slabInterior = minusHoles(slabBand ? phoneOutline(spec, c, 16) : outer);

    // z intervals: [z0, z1, kind]  kind: slab | band | window | lip
    const r = spec.windowRadius || 0, step = 0.2, n = Math.ceil(r / step);
    const zs = [[0, slabT, "slab"], [slabT, zPhone, "band"]];
    for (let k = 0; k < n; k++) zs.push([zPhone + k * step, zPhone + (k + 1) * step, "window"]);
    zs.push([zPhone + n * step, zLip - n * step, "window"]);
    for (let k = n - 1; k >= 0; k--) zs.push([zLip - (k + 1) * step, zLip - k * step, "window"]);
    zs.push([zLip, H, "lip"]);
    let intervals = zs;
    if (style === "stripes") {
      const sKeys = stripeKeys(design), sH = Math.max(0.2, design.stripeHeight || 1);
      intervals = [];
      for (const [z0, z1, kind] of zs) {
        let z = z0;
        while (z < z1 - 1e-6) {
          const band = Math.floor(z / sH + 1e-6);
          const zn = Math.min(z1, (band + 1) * sH);
          intervals.push([z, zn, kind, sKeys[band % sKeys.length]]);
          z = zn;
        }
      }
    }

    const meshes = new Map();
    const meshFor = key => { if (!meshes.has(key)) meshes.set(key, new Mesh()); return meshes.get(key); };
    const eps = 0.02, xf = (x, y) => [x, y];
    const pieces = [];
    const windowInset = zmid => { const dz = Math.min(zmid - zPhone, zLip - zmid); return dz >= r ? 0 : r - Math.sqrt(Math.max(0, r * r - (r - dz) * (r - dz))); };
    for (const iv of intervals) {
      const [z0, z1, kind] = iv, stripeKey = iv[3];
      let runs;
      if (kind === "slab") {
        runs = [{ key: stripeKey || "case", region: slabInterior }];
        if (slabBand) for (const b of slabBand) runs.push({ key: stripeKey || b.key, region: minusHoles(b.region) });
      } else if (kind === "lip") {
        runs = lipRuns.map(b => ({ key: stripeKey || b.key, region: b.region }));
      } else {
        runs = wallRuns.map(b => ({ key: stripeKey || b.key, region: b.region }));
        if (kind === "window") {
          const w = windowRects(spec, windowInset((z0 + z1) / 2));
          if (w.length) {
            const wb = w.map(bbox);   // only cut the runs a window actually reaches, so the rest stay identical and merge
            runs = runs.map(b => { const bb = bbox(b.region); const hit = w.filter((_, i) => bboxHit(bb, wb[i])); return hit.length ? { key: b.key, region: ops.difference(b.region, ...hit) } : b; }).filter(b => b.region.length);
          }
        }
      }
      for (const b of runs) pieces.push({ key: b.key, region: b.region, z0, z1 });
    }
    // Merge a run's layers wherever its footprint doesn't change (everywhere except round the button windows),
    // so walls are one solid rather than a stack of 0.2 mm slices with coincident faces.
    const stacks = new Map();
    for (const pc of pieces) {
      const id = pc.key + "|" + JSON.stringify(pc.region);
      const st = stacks.get(id);
      const last = st && st[st.length - 1];
      if (last && Math.abs(last.z1 - pc.z0) < 1e-6) last.z1 = pc.z1;
      else if (st) st.push({ ...pc }); else stacks.set(id, [{ ...pc }]);
    }
    for (const st of stacks.values()) for (const pc of st) {
      const reg = K(pc.region);
      if (reg.length) extrude(reg, pc.z0, Math.min(pc.z1 + eps, H), meshFor(pc.key), xf);
    }
    const parts = [];
    for (const [key, mesh] of meshes) parts.push({ key, name: keyName(key), color: keyColor(key, design), mesh });
    parts.sort((a, b) => (a.key === "case" ? -1 : b.key === "case" ? 1 : a.key.localeCompare(b.key)));
    return { parts, mesh: parts.length === 1 ? parts[0].mesh : null, H, slabT, zPhone, zLip };
  }

  // Apply fn([x,y,z]) -> [x,y,z] to every vertex; flip triangle winding when the map is a reflection.
  function transformMesh(mesh, fn, flip) {
    const out = new Mesh();
    for (let i = 0; i < mesh.v.length; i += 3) { const q = fn([mesh.v[i], mesh.v[i + 1], mesh.v[i + 2]]); out.v.push(q[0], q[1], q[2]); }
    for (let i = 0; i < mesh.t.length; i += 3) { if (flip) out.t.push(mesh.t[i], mesh.t[i + 2], mesh.t[i + 1]); else out.t.push(mesh.t[i], mesh.t[i + 1], mesh.t[i + 2]); }
    return out;
  }
  // Case moved into the panel's model space so the two can be shown assembled. Returns parts.
  function frameInPlateSpace(spec, design) {
    const mode = typeof design === "string" ? design : design.mode;
    const f = buildFrame(spec, typeof design === "string" ? { mode } : design), W = spec.width, L = spec.length, lv = plateLevels(spec);
    const fn = mode === "inlay" ? p => [W - p[0], L - p[1], lv.skinT + p[2]] : p => [p[0], L - p[1], -p[2]];
    return f.parts.map(p => ({ name: p.name, color: p.color, mesh: transformMesh(p.mesh, fn, false) }));
  }

  // ---------- print set ----------
  // Case and panel as two objects in one 3MF, the panel placed beside the case.
  function buildPrintSet(spec, design) {
    const cs = buildFrame(spec, design).parts.map(p => ({ ...p, group: "case" }));
    const pp = buildParts(spec, design).parts.map(p => ({ ...p, group: "panel" }));
    const ext = (ps, k) => { let lo = Infinity, hi = -Infinity; for (const p of ps) for (let i = k; i < p.mesh.v.length; i += 3) { lo = Math.min(lo, p.mesh.v[i]); hi = Math.max(hi, p.mesh.v[i]); } return [lo, hi]; };
    const cx = ext(cs, 0), cy = ext(cs, 1), px = ext(pp, 0), py = ext(pp, 1);
    const off = [cx[1] + 10 - px[0], cy[0] - py[0], 0];
    pp.forEach(p => { p.offset = off; });
    return { parts: cs.concat(pp) };
  }

  // ---------- test coupon ----------
  // A corner of the case and the matching corner of the panel, side by side, to check lip, clearance and collar fit.
  function buildCoupon(spec, design, size) {
    size = size || 32;
    const m = (spec.phoneClearance || 0) + spec.frameWall + 0.5;
    const box = [[[[-m, -m], [size, -m], [size, size], [-m, size], [-m, -m]]]];
    const cs = buildFrame(spec, design, box).parts.map(p => ({ ...p, group: "case corner" }));
    const pp = buildParts(spec, design, box).parts.map(p => ({ ...p, group: "panel corner" }));
    // the panel's model space is mirrored relative to the case's: shift it to sit beside the case corner
    let x0 = Infinity, y0 = Infinity;
    for (const p of pp) for (let i = 0; i < p.mesh.v.length; i += 3) { x0 = Math.min(x0, p.mesh.v[i]); y0 = Math.min(y0, p.mesh.v[i + 1]); }
    const off = [size + 12 - x0, -m - y0, 0];
    pp.forEach(p => { p.offset = off; });
    return { parts: cs.concat(pp), size };
  }

  // ---------- 3MF ----------
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function f3(n) { return (Math.round(n * 1000) / 1000).toString(); }

  function modelXml(parts, title) {
    let res = "";
    res += `  <basematerials id="1">\n`;
    parts.forEach(p => { res += `    <base name="${esc(p.name)}" displaycolor="${esc(p.color)}FF"/>\n`; });
    res += `  </basematerials>\n`;
    const groups = [...new Set(parts.map(p => p.group || ""))];
    parts.forEach((p, i) => {
      const id = 10 + i;
      res += `  <object id="${id}" name="${esc(p.name)}" type="model" pid="1" pindex="${i}">\n   <mesh>\n    <vertices>\n`;
      const v = p.mesh.v;
      for (let k = 0; k < v.length; k += 3) res += `     <vertex x="${f3(v[k])}" y="${f3(v[k + 1])}" z="${f3(v[k + 2])}"/>\n`;
      res += `    </vertices>\n    <triangles>\n`;
      const t = p.mesh.t;
      for (let k = 0; k < t.length; k += 3) res += `     <triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>\n`;
      res += `    </triangles>\n   </mesh>\n  </object>\n`;
    });
    let items = "";
    groups.forEach((g, gi) => {
      const groupId = 10 + parts.length + gi;
      const name = g ? `${title} — ${g}` : title;
      res += `  <object id="${groupId}" name="${esc(name)}" type="model">\n   <components>\n`;
      parts.forEach((p, i) => { if ((p.group || "") === g) res += `    <component objectid="${10 + i}"/>\n`; });
      res += `   </components>\n  </object>\n`;
      const off = (parts.find(p => (p.group || "") === g) || {}).offset || [0, 0, 0];
      items += `  <item objectid="${groupId}" transform="1 0 0 0 1 0 0 0 1 ${f3(off[0])} ${f3(off[1])} ${f3(off[2])}"/>\n`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Title">${esc(title)}</metadata>
 <metadata name="Application">Case Draw</metadata>
 <resources>
${res} </resources>
 <build>
${items} </build>
</model>
`;
  }

  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;
  const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

  // Minimal ZIP writer (stored, no compression)
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) { // files: [{ name, data: Uint8Array }]
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255];
    const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const head = new Uint8Array([
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0x21), ...u16(0x5B21),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)
      ]);
      chunks.push(head, name, data);
      central.push(new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0x21), ...u16(0x5B21),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
      ]), name);
      offset += head.length + name.length + data.length;
    }
    const cdStart = offset;
    let cdLen = 0;
    for (const c of central) { chunks.push(c); cdLen += c.length; }
    chunks.push(new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(cdLen), ...u32(cdStart), ...u16(0)
    ]));
    let total = 0; for (const c of chunks) total += c.length;
    const out = new Uint8Array(total); let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  function to3MF(parts, title) {
    const enc = new TextEncoder();
    return zip([
      { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
      { name: "_rels/.rels", data: enc.encode(RELS) },
      { name: "3D/3dmodel.model", data: enc.encode(modelXml(parts, title)) }
    ]);
  }

  return { buildPrintSet, buildCoupon, zipFiles: zip, buildRegions, buildParts, buildFrame, plateLevels, frameInPlateSpace, transformMesh, frameLevels, plateOffsets, phoneOutline, to3MF, simplify, extrude, extrudePocketed, Mesh };
});
