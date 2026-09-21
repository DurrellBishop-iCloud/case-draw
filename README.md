# Case Draw and Beck

Two apps from one source: **Case Draw** (`/`, freehand) and **Beck** (`/beck/`, drawn on the Drawn Codes grid: 90° and 45° lines, filled enclosures). `python3 build.py` builds both pages.

Finger-draw a design on a Nothing Phone (3) case and print it: a one-piece case body plus a glued-on decorated panel, exported as 3MF for Snapmaker Orca / Bambu Studio.

`index.html` is the whole app and is what GitHub Pages serves. Nothing to build for deployment.

## Editing

- `src/index.src.html` — the app (UI, canvas, 3D view, settings)
- `src/geo.js` — geometry: strokes → 2D regions → meshes → 3MF. Runs in Node too (`npm i earcut polygon-clipping` then `require('./src/geo.js')`) for testing without a browser.
- `src/vendor/` — earcut and polygon-clipping, inlined at build time
- `python3 build.py` regenerates `index.html` from the three above. Commit the result.

## Printing

- Case: one part per colour, oriented back-down. Assign filaments per part in the slicer.
- Panel: inlay prints face-down (glass-smooth), relief prints face-up. Glue to the case; inlay panels key in with camera collars.
- Print the test coupon first (Settings → Files) to dial in `lipDepth`, `phoneClearance` and `collarClearance`.

## Phones

Settings > Phone. The Nothing Phone (3) was measured by hand. The iPhone presets use dimensions read from Apple's public
[dimensional drawings for accessory makers](https://developer.apple.com/accessories/dimensional-drawings/) (the numbers only; the
drawings themselves are Apple's and are not included). See `data/phones/` and `tools/make_phones.py`. Print the test coupon before a
whole case: none of these presets has been checked against a real phone yet.
