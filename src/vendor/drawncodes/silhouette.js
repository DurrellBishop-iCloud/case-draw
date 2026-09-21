// Drawn Codes web — silhouette: the model is the real geometry; this
// module derives a watertight vector outline from it at any precision.
//
// Pipeline: rasterize the layer's ink sources into a coverage field
// (samples per cell = the precision parameter), blur it slightly (a
// morphological closing — seals sub-stroke gaps, rounds concave nicks),
// then trace the 50% iso-contour with marching squares. The result is
// closed vector loops (outer boundaries and holes) in cell units —
// drawable with even-odd fill, exportable to SVG, extrudable to 3D.
// Slivers and staircase artifacts are unrepresentable: there is one
// continuous field and one contour, not pieces with seams.

import { computeFill, buildInk, STROKE } from './engine.js?v=w025';

export const BLUR_CELLS = 0.09;

/**
 * Trace a model's silhouette. Returns { loops, path } where loops is an
 * array of closed [x,y] rings in cell units (cell centres on integers)
 * and path is a ready Path2D (even-odd). Null for an empty model.
 */
export function traceSilhouette(model, fill, samplesPerCell = 16, iso = 127.5) {
  const b = model.bounds();
  if (!b) return null;
  const S = samplesPerCell;
  const margin = 1.5;   // room for caps, diamonds and the blur
  const x0 = b.minC - margin, y0 = b.minR - margin;
  const W = Math.round((b.maxC - b.minC + 2 * margin + 1) * S);
  const H = Math.round((b.maxR - b.minR + 2 * margin + 1) * S);

  // ---- rasterize ink sources into a coverage field -------------------
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(S, 0, 0, S, (-x0 + 0.5) * S, (-y0 + 0.5) * S);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  if (fill) drawFillField(ctx, fill);
  const ink = buildInk(model);
  ctx.lineWidth = STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(ink.strokes);
  ctx.fill(ink.fills);

  const img = ctx.getImageData(0, 0, W, H).data;
  let field = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) field[i] = img[i * 4 + 3];   // alpha

  // ---- closing: 3× box blur ≈ gaussian --------------------------------
  const r = Math.max(1, Math.round(BLUR_CELLS * S / 1.7));
  for (let pass = 0; pass < 3; pass++) {
    field = boxBlurH(field, W, H, r);
    field = boxBlurV(field, W, H, r);
  }

  // ---- marching squares at iso = 127.5 --------------------------------
  const loops = marchingSquares(field, W, H, iso).map(chaikin);

  const path = new Path2D();
  for (const loop of loops) {
    // convert sample coords → cell units
    path.moveTo(loop[0][0] / S + x0 - 0.5, loop[0][1] / S + y0 - 0.5);
    for (let i = 1; i < loop.length; i++) {
      path.lineTo(loop[i][0] / S + x0 - 0.5, loop[i][1] / S + y0 - 0.5);
    }
    path.closePath();
  }
  const cellLoops = loops.map((loop) =>
    loop.map(([px, py]) => [px / S + x0 - 0.5, py / S + y0 - 0.5]));
  return { loops: cellLoops, path };
}

/** One round of Chaikin corner-cutting: halves sampling facets. */
function chaikin(loop) {
  const out = [];
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % loop.length];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  return out;
}

function drawFillField(ctx, fill) {
  const hs = 0.5;
  for (let y = 0; y < fill.hh; y++) {
    for (let x = 0; x < fill.hw; x++) {
      const st = fill.state[y * fill.hw + x];
      if (st === 0) continue;
      const left = (fill.originHalfC + x) * hs - 0.5;
      const top = (fill.originHalfR + y) * hs - 0.5;
      if (st === 1) {
        ctx.fillRect(left, top, hs, hs);
      } else {
        ctx.beginPath();
        const rgt = left + hs, bot = top + hs;
        if ((x & 1) === (y & 1)) {
          if (st === 2) { ctx.moveTo(left, top); ctx.lineTo(rgt, top); ctx.lineTo(rgt, bot); }
          else { ctx.moveTo(left, top); ctx.lineTo(left, bot); ctx.lineTo(rgt, bot); }
        } else {
          if (st === 2) { ctx.moveTo(left, top); ctx.lineTo(rgt, top); ctx.lineTo(left, bot); }
          else { ctx.moveTo(rgt, top); ctx.lineTo(rgt, bot); ctx.lineTo(left, bot); }
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function boxBlurH(src, w, h, r) {
  const out = new Float32Array(w * h);
  const div = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      out[row + x] = sum / div;
      sum += src[row + Math.min(w - 1, x + r + 1)];
      sum -= src[row + Math.max(0, x - r)];
    }
  }
  return out;
}

function boxBlurV(src, w, h, r) {
  const out = new Float32Array(w * h);
  const div = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / div;
      sum += src[Math.min(h - 1, y + r + 1) * w + x];
      sum -= src[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Marching squares with edge-id stitching: each iso crossing lives on a
// lattice edge; per-cell segments join crossings, and loops are stitched
// by following shared edge ids — exact, no floating-point matching.
function marchingSquares(field, W, H, iso) {
  const val = (x, y) => field[y * W + x];
  // edge ids: horizontal edge (between (x,y)-(x+1,y)): 'h' + index;
  // vertical edge (between (x,y)-(x,y+1)): 'v' + index
  const hId = (x, y) => 2 * (y * W + x);
  const vId = (x, y) => 2 * (y * W + x) + 1;

  const points = new Map();   // edge id -> [px, py]
  const crossH = (x, y) => {
    const id = hId(x, y);
    let p = points.get(id);
    if (!p) {
      const a = val(x, y), b = val(x + 1, y);
      p = [x + (iso - a) / (b - a), y];
      points.set(id, p);
    }
    return id;
  };
  const crossV = (x, y) => {
    const id = vId(x, y);
    let p = points.get(id);
    if (!p) {
      const a = val(x, y), b = val(x, y + 1);
      p = [x, y + (iso - a) / (b - a)];
      points.set(id, p);
    }
    return id;
  };

  // adjacency: edge id -> list of connected edge ids (each cell adds one
  // or two crossing-pair segments)
  const links = new Map();
  const link = (a, b) => {
    let la = links.get(a); if (!la) links.set(a, la = []);
    let lb = links.get(b); if (!lb) links.set(b, lb = []);
    la.push(b); lb.push(a);
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = val(x, y) >= iso ? 8 : 0;
      const tr = val(x + 1, y) >= iso ? 4 : 0;
      const br = val(x + 1, y + 1) >= iso ? 2 : 0;
      const bl = val(x, y + 1) >= iso ? 1 : 0;
      const c = tl | tr | br | bl;
      if (c === 0 || c === 15) continue;
      const top = () => crossH(x, y);
      const bottom = () => crossH(x, y + 1);
      const left = () => crossV(x, y);
      const right = () => crossV(x + 1, y);
      switch (c) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(top(), left()); break;
        case 5:   // ambiguous saddles: resolve by the centre sample
        case 10: {
          const centre = (val(x, y) + val(x + 1, y) + val(x, y + 1) + val(x + 1, y + 1)) / 4;
          const centreIn = centre >= iso;
          // c=5: inside corners are TR+BL; c=10: TL+BR. If the centre is
          // inside, the inside diagonal is connected and the two contour
          // arcs hug the OUTSIDE corners — and vice versa.
          const hugTLBR = (c === 5) === centreIn;
          if (hugTLBR) { link(top(), left()); link(bottom(), right()); }
          else { link(top(), right()); link(bottom(), left()); }
          break;
        }
      }
    }
  }

  // stitch loops
  const loops = [];
  const usedPairs = new Set();
  const pairKey = (a, b) => a < b ? a + ':' + b : b + ':' + a;
  for (const [start, nbrs] of links) {
    for (const first of nbrs) {
      if (usedPairs.has(pairKey(start, first))) continue;
      const loop = [points.get(start)];
      let prev = start, cur = first;
      usedPairs.add(pairKey(prev, cur));
      let guard = 0;
      while (cur !== start && guard++ < 1e6) {
        loop.push(points.get(cur));
        const nexts = links.get(cur) || [];
        let next = -1;
        for (const cand of nexts) {
          if (cand !== prev && !usedPairs.has(pairKey(cur, cand))) { next = cand; break; }
        }
        if (next < 0) break;
        usedPairs.add(pairKey(cur, next));
        prev = cur; cur = next;
      }
      // only closed walks count — a partial would close across a chord
      if (cur === start && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}
