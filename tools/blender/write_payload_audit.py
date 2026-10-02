"""Regenerate the current payload inventory from the manifest and delivered GLBs."""
import json
from pathlib import Path
from audit_payloads import inspect_glb, MODELS

HERE = Path(__file__).resolve().parent
SECTION = '## Current catalogue (generated from manifest)'


def main():
    manifest = json.loads((MODELS / 'manifest.json').read_text(encoding='utf-8'))
    records = [inspect_glb(path) for path in sorted(MODELS.rglob('*.glb'))]
    aliases = [entry for entry in manifest['shells'] if entry.get('aliasOf')]
    total = sum(row['bytes'] for row in records)
    images = sum(row['imageBytes'] for row in records)
    lines = [SECTION, '',
        f"The manifest has {len(manifest['shells'])} shell entries "
        f"({len(manifest['shells']) - len(aliases)} source-derived shells and {len(aliases)} alias), "
        f"{len(manifest['studies'])} limited-view studies, and {len(manifest['noShell'])} NO_SHELL entries. "
        f"There are {len(records)} distinct GLBs including the hand, totalling "
        f"**{total:,} bytes ({total / 1048576:.2f} MiB)**, including "
        f"**{images:,} image bytes** across {sum(row['imageCount'] for row in records)} JPEG maps.", '',
        'Aliases share a delivered file; they do not add a GLB. Classification below comes from the current manifest. '
        'Earlier sections are historical payload experiments, not the current catalogue.', '',
        '| Model | Classification | Delivered file | Bytes |',
        '| --- | --- | --- | ---: |']
    for category in ('shells', 'studies'):
        for entry in manifest[category]:
            kind = 'Shell alias' if entry.get('aliasOf') else ('AR-derived shell' if category == 'shells' else 'Limited-view study')
            lines.append(f"| {entry['slug']} | {kind} | `{entry['path']}` | {entry['bytes']:,} |")
    for entry in aliases:
        lines.extend(['', f"`{entry['slug']}` aliases `{entry['aliasOf']}`; shape identity remains a candidate assumption."])
    path = HERE / 'PAYLOAD-AUDIT.md'
    content = path.read_text(encoding='utf-8')
    for marker in ('## Six retained added limited-view studies (2026-09-27)',
                   '## Current catalogue after independent review (2026-09-27)', SECTION):
        if marker in content:content = content.split(marker)[0].rstrip() + '\n\n'
    path.write_text(content + '\n'.join(lines) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
