// Every phone preset must build a clean, printable case: the corner curve passes through the sheet's points, side
// openings sit inside the wall and don't overlap, and the exported parts are manifold the way a slicer judges it.
//   npm i earcut polygon-clipping   (once)      node test/phones.js
const fs = require('fs'), path = require('path');
const G = require('../src/geo.js');
const html = fs.readFileSync(path.join(__dirname, '../src/index.src.html'), 'utf8');
const BASE = eval('(' + html.match(/const DEFAULT_SPEC = (\{[\s\S]*?\n\});/)[1] + ')');
const D = eval('(' + html.match(/const DEFAULT_DESIGN = (\{[\s\S]*?\n\});/)[1] + ')');
const window = {}; eval(fs.readFileSync(path.join(__dirname, '../src/phones.js'), 'utf8'));
const KEYS = ['phone', 'width', 'length', 'thickness', 'lipDrop', 'lipRaise', 'cutoutEdge', 'cutoutInset', 'cornerRadius', 'cornerProfile', 'cornerProfileY', 'cutouts', 'sideCutouts', 'source'];

function badEdges(parts) {
  const xml = new TextDecoder().decode(G.to3MF(parts, 't')); let bad = 0;
  for (const [, , m] of xml.matchAll(/<object id="\d+" name="([^"]*)"[^>]*>\s*<mesh>([\s\S]*?)<\/mesh>/g)) {
    const e = new Map();
    for (const x of m.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) { const t = [+x[1], +x[2], +x[3]]; for (let j = 0; j < 3; j++) { const p = t[j], q = t[(j + 1) % 3], k = p < q ? p + ',' + q : q + ',' + p; const r = e.get(k) || [0, 0]; r[p < q ? 0 : 1]++; e.set(k, r); } }
    for (const [f, r] of e.values()) if (f !== 1 || r !== 1) bad++;
  }
  return bad;
}
const distToRing = (P, ring) => { let best = 1e9; for (let k = 0; k < ring.length - 1; k++) { const a = ring[k], b = ring[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(P[0] - a[0] - t * dx, P[1] - a[1] - t * dy)); } return best; };

let fails = 0;
for (const ph of window.PHONES) {
  const spec = JSON.parse(JSON.stringify(BASE)); for (const k of KEYS) delete spec[k]; Object.assign(spec, JSON.parse(JSON.stringify(ph.spec)));
  const issues = [], W = spec.width, L = spec.length;
  // corner curve through the sheet's points
  let off = 0;
  if (spec.cornerProfile) {
    const X = spec.cornerProfile, Y = spec.cornerProfileY || X, n = X.length, ring = G.phoneOutline(spec, 0, 16)[0];
    for (let i = 0; i < n; i++) off = Math.max(off, distToRing([X[i], Y[n - 1 - i]], ring));
    if (off > 0.03) issues.push(`corner curve misses a sheet point by ${off.toFixed(3)} mm`);
    const xs = ring.map(q => q[0]), ys = ring.map(q => q[1]);
    if (Math.min(...xs) < -1e-6 || Math.max(...xs) > W + 1e-6 || Math.min(...ys) < -1e-6 || Math.max(...ys) > L + 1e-6) issues.push('outline leaves the bounding box');
  }
  // side openings
  const lv = G.frameLevels(spec), gap = spec.buttonClearance || 0, bySide = {};
  for (const k of spec.sideCutouts) {
    const lim = k.side === 'left' || k.side === 'right' ? L : W;
    if (!(k.from - gap > 3 && k.to + gap < lim - 3)) issues.push(`${k.name}: opening runs into a corner (${k.from}-${k.to})`);
    if (typeof k.fromScreen === 'number') { const top = lv.zScreen - k.fromScreen + k.height / 2, bot = lv.zScreen - k.fromScreen - k.height / 2; if (top > lv.zLip - 0.15 || bot < lv.zPhone + 0.15) issues.push(`${k.name}: slot ${k.height} high does not fit the ${spec.thickness} wall`); }
    (bySide[k.side] = bySide[k.side] || []).push(k);
  }
  for (const list of Object.values(bySide)) { list.sort((a, b) => a.from - b.from); for (let i = 1; i < list.length; i++) if (list[i].from - gap - (list[i - 1].to + gap) < 1.2) issues.push(`${list[i - 1].name} / ${list[i].name}: less than 1.2 mm of wall between the openings`); }
  for (const c of spec.cutouts) { const hw = (c.w || c.d) / 2, hh = (c.h || c.d) / 2; if (c.x - hw < -0.01 || c.x + hw > W + 0.01 || c.y - hh < -0.01 || c.y + hh > L) issues.push(`${c.name}: cutout outside the phone`); }
  // build + mesh check
  const strokes = [{ c: 1, w: 9, pts: [[-6, L * 0.55], [W + 6, L * 0.62]] }, { c: 0, w: 4, pts: [[W * 0.2, -5], [W * 0.75, L * 0.5], [W * 0.3, L + 5]] }, { c: 2, w: 6, pts: [[W * 0.6, L * 0.2], [W * 0.9, L * 0.35]] }];
  let bad = 0;
  for (const [mode, caseStyle] of [['inlay', 'plain'], ['inlay', 'extrude'], ['relief', 'stripes']]) {
    try { bad += badEdges(G.buildPrintSet(spec, { ...D, strokes, mode, caseStyle, inkHeights: [1, 2, 0] }).parts); }
    catch (e) { issues.push(`${mode}/${caseStyle} threw: ${e.message.slice(0, 80)}`); }
  }
  if (bad) issues.push(`${bad} non-manifold edges`);
  console.log(`${issues.length ? 'FAIL' : 'ok  '} ${ph.name.padEnd(18)} ${W} x ${L} x ${spec.thickness}  corner fit ${off.toFixed(3)}  cutouts ${spec.cutouts.length}  openings ${spec.sideCutouts.length}`);
  for (const i of issues) console.log('       ' + i);
  fails += issues.length ? 1 : 0;
}
console.log(fails ? `FAIL: ${fails} of ${window.PHONES.length} phones` : `OK: ${window.PHONES.length} phones build clean cases`);
process.exit(fails ? 1 : 0);
