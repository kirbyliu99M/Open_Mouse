"""Downsample lossless source maps without touching geometry."""
from check_catalogues import check_no_shell_assets
import argparse
from io import BytesIO
import json
from pathlib import Path
import struct
from PIL import Image
from pretty_json import write_pretty_json

ROOT = Path(__file__).resolve().parents[2] / 'public/models'


def optimize(path: Path, source_path: Path, size=512, quality=82):
    if not source_path.is_file():
        raise FileNotFoundError(f'Lossless source GLB required for repeatable optimization: {source_path}')
    blob = source_path.read_bytes()
    magic, version, total = struct.unpack_from('<4sII', blob)
    if magic != b'glTF' or version != 2 or total != len(blob):
        raise ValueError(f'Invalid GLB: {path}')
    json_size, json_type = struct.unpack_from('<I4s', blob, 12)
    data = json.loads(blob[20:20 + json_size])
    bin_header = 20 + json_size
    bin_size, bin_type = struct.unpack_from('<I4s', blob, bin_header)
    if json_type != b'JSON' or bin_type != b'BIN\0':
        raise ValueError(f'Unexpected GLB chunks: {path}')
    binary = blob[bin_header + 8:bin_header + 8 + bin_size]
    images = {image['bufferView']: image for image in data.get('images', [])}
    rewritten = bytearray()
    normal_sizes = []
    for index, view in enumerate(data['bufferViews']):
        chunk = binary[view['byteOffset']:view['byteOffset'] + view['byteLength']]
        if index in images:
            image = images[index]
            if image['mimeType'] != 'image/png':
                raise ValueError(f'Expected lossless PNG source map: {source_path}: {image["name"]}')
            with Image.open(BytesIO(chunk)) as source:
                source = source.convert('RGB')
                source.thumbnail((size, size), Image.Resampling.LANCZOS)
                output = BytesIO()
                if 'normal' in image.get('name', '').lower():
                    comparison = BytesIO()
                    source.save(comparison, format='PNG', optimize=True)
                    source.save(output, format='JPEG', quality=90, subsampling=0, optimize=True)
                    normal_sizes.append((len(comparison.getvalue()), len(output.getvalue())))
                else:
                    source.save(output, format='JPEG', quality=quality, optimize=True)
                chunk = output.getvalue()
            image['mimeType'] = 'image/jpeg'
        view['byteOffset'] = len(rewritten)
        view['byteLength'] = len(chunk)
        rewritten.extend(chunk)
        rewritten.extend(b'\0' * (-len(rewritten) % 4))
    data['buffers'][0]['byteLength'] = len(rewritten)
    encoded = json.dumps(data, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    output = bytearray(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(encoded) + 8 + len(rewritten)))
    output.extend(struct.pack('<I4s', len(encoded), b'JSON'))
    output.extend(encoded)
    output.extend(struct.pack('<I4s', len(rewritten), b'BIN\0'))
    output.extend(rewritten)
    path.write_bytes(output)
    return len(blob), len(output), len(images), normal_sizes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--model')
    args = parser.parse_args()
    manifest_path = ROOT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    check_no_shell_assets(manifest, ROOT)
    entries = [entry for entry in [*manifest['shells'], *manifest['studies']] if not entry.get('aliasOf')]
    if args.model:
        selected = set(args.model.split(','))
        entries = [entry for entry in entries if entry['slug'] in selected]
        if not entries: raise ValueError(f'Unknown model: {args.model}')
    for entry in entries:
        path = ROOT / entry['path']
        if args.check:
            data = path.read_bytes()
            count = sum(data.count(x) for x in (b'image/png',))
            if count:
                raise RuntimeError(f'Uncompressed PNG maps remain: {path}')
            if path.stat().st_size != entry['bytes']:
                raise ValueError(f'GLB size mismatch: {path}')
        else:
            source_path = Path(__file__).resolve().parent / 'out/polished' / entry['slug'] / (entry['slug'] + '.glb')
            before, after, maps, normal_sizes = optimize(path, source_path)
            entry['bytes'] = after
            texture = {'format': 'JPEG', 'maxResolution': 512, 'maps': maps}
            if normal_sizes:
                texture['normalEncoding'] = 'JPEG q90 4:4:4'
            entry['deliveredTexture'] = texture
            print(entry['slug'], 'source', before, 'delivered', after, 'maps', maps, 'normal PNG/JPEG bytes', normal_sizes)
    if not args.check:
        by_slug = {entry['slug']: entry for entry in manifest['shells'] + manifest['studies']}
        for alias in (entry for entry in manifest['shells'] if entry.get('aliasOf')):
            source = by_slug[alias['aliasOf']]
            alias['bytes'] = source['bytes']
            alias['deliveredTexture'] = source['deliveredTexture']
        write_pretty_json(manifest_path, manifest)
        validation_path = ROOT / 'validation.json'
        validation = json.loads(validation_path.read_text(encoding='utf-8'))
        sizes = {entry['slug']: entry['bytes'] for entry in manifest['shells'] + manifest['studies']}
        for entry in validation['roundTrips']:
            if entry['slug'] in sizes: entry['bytes'] = sizes[entry['slug']]
        write_pretty_json(validation_path, validation)


if __name__ == '__main__':
    main()
