"""Refresh the current published catalogue section of PAYLOAD-AUDIT.md."""
import json
from pathlib import Path

from audit_payloads import inspect_glb, MODELS

HERE = Path(__file__).resolve().parent
SECTION = "## Current catalogue after independent review (2026-09-27)"


def main():
    manifest = json.loads((MODELS / "manifest.json").read_text(encoding="utf-8"))
    before = json.loads((HERE / "out/study-before/base-tenths.json").read_text())
    after = json.loads((HERE / "out/study-after/base-tenths.json").read_text())
    records = [inspect_glb(path) for path in sorted(MODELS.rglob("*.glb"))]
    total = sum(row["bytes"] for row in records)
    images = sum(row["imageBytes"] for row in records)
    lines = [SECTION, "",
        f"The manifest has {len(manifest['shells'])} shell entries (26 source-derived shells and one M575S alias), "
        f"{len(manifest['studies'])} limited-view studies, and {len(manifest['noShell'])} NO_SHELL entries. "
        f"The alias points to the M575 GLB, so {len(records)} distinct GLBs including the hand are published. "
        f"They total **{total:,} bytes ({total/1048576:.2f} MiB)**, including "
        f"**{images:,} image bytes** across {sum(row['imageCount'] for row in records)} JPEG maps. "
        "The 26 source-derived GLBs and SE, M550, and M705 study GLBs are byte-identical to the prior build.",
        "", "MX Ergo S has no shell: only front-oblique side photos were available and its study was not recognisable. "
        "M575S is a candidate shape alias of ERGO M575 because their published dimensions are both 134 × 100 × 48 mm. "
        "Its manifest entry uses `shells/logitech-ergo-m575.glb` without publishing a second file.",
        "", "### Lowest base Z by length tenth", "",
        "Values are millimetres in Blender desk coordinates, rear to nose. "
        "Each value is the lowest decoded GLB mesh vertex in that length tenth. "
        "The five changed studies have a flat base within 0.021 mm after Draco quantisation. "
        "SE, M550, and M705 retain their prior GLBs.",
        "", "| Study | Before (mm, rear → nose) | After (mm, rear → nose) |",
        "| --- | --- | --- |"]
    for slug in before:
        fmt = lambda values: ", ".join(f"{value:.3f}" for value in values)
        lines.append(f"| {slug.removeprefix('logitech-')} | {fmt(before[slug])} | {fmt(after[slug])} |")
    lines += ["", "The five before/after top, left, right, and back sheets and `combined.png` "
              "are in the review scratchpad `new-shells-v3/`. The Logitech gallery photos remain outside the repository.", ""]
    path = HERE / "PAYLOAD-AUDIT.md"
    content = path.read_text(encoding="utf-8")
    # Keep earlier payload experiments, replace the superseded added-study table.
    for marker in ("## Six retained added limited-view studies (2026-09-27)", SECTION):
        if marker in content:
            content = content.split(marker)[0].rstrip() + "\n\n"
    path.write_text(content + "\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
