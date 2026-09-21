// Slicer-style mesh check: every exported part must be closed and manifold by vertex index, as Orca and
// Bambu Studio judge it: each edge used by exactly two triangles, once in each direction.
//   npm i earcut polygon-clipping   (once)
//   node test/manifold.js [designs per kind, default 6]
const fs = require('fs'), path = require('path');
const G = require('../src/geo.js');
const html = fs.readFileSync(path.join(__dirname, '../src/index.src.html'), 'utf8');
const spec = eval('(' + html.match(/const DEFAULT_SPEC = (\{[\s\S]*?\n\});/)[1] + ')');
const D = eval('(' + html.match(/const DEFAULT_DESIGN = (\{[\s\S]*?\n\});/)[1] + ')');
const N = +(process.argv[2] || 6);
const kinds = {
  bands: rnd => Array.from({ length: 20 }, () => { const y = rnd() * 170 - 3, pts = []; for (let x = -8; x < 86; x += 2 + rnd() * 6) pts.push([x, y + rnd() * 3 + x * 0.03]); return { c: Math.floor(rnd() * 3), w: 2 + rnd() * 8, pts }; }),
  // photo/text-style filled shapes: blobby masks traced to outlines, plus a few strokes on top
  fills: rnd => {
    const g = 0.4, nx = 202, ny = 420, out = [];
    for (let c = 0; c < 3; c++) {
      const m = new Uint8Array(nx * ny), blobs = Array.from({ length: 6 }, () => [rnd() * nx, rnd() * ny, 10 + rnd() * 40]);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (blobs.some(([x, y, r]) => (i - x) ** 2 + (j - y) ** 2 < r * r) && rnd() > 0.03) m[j * nx + i] = 1;
      out.push({ c, fill: G.traceMask(m, nx, ny, -2, -2, g) });
    }
    for (let k = 0; k < 4; k++) out.push({ c: k % 3, w: 3, pts: [[rnd() * 80, -5], [rnd() * 80, 170]] });
    return out;
  },
  scribbles: rnd => Array.from({ length: 25 }, (_, k) => { const pts = []; let x = rnd() * 90 - 7, y = rnd() * 175 - 5; for (let j = 0; j < 6; j++) { pts.push([x, y]); x += rnd() * 40 - 20; y += rnd() * 40 - 20; } return { c: k % 3, w: 1 + rnd() * 7, pts }; })
};
function check(parts) {
  const xml = new TextDecoder().decode(G.to3MF(parts, 't'));
  const bad = [];
  for (const [, name, m] of xml.matchAll(/<object id="\d+" name="([^"]*)"[^>]*>\s*<mesh>([\s\S]*?)<\/mesh>/g)) {
    const e = new Map();
    for (const x of m.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) {
      const t = [+x[1], +x[2], +x[3]];
      for (let j = 0; j < 3; j++) { const p = t[j], q = t[(j + 1) % 3], k = p < q ? p + ',' + q : q + ',' + p; const r = e.get(k) || [0, 0]; r[p < q ? 0 : 1]++; e.set(k, r); }
    }
    let n = 0; for (const [f, r] of e.values()) if (f !== 1 || r !== 1) n++;
    if (n) bad.push(`${name}: ${n} bad edges`);
  }
  return bad;
}
let fails = 0, runs = 0;
for (const [kind, gen] of Object.entries(kinds)) for (let seed = 1; seed <= N; seed++) {
  let s = seed * 7919; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const strokes = gen(rnd);
  for (const mode of ['inlay', 'relief']) for (const caseStyle of ['plain', 'stripes', 'extrude']) {
    const d = { ...D, strokes, mode, caseStyle, inkHeights: [2.1, 4.1, 0] };
    for (const [what, parts] of [['print', () => G.buildPrintSet(spec, d).parts], ['coupon', () => G.buildCoupon(spec, d, 32).parts]]) {
      runs++;
      let bad; try { bad = check(parts()); } catch (e) { bad = ['threw: ' + e.message]; }
      if (bad.length) { fails++; console.log(`${kind} #${seed} ${mode}/${caseStyle} ${what}: ${bad.join('; ')}`); }
    }
  }
}
console.log(fails ? `FAIL: ${fails} of ${runs} exports` : `OK: ${runs} exports, every part manifold`);
process.exit(fails ? 1 : 0);
