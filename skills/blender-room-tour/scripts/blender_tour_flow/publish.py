"""Public preview boundary: only these files may ever be served.

Source frames, references, observations, recipes, .blend files, renders, logs,
and job metadata files stay in the private build directory. Textures embedded
in room.glb are served, including their pixels and embedded image metadata.
"""
import json
import struct
from pathlib import Path

PUBLIC_FILES = {
    'index.html': 'text/html; charset=utf-8',
    'viewer.js': 'text/javascript; charset=utf-8',
    'playcanvas.min.js': 'text/javascript; charset=utf-8',
    'PLAYCANVAS-LICENSE.txt': 'text/plain; charset=utf-8',
    'room.glb': 'model/gltf-binary',
    'viewer.json': 'application/json',
}
VIEWER_ASSETS = ('index.html', 'viewer.js', 'playcanvas.min.js', 'PLAYCANVAS-LICENSE.txt')
GENERATOR = 'blender-room-tour'


def _strip_extras(value):
    if isinstance(value, dict):
        return {k: _strip_extras(v) for k, v in value.items() if k != 'extras'}
    if isinstance(value, list):
        return [_strip_extras(v) for v in value]
    return value


def sanitize_glb(data):
    """Return (gltf_json, glb_bytes) without extras, generator, or external URIs.

    Node and material names are kept: they are authored semantic IDs the viewer
    and glazing check rely on. Mesh, image, texture, and sampler names become
    generic indexes so source file names cannot leak through them.
    """
    if len(data) < 20:
        raise ValueError('GLB too short')
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise ValueError('Not a glTF 2.0 binary')
    json_len, json_type = struct.unpack_from('<I4s', data, 12)
    if json_type != b'JSON':
        raise ValueError('First GLB chunk must be JSON')
    gltf = json.loads(data[20:20 + json_len])
    rest = data[20 + json_len:]
    gltf = _strip_extras(gltf)
    gltf['asset'] = {'version': gltf.get('asset', {}).get('version', '2.0'), 'generator': GENERATOR}
    generic = {'meshes': 'mesh', 'images': 'image', 'textures': 'texture', 'samplers': None,
               'scenes': 'scene', 'animations': 'animation', 'cameras': 'camera',
               'skins': 'skin', 'accessors': None, 'bufferViews': None, 'buffers': None}
    for key, prefix in generic.items():
        for i, item in enumerate(gltf.get(key, [])):
            item.pop('name', None)
            if prefix:
                item['name'] = f'{prefix}_{i}'
    for image in gltf.get('images', []):
        if 'uri' in image:
            raise ValueError('Preview GLB must embed images; external or data URIs are not published')
    for buffer in gltf.get('buffers', []):
        if 'uri' in buffer:
            raise ValueError('Preview GLB buffers must be embedded')
    body = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode()
    body += b' ' * (-len(body) % 4)
    out = struct.pack('<I4s', len(body), b'JSON') + body + rest
    return gltf, struct.pack('<4sII', b'glTF', 2, 12 + len(out)) + out


def check_glazing(gltf, declared):
    """Transparent materials in the GLB must equal the recipe's declared glazing."""
    materials = {m.get('name'): m for m in gltf.get('materials', [])}
    missing = [n for n in declared if n not in materials]
    if missing:
        raise ValueError(f'Declared glazing materials not exported: {missing}')
    opaque = [n for n in declared if materials[n].get('alphaMode') != 'BLEND']
    if opaque:
        raise ValueError(f'Declared glazing exported opaque (set Principled Alpha below 1): {opaque}')
    undeclared = sorted(n or '<unnamed>' for n, m in materials.items()
                        if m.get('alphaMode') == 'BLEND' and n not in declared)
    if undeclared:
        raise ValueError(f'Undeclared transparent materials: {undeclared}; add them to "glazing" or make them opaque')


def public_strings(viewer, gltf):
    """All exported JSON string values, including extension metadata."""
    def strings(value):
        if isinstance(value, str): yield value
        elif isinstance(value, dict):
            for item in value.values(): yield from strings(item)
        elif isinstance(value, list):
            for item in value: yield from strings(item)
    return list(strings(viewer)) + list(strings(gltf))


def embedded_images(gltf):
    """Inventory published texture payloads; pixels and metadata need visual review."""
    views = gltf.get('bufferViews', [])
    images = []
    for i, item in enumerate(gltf.get('images', [])):
        index = item.get('bufferView')
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(views):
            raise ValueError('Embedded image must reference a valid bufferView')
        size = views[index].get('byteLength')
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError('Embedded image must have a valid byte length')
        images.append({'name': f'image_{i}', 'mime_type': item.get('mimeType', ''), 'bytes': size})
    return {'count': len(images), 'bytes': sum(i['bytes'] for i in images), 'images': images}


def assert_public_text(strings, forbidden):
    forbidden = [f.casefold() for f in forbidden if f and len(f) > 3]
    for s in strings:
        for f in forbidden:
            if f in s.casefold():
                raise ValueError(f'Public text contains a private path or source name: {s!r}')


def check_public(public):
    """The public directory must contain exactly the allowlist as regular files."""
    public = Path(public)
    if public.is_symlink() or not public.is_dir():
        raise ValueError(f'Public directory missing: {public}')
    entries = {p.name: p for p in public.iterdir()}
    if set(entries) != set(PUBLIC_FILES):
        raise ValueError(f'Public directory must contain exactly {sorted(PUBLIC_FILES)}; found {sorted(entries)}')
    for p in entries.values():
        if p.is_symlink() or not p.is_file():
            raise ValueError(f'Public entry must be a regular file: {p.name}')
    return public.resolve()
