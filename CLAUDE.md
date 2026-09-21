# Case Draw — project notes for Claude Code

Read this first. It carries the context from the design chat that produced this repo.

## What it is
A single-page web app (GitHub Pages, no server, no build for deployment) where the user finger-draws a design on the
back of a Nothing Phone (3) case and exports it for 3D printing. Printers: Snapmaker U1 (4-tool toolchanger, the
main multi-colour target) and a Bambu with AMS. Filament: PLA to start.

## The physical design (settled after several iterations — don't reopen without asking)
- **Case body**: ONE piece, printed back-down. 1 mm back slab, 1.5 mm wall rising from it, 0.5 mm lip over the
  screen bezel, phone clearance 0.25 mm. Button/port openings are windows through the wall with rounded corners
  (built layer-by-layer so the rounding is exact at 0.2 mm layers). Camera holes through the slab.
- **Panel**: a flat plate the full size of the case back, glued onto the slab. Two modes:
  - *Inlay*: prints face-down; the drawing is pocketed into the panel (glass-smooth). Short collars round the
    camera holes on the inside key into oversized holes in the slab.
  - *Relief*: prints face-up; each ink has its own independent height above the panel (0 = pocketed flush).
    Heights are absolute, NOT additive/stacked — the user explicitly rejected stacking.
- Earlier designs (two-part frame with dovetail; frame with snap bumps and tongued plate) were rejected as too weak.
- **Case sides** can be plain, "drawing through" (`caseStyle: "extrude"`: inks go the full panel thickness to its
  outer edge and the case wall under each point takes the colour drawn directly above it, so no plate-colour stripe),
  or horizontal stripes. The choice is in the 3D view's Sides row as well as Settings. Multi-colour parts are separate parts of one 3MF object; the user assigns filaments in Orca.
- Measured by the user (Sept 2026, `specVersion: 2`): phone 76.8 x 163.8, corner R11.7 (user unsure), camera
  island one rounded rectangle 68 x 50.5 R11.8, 4 mm from the top and 4.4 mm from each side. Cutouts are circles
  `{x,y,d}` or rounded rects `{x,y,w,h,r}` (centre). Button windows are still estimates from a photo (all three on
  the left of the back view); thickness 9.0 is unmeasured. Saved specs older than v2 get the new outline on load.
- A **test coupon** export (top-left 32 mm corner of case + panel) exists to dial in fit before a full print.

## Code layout
- `index.html` — GENERATED. Do not edit by hand. It's what Pages serves.
- `src/index.src.html` — the app: canvas drawing (vector strokes in mm), settings JSON, 3D preview (three.js r128
  from cdnjs, custom orbit), saving (share sheet / download / claude.ai `downloads` capability fallback).
- `src/geo.js` — geometry, UMD: strokes → capsule polygons → paint partition (cells, cached) → regions per ink →
  extruded meshes → 3MF (own minimal zip writer). Also the case body, colour styles, coupon. Uses earcut and
  polygon-clipping (vendored). Coordinates are snapped to 1 µm after every boolean op for robustness.
- `build.py` — inlines vendor libs + geo.js into the app → `index.html`. Run it after any src change; commit both.

## Testing without a browser
`npm i earcut polygon-clipping` then in Node: `const G = require('./src/geo.js')`, call `G.buildParts(spec, design)`,
`G.buildFrame(spec, design)`, `G.buildCoupon(...)`, write `G.to3MF(parts, title)` to a file. Meshes were validated
with Python `trimesh` (winding consistent, positive volumes, closed slices). Keep that standard: every part must
have every directed edge matched by its reverse. Robustness rules learnt the hard way: snap every region that
meets another (plate and inks both go through `ops`); build a pocketed face from the pocket's own rings
(`minusFrom`), not a second boolean op; use the colour-blind `allInk` region for pockets/through-cuts (per-ink
unions leave hairline seams); `cap` repairs earcut T-junctions on diagonals and takes winding from total area.

## Conventions
- All dimensions mm. Design coords: back view, origin top-left of the phone, y down. 3MF is z-up, oriented for
  printing as exported. Inlay panel is mirrored (rotated 180° about Y) so the design reads correctly outside.
- Every tunable is in the Settings JSON (`DEFAULT_SPEC` in the app). Defaults are the source of truth for new
  keys; `validateSpec` fills missing keys and drops obsolete ones so old saved designs still load.
- Hosted copy of the app also lives at https://claude.ai/artifact/9z19e1tf3YsEjjZkyahn9W (same file).

## Likely next steps (user's call)
- Push to GitHub, enable Pages from `main` (this was the immediate ask).
- Print the coupon; adjust `lipDepth`, `phoneClearance`, `collarClearance` from the result.
- App: text/stamp tool, per-stroke editing, decorating the case sides beyond colour, more phone models.
