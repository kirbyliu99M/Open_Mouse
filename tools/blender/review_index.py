"""Build a local navigable review page with source links and honest asset status."""
import html
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE/'out/reconstructed'
sources={p.parent.name:json.loads(p.read_text()) for p in (HERE/'out/reference-library').glob('*/sources.json')}
parts=['<!doctype html><meta charset="utf-8"><title>Open_Mouse reference rebuild</title><style>body{font:16px system-ui;background:#152027;color:#e9f0f2;margin:32px auto;max-width:1250px;padding:0 24px}a{color:#80d9ef}article{border-top:1px solid #43515a;padding:24px 0}img{max-width:100%;max-height:850px;object-fit:contain}small{color:#bacbd4}.study{color:#ffce80}h1{font-size:36px}</style><h1>Mouse reference rebuild</h1><p>26 reconstructions from calibrated manufacturer AR render/depth images. Four limited-view silhouette studies. All remain subject to visual review; these are fit meshes, with softened fine detail.</p><p><a href="../reference-library/index.html">Downloaded reference library</a> · <a href="catalogue-review.blend">Open the Blender catalogue scene</a></p>']
for path in sorted(ROOT.glob('*/reconstruction.json')):
    record=json.loads(path.read_text());slug=record['slug'];source=sources[slug]
    study=record.get('referenceMode')=='gallery-only'
    parts.append(f'<article><h2>{html.escape(source["model"])}</h2><p class="{"study" if study else ""}">{html.escape(record["status"])}</p>')
    parts.append(f'<p><a href="{slug}/{slug}.blend">Blender model</a> · <a href="{slug}/{slug}.glb">GLB</a> · <a href="../reference-library/index.html#{slug}">Source references</a> · <a href="{slug}/reconstruction.json">Build evidence</a></p>')
    if study:
        parts.append(f'<img src="{slug}/renders/elevated-225.png" loading="lazy"><p class="study">Top/side outlines traced from this model’s gallery. Cross-sections are interpolated; wheel/button details and unseen surfaces are not verified. No complete 360 capture is claimed.</p>')
    else:
        parts.append(f'<a href="{slug}/comparison.png"><img src="{slug}/comparison.png" loading="lazy"></a><p><small>Left: manufacturer reference render. Middle: rebuilt mesh. Right: registered silhouette outlines. Similarity is measured against these references, not against a physical scan.</small></p>')
    parts.append('</article>')
(ROOT/'index.html').write_text(''.join(parts),encoding='utf-8')
print('Review index written')
