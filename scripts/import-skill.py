#!/usr/bin/env python3
"""Import a verified skill build into a fresh local furniture app; no uploads."""
import argparse, hashlib, json, math, re, shutil, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'skills/blender-room-tour/scripts')]
import build_public
from blender_tour_flow import doors as door_contract
from blender_tour_flow.cli import current
from blender_tour_flow.publish import sanitize_glb, assert_public_text, public_strings


def vector(value):
    if not isinstance(value, list) or len(value) != 3 or not all(type(x) in (int, float) and math.isfinite(x) and abs(x) <= 1000 for x in value):
        raise ValueError('Expected three finite coordinates within 1000 metres')
    return value


def _finite(values):
    return isinstance(values, list) and all(type(x) in (int, float) and math.isfinite(x) for x in values)


def _matrix(node):
    """Local 4x4 (row-major) from glTF TRS; any malformed transform is refused."""
    if 'matrix' in node:
        m = node['matrix']
        if not _finite(m) or len(m) != 16: raise ValueError('Invalid node matrix')
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t, q, s = node.get('translation', [0, 0, 0]), node.get('rotation', [0, 0, 0, 1]), node.get('scale', [1, 1, 1])
    if not (_finite(t) and len(t) == 3 and _finite(q) and len(q) == 4 and _finite(s) and len(s) == 3):
        raise ValueError('Invalid node transform')
    if abs(math.hypot(*q) - 1) > 1e-3: raise ValueError('Node rotation must be a unit quaternion')
    x, y, z, w = q
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def _mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def group_geometry(gltf, names):
    """World pivot and mesh AABB (web coordinates) of each named top-level group root."""
    nodes, accessors, meshes = gltf.get('nodes', []), gltf.get('accessors', []), gltf.get('meshes', [])
    lookup = {n.get('name'): i for i, n in enumerate(nodes)}
    result = {}
    for name in names:
        root = nodes[lookup[name]]
        if 'matrix' in root: raise ValueError(f'Door part {name} must use translation/rotation, not a matrix')
        if any(abs(v - 1) > 1e-6 for v in root.get('scale', [1, 1, 1])): raise ValueError(f'Door part {name} root must be unscaled')
        world = _matrix(root)
        points, stack = [], [(lookup[name], world)]
        while stack:
            index, matrix = stack.pop()
            node = nodes[index]
            if 'mesh' in node:
                for prim in meshes[node['mesh']].get('primitives', []):
                    acc = accessors[prim['attributes']['POSITION']]
                    lo, hi = acc.get('min'), acc.get('max')
                    if not (_finite(lo) and _finite(hi) and len(lo) == len(hi) == 3): raise ValueError('Mesh bounds missing')
                    for c in [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]:
                        points.append([sum(matrix[i][k] * (c[k] if k < 3 else 1) for k in range(4)) for i in range(3)])
            for child in node.get('children', []):
                stack.append((child, _mul(matrix, _matrix(nodes[child]))))
        if not points: raise ValueError(f'Door part {name} has no mesh')
        result[name] = {'pivot': [world[0][3], world[1][3], world[2][3]],
                        'min': [min(p[i] for p in points) for i in range(3)], 'max': [max(p[i] for p in points) for i in range(3)]}
    return result


def blender(v):
    """Web (x, y, z) back to Blender (x, -z, y)."""
    return [v[0], -v[2], v[1]]


def check_door_geometry(gltf, spec):
    names = [p['name'] for d in spec['doors'] for p in d['parts']]
    geometry = group_geometry(gltf, names)
    bounds, pivots = {}, {}
    for name, g in geometry.items():
        a, b = blender(g['min']), blender(g['max'])
        bounds[name] = {'min': [min(a[i], b[i]) for i in range(3)], 'max': [max(a[i], b[i]) for i in range(3)]}
        pivots[name] = blender(g['pivot'])
    return door_contract.check_geometry(spec, bounds, pivots)


def validate(viewer, gltf, spec, legacy=False):
    if isinstance(spec, dict) and 'schema_version' in spec:
        door_contract.validate_spec(spec)
        lo, hi = None, None
    elif not legacy:
        raise ValueError('interaction.json lacks "schema_version": 2. Schema 1 used web-space angles that the app negates; '
                         'rewrite it in Blender coordinates (see the skill reference), or pass --legacy-v1-interaction '
                         'to reproduce a legacy import unchanged')
    else:
        if set(spec) != {'id', 'bounds', 'doors'}: raise ValueError('Use exactly id, bounds, doors; this adapter supports one level')
        ident = spec['id']
        if not isinstance(ident, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', ident) or ident == 'practice-room': raise ValueError('Invalid or reserved room ID')
        bounds = spec['bounds']
        if not isinstance(bounds, dict) or set(bounds) != {'min', 'max'}: raise ValueError('Expected min/max bounds')
        lo, hi = vector(bounds['min']), vector(bounds['max'])
        if any(a >= b for a, b in zip(lo, hi)) or lo[1] != 0: raise ValueError('Bounds must be increasing, Y up, with single-level floor at Y=0')
    nodes = gltf.get('nodes', [])
    names = [n['name'] for n in nodes if n.get('name')]
    if len(names) != len(set(names)): raise ValueError('Duplicate GLB node names')
    def no_uri(value):
        if isinstance(value, dict):
            if 'uri' in value: raise ValueError('External/data URI refused')
            for x in value.values(): no_uri(x)
        elif isinstance(value, list):
            for x in value: no_uri(x)
    no_uri(gltf)
    groups = viewer.get('groups', [])
    group_names = [g.get('name') for g in groups]
    if not groups or len(group_names) != len(set(group_names)): raise ValueError('Missing or duplicate groups')
    for g in groups:
        if g.get('name') not in names or g.get('kind') not in {'floor', 'walls', 'ceiling', 'object'}: raise ValueError('Missing GLB node or invalid group kind')
        if 'level' in g: raise ValueError('Multiple levels are outside this adapter')
    if not any(g['kind'] == 'floor' for g in groups): raise ValueError('A floor group is required')
    # Do not allow a moving part to remain inside another collision group.
    lookup = {n.get('name'): i for i, n in enumerate(nodes)}
    def descendants(i, seen=None):
        seen = set() if seen is None else seen
        if type(i) is not int or not 0 <= i < len(nodes) or i in seen: raise ValueError('Invalid/cyclic node graph')
        seen.add(i)
        for child in nodes[i].get('children', []): descendants(child, seen)
        return seen
    owned = set()
    for name in group_names:
        branch = descendants(lookup[name])
        if owned & branch: raise ValueError('Overlapping groups')
        if not any('mesh' in nodes[i] for i in branch): raise ValueError('Empty collision group')
        owned |= branch
    kinds = {g['name']: g['kind'] for g in groups}
    if lo is None:
        # Schema 2: geometry checks use the exported nodes; bounds become web Y-up.
        for door in spec['doors']:
            for part in door['parts']:
                if kinds.get(part['name']) != 'object': raise ValueError('Door part must be a unique separate object group')
        check_door_geometry(gltf, spec)
        bounds, _ = door_contract.to_runtime(spec)
        ident, lo, hi = spec['id'], bounds['min'], bounds['max']
    door_ids, parts = set(), set()
    if not isinstance(spec['doors'], list): raise ValueError('Doors must be a list')
    for door in (spec['doors'] if 'schema_version' not in spec else []):
        if set(door) != {'id', 'kind', 'ordinal', 'parts'} or door['kind'] not in ('door', 'window') or type(door['ordinal']) is not int or not 1 <= door['ordinal'] <= 99: raise ValueError('Invalid door definition')
        if not isinstance(door['id'], str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', door['id']) or door['id'] in door_ids: raise ValueError('Invalid/duplicate door ID')
        door_ids.add(door['id'])
        if not isinstance(door['parts'], list) or not door['parts']: raise ValueError('Door requires parts')
        for part in door['parts']:
            if set(part) not in ({'name', 'angle'}, {'name', 'slide'}): raise ValueError('Specify one motion per part')
            name = part['name']
            if name in parts or name not in group_names or next(g['kind'] for g in groups if g['name'] == name) != 'object': raise ValueError('Door part must be a unique separate object group')
            parts.add(name)
            if 'angle' in part:
                angle = part['angle']
                if type(angle) not in (int, float) or not math.isfinite(angle) or not 0 < abs(angle) <= 180: raise ValueError('Invalid hinge angle')
            elif not 0 < math.dist(vector(part['slide']), [0, 0, 0]) <= 4: raise ValueError('Invalid sliding distance')
    dims = [b-a for a,b in zip(lo,hi)]
    radius = math.hypot(*dims)/2
    return {'id': ident, 'title': viewer['title'], 'synthetic': viewer['synthetic'], 'imported': True,
            'assetBase': 'assets/room', 'bounds': bounds, 'center': [(lo[0]+hi[0])/2, min(hi[1]/2, .8), (lo[2]+hi[2])/2],
            'minDistance': max(.5, radius*.4), 'maxDistance': max(20, radius*5), 'plinth': [dims[0]+.4,.3,dims[2]+.4]}


def runtime_doors(spec):
    """Schema 2 doors become explicit web `yaw`/`slide` parts; legacy doors are copied unchanged."""
    return door_contract.to_runtime(spec)[1] if 'schema_version' in spec else spec['doors']


def run(job, interaction, out, legacy=False):
    job, out = Path(job).resolve(), Path(out).absolute()
    if out.exists() or out.is_symlink(): raise ValueError('Output must be a new directory; existing work is never overwritten')
    receipt_path = out.with_name(out.name+'-receipt.json')
    if receipt_path.exists(): raise ValueError('Receipt already exists')
    build, state = current(job)
    viewer = json.loads((build/'public/viewer.json').read_text())
    spec = json.loads(Path(interaction).read_text())
    gltf, glb = sanitize_glb((build/'public/room.glb').read_bytes())
    config = validate(viewer, gltf, spec, legacy)
    source = (json.loads((job/'metadata.json').read_text()).get('source') or {}).get('video', '')
    meta = {'name': viewer['title'], 'synthetic': viewer['synthetic'], 'units': 'metres (estimated)', 'groups': viewer['groups'], 'doors': runtime_doors(spec)}
    assert_public_text(public_strings({'config':config,'meta':meta}, gltf), [str(job),str(Path.home()),source,Path(source).name])
    allowed = set(build_public.ALLOWLIST)
    sources = {name: build_public.checked_source(ROOT,name) for name in allowed}
    build_public.check_references(ROOT,allowed)
    out.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.import-staging-',dir=out.parent))
    try:
        for name, source_file in sources.items():
            dest=staging/name; dest.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(source_file,dest)
        (staging/'assets/room.glb').write_bytes(glb)
        (staging/'assets/room.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
        (staging/'imported-room.mjs').write_text('export default '+json.dumps(config,ensure_ascii=False)+';\n')
        files={name:hashlib.sha256((staging/name).read_bytes()).hexdigest() for name in sorted(allowed)}
        staging.rename(out)
        receipt_path.write_text(json.dumps({'generator':'import-skill.py','root':out.name,'files':files},indent=2)+'\n')
    finally:
        if staging.exists(): shutil.rmtree(staging)
    return out,receipt_path

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--job',type=Path,required=True);p.add_argument('--interaction',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--legacy-v1-interaction',action='store_true',help='reproduce a schema 1 import unchanged (web-space angles the app negates)');a=p.parse_args()
    try:
        out,receipt=run(a.job,a.interaction,a.out,a.legacy_v1_interaction)
        from blender_tour_flow.review import status
        print(f'Local app: {out}\nReceipt: {receipt}\nServe with ROOM_PUBLIC_DIR and ROOM_RECEIPT pointing to these paths: node serve.mjs')
        print(f'Visual review of this build: {status(a.job)}. Importing is a functional step, not a fidelity verdict; embedded textures still need review.')
    except (ValueError,KeyError,TypeError,OSError) as e:p.exit(1,f'Import refused: {e}\n')
