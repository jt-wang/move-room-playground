#!/usr/bin/env python3
"""Generate the invented practice room used by the public demo.

Standard library only; output is byte-for-byte deterministic. Writes:
  assets/room.glb        floor, two walls with a fixed window, one fixed cabinet
  assets/room.json       semantic groups read by the app (no doors, one level)
  assets/clay-normal.png tileable procedural normal map for the clay look
  assets/preview.png     flat plan illustration for the room picker card
  assets/og.png          1200x630 plan illustration for link previews

Every dimension below is invented. Nothing is derived from a real property,
photo, scan or floorplan.

Usage: python3 scripts/generate-demo.py [--out DIR]   (default: ./assets)
"""
import argparse, json, math, struct, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Invented room: 5.6 m x 4.0 m floor centred on the origin, 2.5 m walls.
FLOOR_X, FLOOR_Z, WALL_H, WALL_T = 2.8, 2.0, 2.5, 0.12
WINDOW_X, WINDOW_Y = (0.7, 2.1), (0.9, 2.1)

COLORS = {
    'Floor boards': (0.80, 0.70, 0.56, 1.0),
    'Wall paint': (0.93, 0.91, 0.86, 1.0),
    'Window frame': (0.42, 0.50, 0.46, 1.0),
    'Window glazing': (0.70, 0.84, 0.86, 0.25),
    'Cabinet body': (0.62, 0.70, 0.60, 1.0),
    'Cabinet top': (0.86, 0.80, 0.70, 1.0),
}


def box(name, material, lo, hi):
    return {'name': name, 'material': material, 'lo': lo, 'hi': hi}


def room_parts():
    """Return {group name: [boxes]}; boxes are axis-aligned (min, max) corners in metres."""
    x0, x1 = WINDOW_X; y0, y1 = WINDOW_Y; bz = (-FLOOR_Z - WALL_T, -FLOOR_Z)
    walls = [
        box('Back wall west', 'Wall paint', (-FLOOR_X - WALL_T, 0, bz[0]), (x0, WALL_H, bz[1])),
        box('Back wall east', 'Wall paint', (x1, 0, bz[0]), (FLOOR_X, WALL_H, bz[1])),
        box('Back wall below window', 'Wall paint', (x0, 0, bz[0]), (x1, y0, bz[1])),
        box('Back wall above window', 'Wall paint', (x0, y1, bz[0]), (x1, WALL_H, bz[1])),
        box('Left wall', 'Wall paint', (-FLOOR_X - WALL_T, 0, -FLOOR_Z), (-FLOOR_X, WALL_H, FLOOR_Z)),
        box('Window mullion', 'Window frame', ((x0 + x1) / 2 - 0.025, y0, bz[0] + 0.03), ((x0 + x1) / 2 + 0.025, y1, bz[1] - 0.03)),
        box('Window pane', 'Window glazing', (x0, y0, bz[0] + 0.05), (x1, y1, bz[1] - 0.05)),
    ]
    return {
        'Floor': [box('Floor slab', 'Floor boards', (-FLOOR_X, -0.08, -FLOOR_Z), (FLOOR_X, 0, FLOOR_Z))],
        'Walls': walls,
        'Fixed cabinet': [
            box('Cabinet body', 'Cabinet body', (-FLOOR_X, 0, 0.6), (-FLOOR_X + 0.4, 0.86, 1.8)),
            box('Cabinet top', 'Cabinet top', (-FLOOR_X, 0.86, 0.58), (-FLOOR_X + 0.42, 0.9, 1.82)),
        ],
    }


GROUP_KINDS = {'Floor': 'floor', 'Walls': 'walls', 'Fixed cabinet': 'object'}


def box_geometry(half):
    """24 vertices (flat normals per face), 36 uint16 indices, centred on the origin."""
    positions, normals, indices = [], [], []
    for a in range(3):
        b, c = (a + 1) % 3, (a + 2) % 3
        for s in (1, -1):
            start = len(positions)
            for u, v in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = [0.0, 0.0, 0.0]; p[a] = s * half[a]; p[b] = u * half[b]; p[c] = v * half[c]
                n = [0.0, 0.0, 0.0]; n[a] = float(s)
                positions.append(p); normals.append(n)
            quad = (0, 1, 2, 0, 2, 3) if s > 0 else (0, 2, 1, 0, 3, 2)
            indices += [start + i for i in quad]
    return positions, normals, indices


def build_glb():
    groups = room_parts()
    materials = list(COLORS)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'move-room scripts/generate-demo.py',
                  'extras': {'synthetic': True, 'note': 'Invented practice room; not a real property.'}},
        'scene': 0, 'scenes': [{'name': 'Synthetic practice room', 'nodes': []}],
        'nodes': [], 'meshes': [], 'accessors': [], 'bufferViews': [], 'buffers': [],
        'materials': [],
    }
    for name in materials:
        r, g, b, alpha = COLORS[name]
        m = {'name': name, 'pbrMetallicRoughness': {'baseColorFactor': [r, g, b, alpha], 'metallicFactor': 0.0, 'roughnessFactor': 0.9}}
        if alpha < 1: m['alphaMode'] = 'BLEND'
        gltf['materials'].append(m)
    blob = bytearray()

    def view(data, target):
        while len(blob) % 4: blob.append(0)
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data); return len(gltf['bufferViews']) - 1

    def accessor(values, kind):
        if kind == 'index':
            data = struct.pack('<%dH' % len(values), *values)
            gltf['accessors'].append({'bufferView': view(data, 34963), 'componentType': 5123, 'count': len(values), 'type': 'SCALAR'})
        else:
            flat = [x for v in values for x in v]
            data = struct.pack('<%df' % len(flat), *flat)
            acc = {'bufferView': view(data, 34962), 'componentType': 5126, 'count': len(values), 'type': 'VEC3'}
            if kind == 'position':
                # min/max must equal the float32-rounded data.
                rounded = [struct.unpack('<3f', struct.pack('<3f', *v)) for v in values]
                acc['min'] = [min(v[i] for v in rounded) for i in range(3)]
                acc['max'] = [max(v[i] for v in rounded) for i in range(3)]
            gltf['accessors'].append(acc)
        return len(gltf['accessors']) - 1

    for group, parts in groups.items():
        children = []
        for part in parts:
            lo, hi = part['lo'], part['hi']
            half = [round((hi[i] - lo[i]) / 2, 6) for i in range(3)]
            centre = [round((hi[i] + lo[i]) / 2, 6) for i in range(3)]
            positions, normals, indices = box_geometry(half)
            prim = {'attributes': {'POSITION': accessor(positions, 'position'), 'NORMAL': accessor(normals, 'normal')},
                    'indices': accessor(indices, 'index'), 'material': materials.index(part['material']), 'mode': 4}
            gltf['meshes'].append({'name': part['name'], 'primitives': [prim]})
            gltf['nodes'].append({'name': part['name'], 'mesh': len(gltf['meshes']) - 1, 'translation': centre})
            children.append(len(gltf['nodes']) - 1)
        gltf['nodes'].append({'name': group, 'children': children})
        gltf['scenes'][0]['nodes'].append(len(gltf['nodes']) - 1)
    while len(blob) % 4: blob.append(0)
    gltf['buffers'].append({'byteLength': len(blob)})
    body = json.dumps(gltf, separators=(',', ':'), sort_keys=True).encode()
    body += b' ' * (-len(body) % 4)
    chunks = struct.pack('<I4s', len(body), b'JSON') + body + struct.pack('<I4s', len(blob), b'BIN\0') + bytes(blob)
    return struct.pack('<4sII', b'glTF', 2, 12 + len(chunks)) + chunks


def room_meta():
    return {
        'synthetic': True,
        'name': 'Synthetic practice room',
        'note': 'Invented geometry generated by scripts/generate-demo.py. Not a real property; no doors; one level.',
        'units': 'metres (invented)',
        'floor': {'width': FLOOR_X * 2, 'depth': FLOOR_Z * 2, 'wallHeight': WALL_H},
        'groups': [{'name': name, 'kind': kind} for name, kind in GROUP_KINDS.items()],
        'doors': [],
    }


# ---------- PNG ----------

def png(width, height, pixel_rows):
    raw = b''.join(b'\0' + bytes(row) for row in pixel_rows)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def clay_normal(size=256):
    """Tileable soft bumps: a fixed sum of integer-frequency sinusoids, analytic normals."""
    waves = []
    state = 20260403
    for _ in range(14):  # small LCG so the pattern never depends on Python's random module
        vals = []
        for _ in range(4):
            state = (state * 1103515245 + 12345) % 2**31
            vals.append(state / 2**31)
        fx, fy = 1 + int(vals[0] * 9), int(vals[1] * 19) - 9
        waves.append((fx, fy, 0.35 + vals[2] * 0.65, vals[3] * 2 * math.pi))
    strength = 0.018
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            dx = dy = 0.0
            for fx, fy, amp, phase in waves:
                k = 2 * math.pi / size
                c = math.cos(k * (fx * x + fy * y) + phase) * amp / (fx * fx + fy * fy) ** 0.5
                dx += c * fx * k * size; dy += c * fy * k * size
            n = (-dx * strength, -dy * strength, 1.0)
            length = math.sqrt(sum(v * v for v in n))
            row += bytes(int(round((v / length * 0.5 + 0.5) * 255)) for v in n)
        rows.append(row)
    return png(size, size, rows)


# Footprints for the illustration mirror DEFAULT_LAYOUT in layout.mjs (x, z, width, depth, colour).
PLAN_FURNITURE = [
    (-0.6, -0.3, 2.5, 1.7, (229, 138, 108)),   # rug
    (-0.6, -1.56, 2.25, 0.83, (82, 163, 160)), # sofa
    (1.5, 0.7, 1.55, 0.94, (191, 148, 112)),   # table
    (1.5, -0.2, 0.6, 0.66, (128, 155, 201)),   # chair
    (1.5, 1.6, 0.6, 0.66, (128, 155, 201)),    # chair
    (2.3, -1.55, 0.74, 0.74, (68, 125, 88)),   # plant
]


def plan_image(width, height):
    """Flat top-down plan drawing of the invented room; honest artwork, not a render or photo."""
    bg, floor, wall, glass, cabinet = (244, 240, 231), (226, 208, 178), (120, 128, 118), (150, 200, 205), (158, 178, 152)
    pixels = [[bg] * width for _ in range(height)]
    span_x, span_z = 2 * FLOOR_X + 1.0, 2 * FLOOR_Z + 1.0
    scale = min(width / span_x, height / span_z) * 0.9
    ox, oz = width / 2, height / 2

    def rect(x0, z0, x1, z1, colour):
        px0, px1 = int(round(ox + x0 * scale)), int(round(ox + x1 * scale))
        pz0, pz1 = int(round(oz + z0 * scale)), int(round(oz + z1 * scale))
        for py in range(max(0, pz0), min(height, pz1)):
            row = pixels[py]
            for px in range(max(0, px0), min(width, px1)): row[px] = colour

    # Diagonal hatching marks the drawing as a synthetic diagram.
    for py in range(height):
        for px in range(width):
            if (px + py) % 24 < 2: pixels[py][px] = (236, 231, 219)
    rect(-FLOOR_X, -FLOOR_Z, FLOOR_X, FLOOR_Z, floor)
    rect(-FLOOR_X - WALL_T, -FLOOR_Z - WALL_T, FLOOR_X, -FLOOR_Z, wall)
    rect(-FLOOR_X - WALL_T, -FLOOR_Z, -FLOOR_X, FLOOR_Z, wall)
    rect(WINDOW_X[0], -FLOOR_Z - WALL_T, WINDOW_X[1], -FLOOR_Z, glass)
    rect(-FLOOR_X, 0.6, -FLOOR_X + 0.4, 1.8, cabinet)
    for x, z, w, d, colour in PLAN_FURNITURE:
        shade = tuple(int(c * 0.72) for c in colour)
        rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2, shade)
        inset = 0.05
        rect(x - w / 2 + inset, z - d / 2 + inset, x + w / 2 - inset, z + d / 2 - inset, colour)
    return png(width, height, [bytearray(b for p in row for b in p) for row in pixels])


def outputs():
    return {
        'room.glb': build_glb(),
        'room.json': (json.dumps(room_meta(), indent=1, sort_keys=True) + '\n').encode(),
        'clay-normal.png': clay_normal(),
        'preview.png': plan_image(640, 360),
        'og.png': plan_image(1200, 630),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--out', type=Path, default=ROOT / 'assets')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for name, data in outputs().items():
        (args.out / name).write_bytes(data)
        print(f'{args.out / name} {len(data)} bytes')


if __name__ == '__main__':
    main()
