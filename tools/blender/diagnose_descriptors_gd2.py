"""Plot our delivered geometry only; never reads labels or validation outputs."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from descriptor_geometry import plane_segments, section_wall_bounds
from measure_descriptors import ROOT, decode_shell


def main():
    output = ROOT / "tools/blender/out/descriptors/gd2"
    output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "public/models/manifest.json").read_text(encoding="utf-8"))
    entries = [e for e in manifest["shells"] + manifest["studies"] if not e.get("aliasOf")]
    evidence = []
    for start in range(0, len(entries), 6):
        canvas = Image.new("RGB", (1400, 6 * 290), "white")
        draw = ImageDraw.Draw(canvas)
        for row, entry in enumerate(entries[start:start + 6]):
            v, f = decode_shell(ROOT / "public/models" / entry["path"])
            v -= v.min(axis=0)
            width, length, height = np.ptp(v, axis=0)
            triangles = v[f]
            yoff = row * 290
            draw.text((15, yoff + 5), entry["model"], fill="black")
            sections = []
            for column, t in enumerate((.4, .5, .6)):
                seg = plane_segments(triangles, 1, length * (1 - t))
                z0, z1 = seg[:, :, 2].min(), seg[:, :, 2].max()
                scale = min(310 / width, 200 / height)
                def point(x, z):
                    return (20 + 345 * column + x * scale, yoff + 250 - z * scale)
                for a, b in seg:
                    draw.line([point(a[0], a[2]), point(b[0], b[2])], fill="#333333", width=2)
                bounds = [section_wall_bounds(seg, z0 + h * (z1 - z0)) for h in (.2, .5, .8)]
                for side in (0, 1):
                    draw.line([point(bounds[0][side], z0 + .2 * (z1-z0)),
                               point(bounds[2][side], z0 + .8 * (z1-z0))], fill="#dc2626", width=2)
                for h, xs in zip((.2, .5, .8), bounds):
                    for x in xs:
                        px, py = point(x, z0 + h * (z1-z0))
                        draw.ellipse((px-3, py-3, px+3, py+3), fill="#2563eb")
                draw.text((20 + 345 * column, yoff + 268), f"t={t:.1f}; red: old chord; blue: 20/50/80%", fill="black")
                hs = np.linspace(.05, .95, 91)
                xs = np.array([section_wall_bounds(seg, z0 + h * (z1-z0)) for h in hs])
                sections.append({"t": t, "heightMm": float(z1-z0), "heightFractions": hs.tolist(),
                                 "wallXmm": xs.tolist()})
            ts = np.linspace(.1, .75, 66)
            widths = []
            for t in ts:
                seg = plane_segments(triangles, 1, length * (1-t))
                widths.append(float(np.ptp(seg[:, :, 0])))
            def planpoint(t, w):
                return (1070 + (t-.1) / .65 * 300, yoff + 245 - w / width * 180)
            draw.line([planpoint(t, w) for t, w in zip(ts, widths)], fill="#333333", width=2)
            for t, color in ((1/3, "#dc2626"), (.4, "#2563eb"), (.6, "#2563eb")):
                x, _ = planpoint(t, 0)
                draw.line((x, yoff + 35, x, yoff + 250), fill=color)
            draw.text((1070, yoff + 255), "W(t), full projection; t=0.10 to 0.75", fill="black")
            draw.text((1070, yoff + 270), "red: 1/3; blue: grip endpoints", fill="black")
            evidence.append({"slug": entry["slug"], "sections": sections,
                             "planFractions": ts.tolist(), "planWidthsMm": widths})
        canvas.save(output / f"diagnosis-{start // 6 + 1}.png")
    (output / "diagnosis-sections.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(entries)} geometry diagnoses in {output}")


if __name__ == "__main__":
    main()
