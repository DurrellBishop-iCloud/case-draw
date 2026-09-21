// Drawn Codes web — engine: sparse grid model, enclosure fill, path tracing.
// A 1:1 port of the Android app's GridModel / FillEngine / PathInk.
// Cells hold 8 connection bits (4 orthogonal + 4 diagonal) plus TOUCHED;
// coordinates are signed — the canvas is unbounded.

export const UP = 8, RIGHT = 4, DOWN = 2, LEFT = 1;
export const TOUCHED = 16;
export const UR = 32, DR = 64, DL = 128, UL = 256;
export const ORTHO_MASK = 15;
export const DIAG_MASK = UR | DR | DL | UL;
export const SHAPE_MASK = ORTHO_MASK | DIAG_MASK;

const key = (r, c) => r + ',' + c;

export class GridModel {
  constructor() {
    this.cells = new Map();     // "r,c" -> code
    this.undoStack = [];
    this.version = 0;
  }
  get(r, c) { return this.cells.get(key(r, c)) || 0; }
  get isEmpty() { return this.cells.size === 0; }
  put(r, c, code) {
    if (code === 0) this.cells.delete(key(r, c));
    else this.cells.set(key(r, c), code);
    this.version++;
  }
  forEach(fn) {
    for (const [k, code] of this.cells) {
      const i = k.indexOf(',');
      fn(parseInt(k.slice(0, i)), parseInt(k.slice(i + 1)), code);
    }
  }
  bounds() {
    if (this.cells.size === 0) return null;
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    this.forEach((r, c) => {
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
    });
    return { minR, maxR, minC, maxC };
  }
  touch(r, c) { this.put(r, c, this.get(r, c) | TOUCHED); }
  connect(r0, c0, r1, c1) {
    let a, b;
    if (r1 === r0 - 1 && c1 === c0) { a = UP; b = DOWN; }
    else if (r1 === r0 + 1 && c1 === c0) { a = DOWN; b = UP; }
    else if (c1 === c0 + 1 && r1 === r0) { a = RIGHT; b = LEFT; }
    else if (c1 === c0 - 1 && r1 === r0) { a = LEFT; b = RIGHT; }
    else return;
    this.put(r0, c0, this.get(r0, c0) | a | TOUCHED);
    this.put(r1, c1, this.get(r1, c1) | b | TOUCHED);
  }
  connectDiagonal(r0, c0, r1, c1) {
    let a, b;
    if (r1 === r0 - 1 && c1 === c0 + 1) { a = UR; b = DL; }
    else if (r1 === r0 + 1 && c1 === c0 + 1) { a = DR; b = UL; }
    else if (r1 === r0 + 1 && c1 === c0 - 1) { a = DL; b = UR; }
    else if (r1 === r0 - 1 && c1 === c0 - 1) { a = UL; b = DR; }
    else return;
    this.put(r0, c0, this.get(r0, c0) | a | TOUCHED);
    this.put(r1, c1, this.get(r1, c1) | b | TOUCHED);
  }
  erase(r, c) {
    this.put(r, c, 0);
    this.put(r - 1, c, this.get(r - 1, c) & ~DOWN);
    this.put(r + 1, c, this.get(r + 1, c) & ~UP);
    this.put(r, c - 1, this.get(r, c - 1) & ~RIGHT);
    this.put(r, c + 1, this.get(r, c + 1) & ~LEFT);
    this.put(r - 1, c + 1, this.get(r - 1, c + 1) & ~DL);
    this.put(r + 1, c + 1, this.get(r + 1, c + 1) & ~UL);
    this.put(r + 1, c - 1, this.get(r + 1, c - 1) & ~UR);
    this.put(r - 1, c - 1, this.get(r - 1, c - 1) & ~DR);
  }
  clear() { this.cells.clear(); this.version++; }
  pushUndo() {
    this.undoStack.push(new Map(this.cells));
    if (this.undoStack.length > 60) this.undoStack.shift();
  }
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.cells = prev;
    this.version++;
    return true;
  }
  serialize() {
    const out = [];
    this.forEach((r, c, code) => out.push([r, c, code]));
    return out;
  }
  restore(list) {
    this.cells.clear();
    for (const [r, c, code] of list) this.cells.set(key(r, c), code);
    this.version++;
  }
}

// ---- enclosure fill --------------------------------------------------
// Orthogonal stroke arms block a half-cell lattice; 45° strokes cut one
// half-cell per linked cell into two triangle nodes. Flood regions, walk
// nesting depth from the outside, fill odd depths; absorb white pockets
// smaller than a one-cell hole. Result: per half-cell state
// 0 none, 1 full, 2 triangle t0, 3 triangle t1.

export function computeFill(model) {
  const b = model.bounds();
  if (!b) return null;
  const originR = b.minR - 1, originC = b.minC - 1;
  const hw = (b.maxC - b.minC + 3) * 2, hh = (b.maxR - b.minR + 3) * 2;
  const n = hw * hh;

  const code = (y, x) => model.get(originR + (y >> 1), originC + (x >> 1));
  const cutBit = (y, x) => {
    const top = (y & 1) === 0, left = (x & 1) === 0;
    return top && left ? UL : top ? UR : left ? DL : DR;
  };
  const isCut = (y, x) => (code(y, x) & cutBit(y, x)) !== 0;
  const nodeAt = (y, x, border) => {   // border: 0=N 1=E 2=S 3=W
    const i = y * hw + x;
    if (!isCut(y, x)) return 2 * i;
    const t0 = (x & 1) === (y & 1) ? (border === 0 || border === 1)
                                   : (border === 0 || border === 3);
    return t0 ? 2 * i : 2 * i + 1;
  };
  const blockedDown = (y, x) =>
    (y & 1) === 0 && (code(y, x) & ((x & 1) === 0 ? LEFT : RIGHT)) !== 0;
  const blockedRight = (y, x) =>
    (x & 1) === 0 && (code(y, x) & ((y & 1) === 0 ? UP : DOWN)) !== 0;

  const parent = new Int32Array(2 * n);
  for (let i = 0; i < 2 * n; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const crossings = [];
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    if (x < hw - 1) {
      const a = nodeAt(y, x, 1), bb = nodeAt(y, x + 1, 3);
      if (blockedRight(y, x)) crossings.push(a, bb); else union(a, bb);
    }
    if (y < hh - 1) {
      const a = nodeAt(y, x, 2), bb = nodeAt(y + 1, x, 0);
      if (blockedDown(y, x)) crossings.push(a, bb); else union(a, bb);
    }
    if (isCut(y, x)) {
      const i = y * hw + x;
      crossings.push(2 * i, 2 * i + 1);
    }
  }

  const regionIds = new Map();
  const area = [];
  const rid = (root) => {
    let id = regionIds.get(root);
    if (id === undefined) { id = area.length; area.push(0); regionIds.set(root, id); }
    return id;
  };
  const nodeRegion = new Int32Array(2 * n).fill(-1);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = y * hw + x;
    const r0 = rid(find(2 * i));
    nodeRegion[2 * i] = r0; area[r0]++;
    if (isCut(y, x)) {
      const r1 = rid(find(2 * i + 1));
      nodeRegion[2 * i + 1] = r1; area[r1]++;
    }
  }

  const adj = area.map(() => new Set());
  for (let k = 0; k < crossings.length; k += 2) {
    const a = nodeRegion[crossings[k]], bb = nodeRegion[crossings[k + 1]];
    if (a !== bb) { adj[a].add(bb); adj[bb].add(a); }
  }

  const depth = new Int32Array(area.length).fill(-1);
  const outside = nodeRegion[0];
  depth[outside] = 0;
  const queue = [outside];
  for (let qi = 0; qi < queue.length; qi++) {
    const a = queue[qi];
    for (const bb of adj[a]) if (depth[bb] === -1) {
      depth[bb] = depth[a] + 1;
      queue.push(bb);
    }
  }
  const filled = (rg) => {
    const d = depth[rg];
    return d > 0 && (d % 2 === 1 || area[rg] <= 3);
  };

  const state = new Uint8Array(n);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = y * hw + x;
    const f0 = filled(nodeRegion[2 * i]);
    if (!isCut(y, x)) state[i] = f0 ? 1 : 0;
    else {
      const f1 = filled(nodeRegion[2 * i + 1]);
      state[i] = f0 && f1 ? 1 : f0 ? 2 : f1 ? 3 : 0;
    }
  }
  return { originHalfR: originR * 2, originHalfC: originC * 2, hw, hh, state };
}

// ---- skeleton-stroke path tracing ------------------------------------
// The model graph (cell centres = nodes, bits = edges) is traced into
// routes: edge-ends pair at each node by straightest continuation, every
// route corner is rounded with a half-cell arc, and routes are stroked
// with a thick round pen. Junction crooks get tile-language fillets.
// Coordinates: cell units, cell centres on integers (x=col, y=row).

export const STROKE = 0.5;
const CORNER_RADIUS = 0.5;
const DIAMOND = 0.36;
const V = STROKE / 2;

export function buildInk(model) {
  const ax = [], ay = [], bx = [], by = [];
  model.forEach((r, c, code) => {
    if (code & RIGHT) { ax.push(c); ay.push(r); bx.push(c + 1); by.push(r); }
    if (code & DOWN) { ax.push(c); ay.push(r); bx.push(c); by.push(r + 1); }
    if (code & DR) { ax.push(c); ay.push(r); bx.push(c + 1); by.push(r + 1); }
    if (code & DL) { ax.push(c); ay.push(r); bx.push(c - 1); by.push(r + 1); }
  });
  const n = ax.length;
  const nodeX = (e, s) => s === 0 ? ax[e] : bx[e];
  const nodeY = (e, s) => s === 0 ? ay[e] : by[e];
  const endId = (e, s) => e * 2 + s;

  const incident = new Map();   // "x,y" -> [endId...]
  for (let e = 0; e < n; e++) {
    for (const s of [0, 1]) {
      const k = nodeX(e, s) + ',' + nodeY(e, s);
      let list = incident.get(k);
      if (!list) incident.set(k, list = []);
      list.push(endId(e, s));
    }
  }
  const angleOf = (id) => {
    const e = id >> 1, s = id & 1;
    const dx = nodeX(e, 1 - s) - nodeX(e, s);
    const dy = nodeY(e, 1 - s) - nodeY(e, s);
    return Math.atan2(dy, dx) * 180 / Math.PI;
  };

  const partner = new Map();
  for (const ends of incident.values()) {
    if (ends.length < 2) continue;
    const cands = [];
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      let d = Math.abs(angleOf(ends[i]) - angleOf(ends[j])) % 360;
      if (d > 180) d = 360 - d;
      const dev = 180 - d;
      if (dev <= 90.5) cands.push([dev, ends[i], ends[j]]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const used = new Set();
    for (const [, e1, e2] of cands) {
      if (used.has(e1) || used.has(e2)) continue;
      used.add(e1); used.add(e2);
      partner.set(e1, e2); partner.set(e2, e1);
    }
  }

  const visited = new Uint8Array(n);
  const strokes = new Path2D();
  const walk = (startEdge, startSide) => {
    const pts = [[nodeX(startEdge, startSide), nodeY(startEdge, startSide)]];
    let e = startEdge, s = startSide;
    for (;;) {
      visited[e] = 1;
      pts.push([nodeX(e, 1 - s), nodeY(e, 1 - s)]);
      const next = partner.get(endId(e, 1 - s));
      if (next === undefined) break;
      const ne = next >> 1;
      if (visited[ne]) break;
      e = ne; s = next & 1;
    }
    return pts;
  };
  const gapAbs = (a, b) => {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };
  // Tangent merge: a branch meeting other ink at a shallow angle doesn't
  // stop at the node — it continues one edge ALONG the neighbour (a 45°
  // deviation), and the corner arc turns that into a railway-switch merge
  // whose outer sweep fills what would otherwise be a sharp 45° crook.
  const mergePoint = (endEdge, endSide) => {
    const id = endId(endEdge, endSide);
    const k = nodeX(endEdge, endSide) + ',' + nodeY(endEdge, endSide);
    const ends = incident.get(k) || [];
    const aB = (angleOf(id) + 360) % 360;
    let best = null;
    for (const m of ends) {
      if (m === id) continue;
      if (Math.round(gapAbs((angleOf(m) + 360) % 360, aB)) !== 135) continue;
      if (best === null || (partner.has(m) && !partner.has(best))) best = m;
    }
    if (best === null) return null;
    const me = best >> 1, ms = best & 1;
    return [nodeX(me, 1 - ms), nodeY(me, 1 - ms)];
  };
  for (let e = 0; e < n; e++) {
    if (visited[e]) continue;
    let startSide = -1;
    if (partner.get(endId(e, 0)) === undefined) startSide = 0;
    else if (partner.get(endId(e, 1)) === undefined) startSide = 1;
    if (startSide < 0) continue;
    const pts = walk(e, startSide);
    const head = mergePoint(e, startSide);
    if (head) pts.unshift(head);
    // the walk's far end: find the arriving edge-end without a partner
    // (last edge in the traversal) and extend past it too
    let le = e, ls = startSide;
    {
      let ce = e, cs = startSide;
      for (;;) {
        const next = partner.get(endId(ce, 1 - cs));
        if (next === undefined) { le = ce; ls = 1 - cs; break; }
        const ne = next >> 1;
        if (ne === ce || !visited[ne]) { le = ce; ls = 1 - cs; break; }
        const cont = next;
        const contE = cont >> 1, contS = cont & 1;
        if (contE === e && contS === startSide) { le = ce; ls = 1 - cs; break; }
        ce = contE; cs = contS;
        if (partner.get(endId(ce, 1 - cs)) === undefined) { le = ce; ls = 1 - cs; break; }
      }
    }
    const tail = mergePoint(le, ls);
    if (tail && (pts.length < 2 ||
        tail[0] !== pts[pts.length - 2][0] || tail[1] !== pts[pts.length - 2][1])) {
      pts.push(tail);
    }
    appendRounded(strokes, pts, false);
  }
  for (let e = 0; e < n; e++) {
    if (!visited[e]) appendRounded(strokes, walk(e, 0), true);
  }

  // fills: junction fillets, diamonds, dots
  const fills = new Path2D();
  for (const [k, ends] of incident) {
    if (ends.length < 2) continue;
    const ci = k.indexOf(',');
    const nx = parseInt(k.slice(0, ci)), ny = parseInt(k.slice(ci + 1));
    const sorted = [...ends].sort((a, b) =>
      ((angleOf(a) + 360) % 360) - ((angleOf(b) + 360) % 360));
    for (let i = 0; i < sorted.length; i++) {
      const e1 = sorted[i], e2 = sorted[(i + 1) % sorted.length];
      if (partner.get(e1) === e2) continue;
      const a1 = (angleOf(e1) + 360) % 360;
      let a2 = (angleOf(e2) + 360) % 360;
      if (i + 1 === sorted.length) a2 += 360;
      const gap = Math.round(a2 - a1);
      let rf;
      if (gap === 90 || gap === 135) rf = 0.25;
      else if (gap === 45) {
        // a 45° lens reaches ~0.97 along its flanks; if either flank's
        // route TURNS at its far node, the turn's arc eats that edge and
        // the lens would poke out from under the sweep — leave the crook
        // open instead (a clean V), which is what a pen would do
        const far1 = partner.has(endId(e1 >> 1, 1 - (e1 & 1)));
        const far2 = partner.has(endId(e2 >> 1, 1 - (e2 & 1)));
        if (far1 || far2) continue;
        rf = 0.15;
      }
      else continue;
      addSectorFillet(fills, nx, ny, a1, gap, V, rf);
      // strip length: to the fillet's tangent foot normally; when the
      // member turns at THIS node its arc pulls away from the sector,
      // so run the strip past the arc foot (0.5) to keep the flank straight
      const foot = (V + rf) / Math.tan(gap * Math.PI / 360) + 0.06;
      addHalfStrip(fills, nx, ny, a1, +90, V, partner.has(e1) ? 0.56 : foot);
      addHalfStrip(fills, nx, ny, a2, -90, V, partner.has(e2) ? 0.56 : foot);
    }
  }
  model.forEach((r, c, code) => {
    if ((code & SHAPE_MASK) === 0 && (code & TOUCHED)) {
      fills.moveTo(c + V, r);
      fills.arc(c, r, V, 0, Math.PI * 2);
    }
    for (const [bit, dc] of [[DR, 1], [DL, -1]]) {
      if (code & bit) {
        const cx = c + dc / 2, cy = r + 0.5;
        fills.moveTo(cx - DIAMOND, cy);
        fills.lineTo(cx, cy - DIAMOND);
        fills.lineTo(cx + DIAMOND, cy);
        fills.lineTo(cx, cy + DIAMOND);
        fills.closePath();
      }
    }
  });
  return { strokes, fills };
}

function appendRounded(path, pts, closed) {
  if (pts.length < 2) return;
  if (closed && (pts[0][0] !== pts[pts.length - 1][0] ||
                 pts[0][1] !== pts[pts.length - 1][1])) {
    pts.push([pts[0][0], pts[0][1]]);
  }
  const out = [];
  const last = pts.length - 1;
  if (!closed) out.push(pts[0]);
  for (let k = closed ? 0 : 1; k <= last - 1; k++) {
    if (!closed && k === 0) continue;
    const p0 = closed && k === 0 ? pts[last - 1] : pts[k - 1];
    const p1 = pts[k], p2 = pts[k + 1];
    let ux = p1[0] - p0[0], uy = p1[1] - p0[1];
    let wx = p2[0] - p1[0], wy = p2[1] - p1[1];
    const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
    ux /= lu; uy /= lu; wx /= lw; wy /= lw;
    const cross = ux * wy - uy * wx;
    const dot = ux * wx + uy * wy;
    const dev = Math.atan2(Math.abs(cross), dot);
    if (dev < 1e-3) { out.push(p1); continue; }
    let r = CORNER_RADIUS;
    let t = r * Math.tan(dev / 2);
    const tMax = Math.min(lu, lw) / 2 - 1e-4;
    if (t > tMax) { t = tMax; r = t / Math.tan(dev / 2); }
    const side = cross > 0 ? 1 : -1;
    const f1x = p1[0] - ux * t, f1y = p1[1] - uy * t;
    const cx = f1x - uy * side * r, cy = f1y + ux * side * r;
    const a1 = Math.atan2(f1y - cy, f1x - cx);
    const steps = Math.max(4, Math.round(dev * 10));
    for (let kk = 0; kk <= steps; kk++) {
      const a = a1 + side * dev * kk / steps;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  if (!closed) out.push(pts[last]);
  path.moveTo(out[0][0], out[0][1]);
  for (let i = 1; i < out.length; i++) path.lineTo(out[i][0], out[i][1]);
  if (closed) path.closePath();
}

function addSectorFillet(path, cx, cy, a1, gap, v, rf) {
  const half = gap * Math.PI / 360;
  const bis = (a1 + gap / 2) * Math.PI / 180;
  const pDist = v / Math.sin(half);
  const cDist = (v + rf) / Math.sin(half);
  const ax = cx + cDist * Math.cos(bis), ay = cy + cDist * Math.sin(bis);
  path.moveTo(cx + pDist * Math.cos(bis), cy + pDist * Math.sin(bis));
  const start = (a1 - 90) * Math.PI / 180;
  const sweep = (gap - 180) * Math.PI / 180;
  for (let k = 0; k <= 12; k++) {
    const a = start + sweep * k / 12;
    path.lineTo(ax + rf * Math.cos(a), ay + rf * Math.sin(a));
  }
  path.closePath();
}

function addHalfStrip(path, cx, cy, angleDeg, sideDeg, v, len) {
  const a = angleDeg * Math.PI / 180;
  const nrm = (angleDeg + sideDeg) * Math.PI / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = Math.cos(nrm) * v, ny = Math.sin(nrm) * v;
  path.moveTo(cx, cy);
  path.lineTo(cx + dx * len, cy + dy * len);
  path.lineTo(cx + dx * len + nx, cy + dy * len + ny);
  path.lineTo(cx + nx, cy + ny);
  path.closePath();
}
