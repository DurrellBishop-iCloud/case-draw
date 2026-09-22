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
  45.5-56.8, all centred 4.3 below the screen face (2.8 until v1.11.2; a test print showed them too close to the screen). Button holes are 4 mm rounded slots (`fromScreen`, `height`)
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

## Four colours + the case (v1.7.0)
Four swatches, all drawable and equal: inks 0-2 (circles) and -1 (the rectangle, also the panel's background). A
-1 stroke is a cut through the inks under it (paintCells keeps the cells; buildRegions/inkPlanRegions drop them;
allInkRegion folds strokes in order). The CASE is not a colour of its own: `design.caseInk` (-1 or 0-2) says which
of the four it is made of (fifth toolbar control, tap to cycle; geo keyColor("case") reads it). Text can be flagged
`top: true` (Text option "Stays on top", default on): `orderedStrokes` draws those last, in canvas, SVG and geometry.

## One app, two drawing surfaces (v1.11.0) — supersedes "two apps" below
Freehand and Beck are no longer separate apps: ONE design (`casedraw.v1`) holds freehand strokes AND the four Beck
grids; `design.surface` ("free" | "grid") picks which surface the finger draws on (switch at the left of the rule
row). `const BECK` is gone: grid DATA is always present (engine inlined in both pages, `beckInit()` always, undo
snapshots, clear, save and `geoDesign()` always include grids); the SURFACE (`GRID()`) only decides pointer routing,
which controls show, grid lines, and half-cell snapping of mirror lines. Draw order everywhere: freehand strokes,
then the grid drawing (in `design.beck.order`), then text flagged `top`. `/beck/` is the same app opening on the
grid. `mergeOldBeck()` folds Beck's old separate save (`casedraw.beck.v1`, left untouched as a backup) in once
(`design.beckMerged`): grids + its photo/text; its palette wins only if the freehand design was empty.
Ken / Margaret = more surfaces on the same switch, not more apps.

## Two apps from one source: Case Draw and Beck (v1.8.0)
`build.py` builds `index.html` (Case Draw, freehand) and `beck/index.html` (Beck, named after Harry Beck's tube map)
from the SAME `src/index.src.html`; the page sets `window.APP_MODE`, the app reads `const BECK`. Everything except
the drawing surface is shared (geometry, 3D, export, colours, case, cutouts, photo, text, mirrors), so a fix lands
in both. Separate saved designs (`casedraw.v1` / `casedraw.beck.v1`). Do NOT fork the repo or copy the app: the
user's plan is more siblings later ("Ken", "Margaret", after the associated designers) built the same way, each a
mode with its own drawing surface. Tag `draw-v1.7.0` = Case Draw before Beck existed.
- Beck draws on the Drawn Codes grid (the user's own system, github.com/DurrellBishop-iCloud/drawn-codes, live at
  dbgh.uk/drawn-codes). Its web engine is vendored in `src/vendor/drawncodes/` (see README.txt there); build.py
  strips the ES-module syntax and exposes `window.DrawnCodes`, in the Beck page only.
- Four `GridModel`s, one per colour (layer 0-2 = inks, 3 = colour 4 / panel colour = knock-out), stacking
  `design.beck.order`, per-colour 45 / 90 / Fill flags, global Snap, `cell` mm (default 4; stroke = half a cell).
  Grid centred on the case (centre on a cell boundary); mirror lines snap to half cells and every cell operation
  is repeated per mirror (`eachMirror`). Pointer stepping (snap offset, 0.38 corner zones for diagonals) is a port
  of Drawn Codes' main.js.
- Canvas draws each layer's `traceSilhouette` Path2D (coarse while the finger is down). Geometry gets
  `geoDesign()`: design.strokes (photo/text) + each layer traced at ~0.1 mm, simplified, `CaseGeo.ringsToRegion`
  -> a `{c, fill}` shape. ALL CaseGeo calls in the app must take `geoDesign()`, not `design`.
- Undo snapshots (`snapshot()/restoreSnap()`) cover strokes and grids. "From Drawn Codes" reads the `drawncodes`
  localStorage key (same origin on dbgh.uk) and centres that drawing on the case.
- v1.9.0: stacking dots (`#stack`, top dot = top layer, tap picks the colour, drag reorders `design.beck.order`;
  pointermove gated on a pressed flag, the Drawn Codes hover bug); Move mode (`moving`: slide all grids by cells,
  quarter turns about the drawing's own bbox centre with link bits rotated; Import drops straight into it; Cell is
  reparented into the Move bar); app switcher at the top of Settings.
- Tests: `node test/manifold.js` covers shared geometry; Beck tracing needs a browser (Playwright WebKit was used:
  draw by mouse drags, call `window.__beckExport()` for the Save bytes, count non-manifold edges, then the Orca CLI).

## Holes (v1.15.0)

- The old Cutouts tool (drag the phone's camera cutouts) is gone; cutouts are edited in the Settings JSON. The **Holes** tool draws pen strokes with `c: HOLE` (-2): windows through the back. geo: `withHoles(spec, design)` puts the hole strokes on a spec copy (`_holes`) at buildRegions/buildParts/buildFrame; `cutoutRegion` unions `drawnHoles(spec, grow)` (strokes drawn `w + 2*grow`, clipped to `phoneOutline(spec, grow - 2)`), so holes get panel holes, collars and oversized case holes exactly like the camera. `hasCuts(spec)` replaces `spec.cutouts.length` checks. paintCells/allInkRegion ignore c = -2. 2D draws holes last in bed colour, clipped 2 mm inside the phone.
- The Beyond toggle is also in the main UI (row with Photo and Text) and at the end of Settings > Drawing sits.

## New design (v1.14.0)

- Header "New" opens the `#askNew` dialog: Save, then start new (the usual `download()` .json; a cancelled share sheet clears nothing) / Start new without saving / Cancel. `startNew()` clears strokes and grids via `commit`, so Undo restores until reload. Phone, colours, case settings stay. Under 440 px the header drops the title and subtitle to fit four buttons (the version tag stays).

## Drawing beyond the edge (v1.13.0)

- Pen strokes only (v1.13.1): photo/text/Beck fills are sampled over the phone + 2 mm, so past the outline they would be a sliver; `beyondRegions` runs paintCells on the non-fill strokes and restores `cellCache`.
- `design.beyond` + `design.beyondDepth` (mm from the panel face towards the screen, 1 .. panel + case H). `beyondRegions` (geo.js): per ink, paint cells minus the case outline (`phoneOutline(c + wall)`), keeping only pieces touching the outline. Panel gets "Ink N beyond the edge" parts (full panel thickness, + ink height in relief); the case gets keys `beyond0..2` from z = 0 to `beyondDepth - panelT`, with `windowRects(spec, z, 400)` cut through so buttons/ports stay open. Separate parts (not merged into ink meshes) so touching faces never make bad edges.
- UI: Settings > Case sides checkbox, and a "Beyond edge" button + dashed-dot depth slider in the 3D view. The 2D view draws strokes a second time clipped to outside the case outline. `node test/beyond.js`.

## Phones (v1.10.0)

- `lipDrop` (v1.11.3): the lip and the top of the wall sit this far below the screen face, for phones whose edges curve away. Button `fromScreen` is still measured from the screen face (`frameLevels().zScreen`). Set per phone in `LIP_DROP` in tools/make_phones.py; iPhone 17 = 0.7, iPhone 17 Pro = 1.0 (Durrell, from the phone).
- `lipRaise` (v1.15.2): added to lipThickness in `frameLevels`; iPhone 17 Pro = 0.5 (`LIP_RAISE` in make_phones.py): with lipDrop 1.0 the lip top was 0.3 below the glass, now ~0.3 above. A separate key (not lipThickness) so saved specs, which carry the default 0.8, pick it up in buildPhoneList.
- `cutoutInset` (v1.15.1): shrinks a rounded-rect cutout on all four sides before anything else; iPhone 17 Pro = 2.7 (`CUTOUT_INSET` in make_phones.py). `cutoutEdge` alone only moved the three sides near the phone's edges, not the bottom of the camera opening. Saved 17 Pro specs keep cutoutEdge 3 (now a no-op) and pick up cutoutInset in buildPhoneList.
- `cutoutEdge` (v1.12.0): `cutShape` shrinks a rounded-rect cutout so its opening (with clearance) is that far from the edge, then grows it as usual, so panel hole, collar and case hole stay clean concentric rounded rects (v1.13.2; v1.12.0 clipped to an inset outline, which left kinked corners). Per phone in `CUTOUT_EDGE` in make_phones.py; iPhone 17 Pro = 3 (its measured bar plateau reaches 0.6 from the edge but the base slopes).
- `buttonChamfer` (v1.12.0, default 0.8, every phone): `windowRects` grows each button slot by (chamfer - depth) near the outside face; skipped within 0.4 mm of the lip and the floor. `windowRects` is exported for tests.
Settings > Phone picks a preset; it replaces only the phone's keys (`PHONE_KEYS`), never the case settings.
- Nothing Phone (3) = `DEFAULT_SPEC` (hand-measured). `specVersion: 4`: button slots 5.2 high, `buttonClearance` 1.2.
- 26 iPhones (12 mini ... 17 Pro Max, 16e, 17e, Air) from Apple's public dimensional drawings
  (developer.apple.com/accessories/dimensional-drawings/). Raw readings: `data/phones/iphone-*.json` (one per phone,
  notes inside). `data/phones/_measured.json` = the few values Apple draws but does not dimension (bar-camera
  outlines on 17 Pro / Pro Max / Air, three plateau edges, two unlabelled corner ordinates) measured from the vector
  linework with a calibrated mm grid (+/-0.2), plus the y-axis corner lists where a sheet gives the axes separately.
  `python3 tools/make_phones.py` -> `src/phones.js` (inlined by build.py). Do not hand-edit phones.js.
- How the readings were verified: digits on sheets with a text layer matched `get_text` verbatim; sheets whose
  lettering is vector strokes were decoded glyph-by-glyph from `get_drawings()` by an independent pass (all numbers
  confirmed); overall sizes match Apple's tech specs. NOT verified: fit on a real phone. Nothing here has been printed.
- Apple's sheets: buttons are dimensioned by CENTRE from the top + HALF-length; left/right are as seen from the
  FRONT (the app uses the BACK view, so sides swap); camera ordinates are from the back view's top-left.
- Corners: `cornerProfile` (+ optional `cornerProfileY`) = Apple's ordinate table; point i = (X[i], Y[n-1-i]) (checked
  against the drawn crosses). `phoneOutline` fits a shape-preserving curve through them (max miss 0.007 mm) and
  offsets along normals; plain `cornerRadius` phones keep the old circular code path untouched.
- `cutoutRegion` = all back cutouts as one region; cutouts closer than `minWeb` (1.6) are joined by a slot (iPhone
  16/17 flash beside the camera pill). Slab holes and collars are clipped to the phone outline so a camera 1 mm from
  the edge cannot break the wall. Plateau corner radius is never dimensioned by Apple: presets use 0.22 x the short
  side (real is about 0.27), so the opening always clears.
- Converter merges side openings that would leave < 1.5 mm of wall (volume up + down -> one slot); the bottom
  opening spans the sheet's port ordinates AND their mirror image (the bottom view's handedness is not stated).
- `node test/phones.js`: every preset must fit its corner points, keep openings inside the wall, and export manifold.

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
