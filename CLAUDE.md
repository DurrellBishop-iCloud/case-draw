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
  `{x,y,d}` or rounded rects `{x,y,w,h,r}` (centre). Measured too (`specVersion: 3`): thickness 8.2; phone's
  right side (back-view left) volume 45.8-67.5 and power 75.3-85.2, left side (back-view right) Essential key
  45.5-56.8, all centred 2.8 below the screen face. Button holes are 4 mm rounded slots (`fromScreen`, `height`)
  plus `buttonClearance` 0.4 per end; vertical play = `phoneClearance` (0.25). USB-C/bottom is still a placeholder.
  Saved specs older than v2/v3 get the measured values on load.
- A **test coupon** export (top-left 32 mm corner of case + panel) exists to dial in fit before a full print.

## Drawing rules, photo, text (v1.4.0)
- Rules row: Free / Line / V stripes / H stripes (`design.rule`), Mirror ↔ / ↕ toggles (`design.mirrorX/Y`);
  mirrors copy every added stroke or shape at commit (`mirrored()`), duplicates dropped.
- Photo and Text are placed (drag, pinch/scroll to size and turn, 90° buttons), then converted to FILLED SHAPES:
  a stroke entry `{ c, fill: MultiPolygon mm }`. Conversion samples the placed image on a 0.4 mm (photo) / 0.2 mm
  (text) grid, one mask per ink, `CaseGeo.traceMask` -> outlines. Photo: nearest of the 4 colours (mine or k-means
  "photo's colours", which replaces the palette; biggest cluster = panel), panel-colour pixels stay empty, one 3x3
  majority pass removes specks. `strokeRegion` accepts `fill`, so layering, 3D, through-mode and export just work.
  Erase removes a whole fill (one colour of a photo) at a time.

## Code layout
- `index.html` — GENERATED. Do not edit by hand. It's what Pages serves.
- `src/index.src.html` — the app: canvas drawing (vector strokes in mm), settings JSON, 3D preview (three.js r128
  from cdnjs, custom orbit), saving (share sheet / download / claude.ai `downloads` capability fallback).
- `src/geo.js` — geometry, UMD: strokes → capsule polygons → paint partition (cells, cached) → regions per ink →
  extruded meshes → 3MF (own minimal zip writer). Also the case body, colour styles, coupon. Uses earcut and
  polygon-clipping (vendored). Coordinates are snapped to 1 µm after every boolean op for robustness.
- `build.py` — inlines vendor libs + geo.js into the app → `index.html`. Run it after any src change; commit both.

## 3MF layout (v1.2.4+)
Written the way Orca / Snapmaker Orca / Bambu Studio save projects: each group (case, panel) is an object whose
parts live in `3D/Objects/object_N.model` (production extension, `p:path` components), and
`Metadata/model_settings.config` gives every part a name and `extruder` (filament slot). Slots: panel colour first,
then Ink 1-3, then case; identical colours share a slot; beyond 4 (the U1's tools) a colour joins the nearest.
Do NOT add a partial `Metadata/project_settings.config` (e.g. just filament_colour): Orca then fails to load the
file. Keep names ASCII (Orca mangles non-ASCII in its object file names). Verify with the Orca CLI:
`"/Applications/Snapmaker Orca.app/Contents/MacOS/Snapmaker_Orca" --datadir <scratch> --outputdir <out>
--export-3mf re.3mf file.3mf`, then read `extruder` and `mesh_stat` in the re-exported model_settings.config.

## Testing without a browser
`npm i earcut polygon-clipping` then in Node: `const G = require('./src/geo.js')`, call `G.buildParts(spec, design)`,
`G.buildFrame(spec, design)`, `G.buildCoupon(...)`, write `G.to3MF(parts, title)` to a file. Meshes were validated
with Python `trimesh` (winding consistent, positive volumes, closed slices). Keep that standard, judged the way Orca judges
it, BY VERTEX INDEX in the written 3MF: `node test/manifold.js [n]` (after `npm i earcut polygon-clipping`) exports
bands/scribble designs in every mode, side style and the coupon and fails on any edge not used exactly once each
way. The 3MF writer welds corners by their written 0.001 mm position, drops mirror-twin triangles and splits pinch
vertices; walls pick quad diagonals by position so back-to-back walls cancel. Known residual (Sept 2026): 2 of
480 test exports (one scribble design, raised panel) keep a 3-edge sliver earcut can't fill. Robustness rules learnt the hard way: snap every region that
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
