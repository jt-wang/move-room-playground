"""Movable door/window interaction contract (interaction.json, schema_version 2).

Everything is authored in Blender Z-up metres, beside the recipe:
- A hinge ``angle`` is degrees counter-clockwise about Blender +Z seen from above
  (right-hand rule). +90 turns a leaf that extends along +X so it extends along +Y.
- ``slide`` is a Blender-space travel vector in metres.
- ``parent`` names another part of the same door. The part's pivot then rides on
  the parent's moving panel, so bifold leaves stay joined while they fold.
Each part is its own group whose EMPTY root sits on the hinge line (or anywhere
on a sliding leaf). Static frames, tracks and jambs are separate groups.

Blender (x, y, z) becomes web (x, z, -y), so a Blender +Z rotation is the same
signed rotation about web +Y. The importer writes it as ``yaw``; legacy schema 1
``angle`` metadata keeps the app's original -angle behaviour.
Standard library only; also runs inside Blender.
"""
import math
import re

DOOR_ID = re.compile(r'[a-z][a-z0-9-]{0,47}')
GROUP_ID = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,63}')
SPEC_KEYS = {'schema_version', 'coordinates', 'id', 'bounds', 'doors'}
PIVOT_TOLERANCE = .05


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def vector(value, what='vector'):
    if not isinstance(value, list) or len(value) != 3 or not all(_number(x) and abs(x) <= 1000 for x in value):
        raise ValueError(f'{what} must be three finite coordinates within 1000 metres')
    return value


def order_parts(parts):
    """Parents before children. Rejects duplicate names, cycles and missing parents."""
    by_name = {}
    for part in parts:
        if part['name'] in by_name:
            raise ValueError('Duplicate door part ' + part['name'])
        by_name[part['name']] = part
    state, ordered = {}, []

    def visit(part):
        mark = state.get(part['name'])
        if mark == 'done':
            return
        if mark == 'active':
            raise ValueError('Door part links form a cycle at ' + part['name'])
        state[part['name']] = 'active'
        if 'parent' in part:
            parent = by_name.get(part['parent'])
            if parent is None:
                raise ValueError(f'{part["name"]} names missing parent {part["parent"]}; parents must be parts of the same door')
            visit(parent)
        state[part['name']] = 'done'
        ordered.append(part)
    for part in parts:
        visit(part)
    return ordered


def validate_spec(spec):
    if not isinstance(spec, dict) or spec.get('schema_version') != 2:
        raise ValueError('interaction.json needs "schema_version": 2 (Blender-space hinge angles); '
                         'schema 1 files are legacy and import only with --legacy-v1-interaction')
    if set(spec) != SPEC_KEYS:
        raise ValueError('Use exactly ' + ', '.join(sorted(SPEC_KEYS)) + '; this adapter supports one level')
    if spec['coordinates'] != 'blender-z-up':
        raise ValueError('coordinates must be "blender-z-up"')
    ident = spec['id']
    if not isinstance(ident, str) or not DOOR_ID.fullmatch(ident) or ident == 'practice-room':
        raise ValueError('Invalid or reserved room ID')
    bounds = spec['bounds']
    if not isinstance(bounds, dict) or set(bounds) != {'min', 'max'}:
        raise ValueError('Expected min/max bounds')
    lo, hi = vector(bounds['min'], 'bounds.min'), vector(bounds['max'], 'bounds.max')
    if any(a >= b for a, b in zip(lo, hi)) or lo[2] != 0:
        raise ValueError('Bounds must increase on every axis, with the single floor at Blender Z=0')
    if not isinstance(spec['doors'], list):
        raise ValueError('Doors must be a list')
    door_ids, part_names = set(), set()
    for door in spec['doors']:
        if not isinstance(door, dict) or set(door) != {'id', 'kind', 'ordinal', 'parts'} or door['kind'] not in ('door', 'window') \
                or type(door['ordinal']) is not int or not 1 <= door['ordinal'] <= 99:
            raise ValueError('Invalid door definition')
        if not isinstance(door['id'], str) or not DOOR_ID.fullmatch(door['id']) or door['id'] in door_ids:
            raise ValueError('Invalid/duplicate door ID')
        door_ids.add(door['id'])
        if not isinstance(door['parts'], list) or not door['parts']:
            raise ValueError('Door requires parts')
        for part in door['parts']:
            if not isinstance(part, dict) or not set(part) <= {'name', 'angle', 'slide', 'parent'} or \
                    len({'angle', 'slide'} & set(part)) != 1:
                raise ValueError('Each part needs a name and exactly one of angle or slide')
            name = part.get('name')
            if not isinstance(name, str) or not GROUP_ID.fullmatch(name) or name in part_names:
                raise ValueError('Door part must name a unique group')
            part_names.add(name)
            if 'parent' in part and (not isinstance(part['parent'], str) or part['parent'] == name):
                raise ValueError(f'{name} parent must be another part of the same door')
            if 'angle' in part:
                if not _number(part['angle']) or not 0 < abs(part['angle']) <= 180:
                    raise ValueError('Invalid hinge angle; use degrees with 0 < |angle| <= 180')
            elif not 0 < math.dist(vector(part['slide'], 'slide'), [0, 0, 0]) <= 4:
                raise ValueError('Invalid sliding distance')
        order_parts(door['parts'])
    return spec


def _rotate(a, p):
    c, s = math.cos(a), math.sin(a)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2])


def apply(transform, point):
    angle, t = transform
    r = _rotate(angle, point)
    return tuple(r[i] + t[i] for i in range(3))


def compose(a, b):
    """a after b, both (angle about +Z, translation)."""
    t = _rotate(a[0], b[1])
    return (a[0] + b[0], tuple(t[i] + a[1][i] for i in range(3)))


def part_transforms(door, fraction, pivots):
    """World rigid motion of each part at an opening fraction in [0, 1], Blender coordinates."""
    out = {}
    for part in order_parts(door['parts']):
        o = pivots[part['name']]
        if 'slide' in part:
            local = (0.0, tuple(v * fraction for v in part['slide']))
        else:
            a = math.radians(part['angle']) * fraction
            r = _rotate(a, o)
            local = (a, tuple(o[i] - r[i] for i in range(3)))
        out[part['name']] = compose(out[part['parent']], local) if 'parent' in part else local
    return out


def web(v):
    return [v[0] + 0.0, v[2] + 0.0, -v[1] + 0.0]


def to_runtime(spec):
    """App metadata: web Y-up bounds and parts with explicit ``yaw`` (degrees about web +Y)."""
    lo, hi = spec['bounds']['min'], spec['bounds']['max']
    bounds = {'min': [lo[0] + 0.0, lo[2] + 0.0, -hi[1] + 0.0], 'max': [hi[0] + 0.0, hi[2] + 0.0, -lo[1] + 0.0]}
    doors = []
    for door in spec['doors']:
        parts = []
        for part in door['parts']:
            item = {'name': part['name']}
            if 'angle' in part:
                item['yaw'] = part['angle']
            else:
                item['slide'] = web(part['slide'])
            if 'parent' in part:
                item['parent'] = part['parent']
            parts.append(item)
        doors.append({'id': door['id'], 'kind': door['kind'], 'ordinal': door['ordinal'], 'parts': parts})
    return bounds, doors


def _horizontal_gap(point, box):
    dx = max(box['min'][0] - point[0], 0, point[0] - box['max'][0])
    dy = max(box['min'][1] - point[1], 0, point[1] - box['max'][1])
    return math.hypot(dx, dy)


def corners(box):
    return [(x, y, z) for x in (box['min'][0], box['max'][0]) for y in (box['min'][1], box['max'][1])
            for z in (box['min'][2], box['max'][2])]


def check_geometry(spec, bounds, pivots, tolerance=PIVOT_TOLERANCE):
    """Hinge pivots must lie on their own panel and linked pivots on the parent panel.

    bounds: part -> closed-pose world AABB {'min','max'}; pivots: part -> root position,
    both Blender coordinates. Returns the closed and fully open corners of each part.
    """
    report = []
    for door in spec['doors']:
        for part in door['parts']:
            name = part['name']
            if name not in bounds or name not in pivots:
                raise ValueError('Door part is not an exported group: ' + name)
            if 'angle' in part and _horizontal_gap(pivots[name], bounds[name]) > tolerance:
                raise ValueError(f'Hinge pivot of {name} is not on its panel; put the group root on the hinge line')
            if 'parent' in part and _horizontal_gap(pivots[name], bounds[part['parent']]) > tolerance:
                raise ValueError(f'{name} pivot is not on its parent panel {part["parent"]}; linked panels would separate')
        transforms = part_transforms(door, 1.0, pivots)
        for part in door['parts']:
            name = part['name']
            report.append({'door': door['id'], 'part': name, 'pivot': [round(x, 4) for x in pivots[name]],
                           'closed': bounds[name],
                           'open_corners': [[round(x, 4) for x in apply(transforms[name], c)] for c in corners(bounds[name])]})
    return report
