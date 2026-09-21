#!/usr/bin/env python3
"""Inline the vendored libraries and geo.js into src/index.src.html -> index.html (the file GitHub Pages serves)."""
import re, pathlib
root = pathlib.Path(__file__).parent
src = (root / "src/index.src.html").read_text()
earcut = (root / "src/vendor/earcut.min.js").read_text()
pcl = re.sub(r"//# sourceMappingURL=.*", "", (root / "src/vendor/polygon-clipping.umd.min.js").read_text())
geo = (root / "src/geo.js").read_text()
libs = f"""<script>/* earcut 2.2.4 — ISC License, Copyright (c) 2016, Mapbox */
{earcut}
</script>
<script>/* polygon-clipping 0.15.7 — MIT License, Copyright (c) 2018 Mike Fogel (bundles splaytree, robust-predicates, bignumber.js) */
{pcl}
</script>
<script>
{geo}
</script>
"""
out = src.replace("<script>\n(() => {", libs + "<script>\n(() => {", 1)
(root / "index.html").write_text(out)
print(f"wrote index.html ({len(out):,} bytes)")
