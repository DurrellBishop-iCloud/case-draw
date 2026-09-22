#!/usr/bin/env python3
"""data/phones/*.json (numbers read from Apple's public dimensional drawings,
https://developer.apple.com/accessories/dimensional-drawings/) -> src/phones.js (presets for the Phone chooser).

Apple's sheets use the FRONT view for left/right; the app uses the BACK view (origin top-left of the back, x right,
y down), so sides swap. Camera ordinates are already from the back view's top-left corner.
Run: python3 tools/make_phones.py && python3 build.py"""
import json, math, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
ORDER = ["iphone-17-pro-max", "iphone-17-pro", "iphone-air", "iphone-17", "iphone-17e",
         "iphone-16-pro-max", "iphone-16-pro", "iphone-16-plus", "iphone-16", "iphone-16e",
         "iphone-15-pro-max", "iphone-15-pro", "iphone-15-plus", "iphone-15",
         "iphone-14-pro-max", "iphone-14-pro", "iphone-14-plus", "iphone-14",
         "iphone-13-pro-max", "iphone-13-pro", "iphone-13", "iphone-13-mini",
         "iphone-12-pro-max", "iphone-12-pro", "iphone-12", "iphone-12-mini"]
r2 = lambda v: round(v + 1e-9, 2)


# the case lip can sit this far below the screen face, where the phone's edge has already curved in (checked on the phone)
LIP_DROP = {"iphone-17": 0.7, "iphone-17-pro": 1.0}
# ...and this much thicker than lipThickness, so its top stands proud of the glass and guards it in a fall (checked on the phone)
LIP_RAISE = {"iphone-17-pro": 0.5}
# the camera opening comes in this far on all four sides, off the plateau's sloping base (checked on the phone):
# 2.7 puts it 3 mm in from the phone's edge on the top and sides
CUTOUT_INSET = {"iphone-17-pro": 2.7}
MEASURED = json.loads((root / "data/phones/_measured.json").read_text())


def preset(d):
    W, L, T = d["width"], d["length"], d["thickness"]
    notes = []
    m = MEASURED.get(d["id"])
    if m and m.get("corner"):
        d["corner"] = {**(d.get("corner") or {}), **{k: v for k, v in m["corner"].items() if k != "why"}}
        notes.append("corner table: " + m["corner"]["why"])
    if m and m.get("plateau"):
        d.setdefault("camera", {}).setdefault("plateau", {}); d["camera"]["plateau"] = {**(d["camera"]["plateau"] or {}), **m["plateau"]}
        notes.append("camera outline (" + ", ".join(sorted(m["plateau"])) + ") measured from Apple's linework to about 0.2 mm, as the sheet does not dimension it")
    spec = {"phone": d["name"], "width": W, "length": L, "thickness": T}
    if d["id"] in LIP_DROP: spec["lipDrop"] = LIP_DROP[d["id"]]
    if d["id"] in LIP_RAISE: spec["lipRaise"] = LIP_RAISE[d["id"]]
    if d["id"] in CUTOUT_INSET: spec["cutoutInset"] = CUTOUT_INSET[d["id"]]
    prof = (d.get("corner") or {}).get("profile")
    if prof and len(prof) >= 4:
        prof = sorted(prof); spec["cornerProfile"] = prof
        py = (d.get("corner") or {}).get("profileY")
        if py and len(py) == len(prof): spec["cornerProfileY"] = sorted(py)
        # nominal radius (the circle through the profile's diagonal region); only used where a single number is needed
        n = len(prof); mid = min(range(n), key=lambda i: abs(prof[i] - prof[n - 1 - i]))
        spec["cornerRadius"] = r2(((prof[mid] + prof[n - 1 - mid]) / 2) / (1 - math.sqrt(0.5)))
    else:
        rad = (d.get("corner") or {}).get("radius")
        spec["cornerRadius"] = rad if rad else 10.0
        if not rad: notes.append("corner radius not on the drawing: 10 mm assumed")

    cuts = []
    cam = d.get("camera") or {}
    pl = cam.get("plateau")
    if pl and all(pl.get(k) is not None for k in ("x0", "x1", "y0", "y1")):
        w, h = pl["x1"] - pl["x0"], pl["y1"] - pl["y0"]
        shape = pl.get("shape")
        if shape == "pill": r = min(w, h) / 2
        elif pl.get("r"): r = pl["r"]
        else:
            r = min(w, h) * 0.22   # not dimensioned by Apple; the real corners are rounder (about 0.27), so this opening always clears them
        cuts.append({"name": "Camera", "x": r2((pl["x0"] + pl["x1"]) / 2), "y": r2((pl["y0"] + pl["y1"]) / 2), "w": r2(w), "h": r2(h), "r": r2(r)})
    else:
        for i, ln in enumerate(cam.get("lenses") or []):
            cuts.append({"name": f"Camera {i + 1}", "x": ln["x"], "y": ln["y"], "d": ln["d"]})
        notes.append("camera plateau outline not read: lens circles only")
    for e in cam.get("extras") or []:
        if e.get("inside") or e.get("x") is None or e.get("y") is None or not e.get("d"): continue
        cuts.append({"name": e["name"].capitalize(), "x": e["x"], "y": e["y"], "d": max(e["d"], 2.0)})   # 2 mm: smallest hole worth printing
    spec["cutouts"] = cuts

    sides = []
    for b in d.get("buttons") or []:
        if b.get("half") is None and b.get("length"): b["half"] = b["length"] / 2
        if b.get("kind") == "sim" or b.get("centre") is None or b.get("half") is None: continue
        width = b.get("width") or 2.7
        sides.append({"side": "right" if b["side"] == "left" else "left", "name": b["name"],
                      "from": r2(b["centre"] - b["half"]), "to": r2(b["centre"] + b["half"]),
                      "fromScreen": r2(T / 2), "height": r2(min(width + 2.6, T - 1.6))})
    # openings that would leave under 1.5 mm of wall between them (with 1.2 mm clearance at each end) become one slot
    merged = []
    for k in sorted(sides, key=lambda k: (k["side"], k["from"])):
        if merged and merged[-1]["side"] == k["side"] and k["from"] - merged[-1]["to"] < 2 * 1.2 + 1.5:
            m_ = merged[-1]; m_["to"] = max(m_["to"], k["to"]); m_["height"] = max(m_["height"], k["height"])
            m_["name"] = "Volume buttons" if "olume" in m_["name"] and "olume" in k["name"] else m_["name"] + " + " + k["name"]
        else: merged.append(k)
    sides = merged
    bt = d.get("bottom") or {}
    if bt.get("from") is not None and bt.get("to") is not None:
        # the sheet's bottom view may be mirrored relative to the back view: open the span and its mirror image
        lo, hi = min(bt["from"], W - bt["to"]), max(bt["to"], W - bt["from"])
        sides.append({"side": "bottom", "name": "Connector, speaker and microphones", "from": r2(lo), "to": r2(hi)})
    else:
        sides.append({"side": "bottom", "name": "Connector + speakers", "from": r2(W * 0.2), "to": r2(W * 0.8), "placeholder": True})
        notes.append("bottom ports not read: opening estimated")
    spec["sideCutouts"] = sides
    spec["source"] = f"Apple dimensional drawing, {d.get('drawingDate') or 'undated'}"
    note = f"From Apple's dimensional drawing ({d.get('drawingDate') or 'undated'}): size, corner curve, camera, buttons." + (" Except: " + "; ".join(notes) + "." if notes else "")
    return {"id": d["id"], "name": d["name"], "group": "iPhone", "note": note, "spec": spec}


files = {p.stem: p for p in (root / "data/phones").glob("iphone-*.json")}
out = [preset(json.loads(files[i].read_text())) for i in ORDER if i in files]
(root / "src/phones.js").write_text("window.PHONES = " + json.dumps(out, indent=1) + ";\n")
print(f"wrote src/phones.js: {len(out)} phones")
for p in out:
    s = p["spec"]; print(f"  {p['name']:20s} {s['width']} x {s['length']} x {s['thickness']}  R~{s['cornerRadius']}  cutouts {len(s['cutouts'])}  side openings {len(s['sideCutouts'])}")
