"""Blender geometry helpers for features that make a room recognisable.

Use inside recipe.py:  from blender_tour_flow import geometry as g
Every helper takes explicit job-specific dimensions; nothing here encodes a
real room. Coordinates are Blender Z-up metres; ``lo``/``hi`` are opposite box
corners. Each helper returns the names of the objects it created so the recipe
assigns every one to exactly one group. Faces are named '+x', '-x', '+y', '-y'
for the side a front or opening faces.

Why these exist: a basin or washer pan modelled as a solid block, burners as
flat slabs, a floor without plank seams, or a window without its rails all
lose the cues a viewer uses to match a render to the source image, especially
in a roofless overview. Model the hollow, the seams and the rails instead.
"""
import math

import bmesh
import bpy
from mathutils import Matrix

from .openings import frame_parts, span as _span, wall_strips

_MATERIALS = {}
FACES = {'+x': (0, 1), '-x': (0, -1), '+y': (1, 1), '-y': (1, -1)}


def srgb(r, g, b):
    """0-255 sRGB colour picked from a source image -> linear Base Color."""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


def material(name, rgb, alpha=1.0, roughness=.6, metallic=0.0):
    """Principled material from an sRGB 0-255 triple. alpha < 1 is glazing (declare it)."""
    if name in _MATERIALS:
        return _MATERIALS[name]
    m = bpy.data.materials.new(name)
    if not m.use_nodes:
        m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*srgb(*rgb), 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED'
        if hasattr(m, 'blend_method'):
            m.blend_method = 'BLEND'
    _MATERIALS[name] = m
    return m


def _link(name, mesh):
    if name in bpy.data.objects:
        raise ValueError('Duplicate object name ' + name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _add_box(bm, lo, hi):
    size = [hi[i] - lo[i] for i in range(3)]
    if min(size) <= 0:
        raise ValueError(f'Degenerate box {lo} {hi}')
    centre = [(hi[i] + lo[i]) / 2 for i in range(3)]
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*size, 1.0)))


def _finish(name, bm, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    _link(name, mesh)
    return name


def boxes(name, parts, mat):
    """One object from several axis-aligned boxes [(lo, hi), ...]."""
    bm = bmesh.new()
    for lo, hi in parts:
        _add_box(bm, lo, hi)
    return _finish(name, bm, mat)


def box(name, lo, hi, mat):
    return boxes(name, [(lo, hi)], mat)


def cylinder(name, centre, radius, depth, mat, segments=32, axis='Z'):
    """Closed cylinder centred on ``centre``; axis 'X', 'Y' or 'Z'."""
    turn = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius,
                          depth=depth, matrix=Matrix.Translation(centre) @ turn)
    return _finish(name, bm, mat)


def ring(name, centre, outer, inner, z0, z1, mat, segments=32):
    """Closed annulus (a hollow round crown or rim) from z0 to z1."""
    if not 0 < inner < outer or z1 <= z0:
        raise ValueError('ring needs 0 < inner < outer and z1 > z0')
    bm = bmesh.new()
    loops = []
    for r, z in ((outer, z0), (outer, z1), (inner, z1), (inner, z0)):
        loops.append([bm.verts.new((centre[0] + r * math.cos(2 * math.pi * k / segments),
                                    centre[1] + r * math.sin(2 * math.pi * k / segments), z)) for k in range(segments)])
    for a, b in zip(loops, loops[1:] + loops[:1]):
        for k in range(segments):
            bm.faces.new((a[k], a[(k + 1) % segments], b[(k + 1) % segments], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, bm, mat)


def pivot_root(group, location):
    """EMPTY group root: on the hinge line for hinged leaves, anywhere on a sliding leaf."""
    if group in bpy.data.objects:
        raise ValueError('Duplicate object name ' + group)
    root = bpy.data.objects.new(group, None)
    root.empty_display_type = 'SINGLE_ARROW'
    root.location = location
    bpy.context.scene.collection.objects.link(root)
    return group


def _open_box(lo, hi, wall, open_top=True):
    """Bottom and four walls of a hollow tray/basin; no top face."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    if min(x1 - x0, y1 - y0) <= 2 * wall or z1 - z0 <= wall:
        raise ValueError('Hollow box is thinner than its walls')
    return [((x0, y0, z0), (x1, y1, z0 + wall)),
            ((x0, y0, z0 + wall), (x0 + wall, y1, z1)), ((x1 - wall, y0, z0 + wall), (x1, y1, z1)),
            ((x0 + wall, y0, z0 + wall), (x1 - wall, y0 + wall, z1)), ((x0 + wall, y1 - wall, z0 + wall), (x1 - wall, y1, z1))]


def inset_basin(prefix, counter_lo, counter_hi, opening_lo, opening_hi, depth, mats, wall=.008, rim=.012, drain=True):
    """Counter slab with a real cut-out and a hollow basin hanging below it.

    counter_lo/hi: the worktop slab box. opening_lo/hi: (x, y) of the cut-out.
    depth: basin depth below the worktop surface. mats: 'counter', 'basin' and
    optionally 'drain'. The basin interior is visible from above and from the
    side in a roofless view, unlike a flat inset plate.
    """
    (cx0, cy0, cz0), (cx1, cy1, top) = counter_lo, counter_hi
    (ox0, oy0), (ox1, oy1) = opening_lo, opening_hi
    if not (cx0 < ox0 < ox1 < cx1 and cy0 < oy0 < oy1 < cy1):
        raise ValueError('Basin opening must lie inside the counter')
    counter = boxes(prefix + '_Counter', [((cx0, cy0, cz0), (ox0, cy1, top)), ((ox1, cy0, cz0), (cx1, cy1, top)),
                                          ((ox0, cy0, cz0), (ox1, oy0, top)), ((ox0, oy1, cz0), (ox1, cy1, top))],
                    mats['counter'])
    basin_parts = _open_box((ox0, oy0, top - depth), (ox1, oy1, top - .002), wall)
    basin_parts += [((ox0 - rim, oy0 - rim, top), (ox1 + rim, oy0, top + .003)), ((ox0 - rim, oy1, top), (ox1 + rim, oy1 + rim, top + .003)),
                    ((ox0 - rim, oy0, top), (ox0, oy1, top + .003)), ((ox1, oy0, top), (ox1 + rim, oy1, top + .003))]
    names = [counter, boxes(prefix + '_Basin', basin_parts, mats['basin'])]
    if drain:
        names.append(cylinder(prefix + '_Drain', ((ox0 + ox1) / 2, (oy0 + oy1) / 2, top - depth + wall + .001),
                              min(ox1 - ox0, oy1 - oy0) * .09, .003, mats.get('drain', mats['basin'])))
    return names


def hollow_pan(prefix, lo, hi, mat, wall=.012, drain_at=None, drain_mat=None):
    """Raised-rim tray such as a washer pan or shower tray: thin floor plus four rim walls."""
    names = [boxes(prefix + '_Tray', _open_box(lo, hi, wall), mat)]
    if drain_at:
        names.append(cylinder(prefix + '_Drain', (drain_at[0], drain_at[1], lo[2] + wall + .001), .035, .003, drain_mat or mat))
    return names


def gas_burner(prefix, centre, mats, radius=.05):
    """Round burner on a cooktop surface at centre[2]: spill tray, crown ring, cap and pan-support arms.

    mats: 'tray', 'burner', 'cap', 'grate'. Two burners are two calls, not two slabs.
    """
    x, y, z = centre
    arm, reach = .008, radius * 2.1
    grate = []
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, b = radius * 1.15, reach
        if dx:
            lo, hi = (x + dx * a if dx > 0 else x - b, y - arm / 2), (x + b if dx > 0 else x - a, y + arm / 2)
        else:
            lo, hi = (x - arm / 2, y + dy * a if dy > 0 else y - b), (x + arm / 2, y + b if dy > 0 else y - a)
        grate.append(((lo[0], lo[1], z + .018), (hi[0], hi[1], z + .03)))
    for sx in (-1, 1):  # outer frame of the pan support
        grate.append(((x + sx * reach - (arm if sx > 0 else 0), y - reach, z + .004), (x + sx * reach + (0 if sx > 0 else arm), y + reach, z + .03)))
    return [cylinder(prefix + '_Tray', (x, y, z + .002), radius * 1.9, .004, mats['tray']),
            ring(prefix + '_Crown', (x, y), radius, radius * .62, z + .004, z + .024, mats['burner']),
            cylinder(prefix + '_Cap', (x, y, z + .027), radius * .58, .006, mats['cap']),
            boxes(prefix + '_Grate', grate, mats['grate'])]


def open_shelves(prefix, lo, hi, shelf_heights, mat, board=.018, front='-y', back=True):
    """Open shelf unit or lined niche: sides, top, bottom, optional back and boards at absolute heights."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    axis, sign = FACES[front]
    parts = [((x0, y0, z0), (x1, y1, z0 + board)), ((x0, y0, z1 - board), (x1, y1, z1))]
    if axis == 1:
        parts += [((x0, y0, z0), (x0 + board, y1, z1)), ((x1 - board, y0, z0), (x1, y1, z1))]
        if back:
            parts.append(((x0, y1 - board, z0), (x1, y1, z1)) if sign < 0 else ((x0, y0, z0), (x1, y0 + board, z1)))
    else:
        parts += [((x0, y0, z0), (x1, y0 + board, z1)), ((x0, y1 - board, z0), (x1, y1, z1))]
        if back:
            parts.append(((x1 - board, y0, z0), (x1, y1, z1)) if sign < 0 else ((x0, y0, z0), (x0 + board, y1, z1)))
    for h in shelf_heights:
        if not z0 + board < h < z1 - board:
            raise ValueError('Shelf height outside the unit')
        parts.append(((x0, y0, h - board / 2), (x1, y1, h + board / 2)))
    return [boxes(prefix + '_Shelves', parts, mat)]


def cabinet_fronts(prefix, lo, hi, face, columns, mats, rows=1, gap=.004, thickness=.018, handle=True):
    """Separate door/drawer fronts on one face of a carcass box, with visible gaps and bar handles.

    columns/rows: counts or explicit width/height fractions summing to 1.
    mats: 'front' and optionally 'handle'.
    """
    axis, sign = FACES[face]
    across = 1 - axis
    fractions = lambda n: [1 / n] * n if isinstance(n, int) else list(n)
    cols, rws = fractions(columns), fractions(rows)
    if abs(sum(cols) - 1) > 1e-6 or abs(sum(rws) - 1) > 1e-6:
        raise ValueError('Front fractions must sum to 1')
    plane = hi[axis] if sign > 0 else lo[axis]
    depth = (plane, plane + thickness) if sign > 0 else (plane - thickness, plane)
    names, handles = [], []
    a = lo[across]
    for i, cw in enumerate(cols):
        b = a + cw * (hi[across] - lo[across])
        z = lo[2]
        for j, rh in enumerate(rws):
            top = z + rh * (hi[2] - lo[2])
            f_lo, f_hi = [0, 0, z + gap / 2], [0, 0, top - gap / 2]
            f_lo[across], f_hi[across] = a + gap / 2, b - gap / 2
            f_lo[axis], f_hi[axis] = depth
            names.append(box(f'{prefix}_Front_{i + 1}_{j + 1}', tuple(f_lo), tuple(f_hi), mats['front']))
            if handle:
                h_lo, h_hi = [0, 0, top - .07], [0, 0, top - .055]
                h_lo[across], h_hi[across] = a + (b - a) * .3, b - (b - a) * .3
                out = depth[1] if sign > 0 else depth[0]
                h_lo[axis], h_hi[axis] = (out, out + .012) if sign > 0 else (out - .012, out)
                handles.append((tuple(h_lo), tuple(h_hi)))
            z = top
        a = b
    if handles:
        names.append(boxes(prefix + '_Handles', handles, mats.get('handle', mats['front'])))
    return names


def plank_floor(prefix, lo, hi, mats, plank_width=.15, plank_length=1.2, direction='x', gap=.003,
                stagger=(0, .5, .25, .75), thickness=.012, top=0.0):
    """Plank floor with staggered end joints. Seams show the darker under-layer through real gaps.

    lo/hi: (x, y) extents; direction: 'x' or 'y' long axis of the planks, as seen in the source.
    mats: 'plank' and 'seam'. Returns [planks, under-layer]; put both in RoomFloor.
    """
    long_axis = 0 if direction == 'x' else 1
    short_axis = 1 - long_axis
    planks, row, s = [], 0, lo[short_axis]
    while s < hi[short_axis] - 1e-6:
        s1 = min(s + plank_width, hi[short_axis])
        start = lo[long_axis] - stagger[row % len(stagger)] * plank_length
        while start < hi[long_axis] - 1e-6:
            a, b = max(start, lo[long_axis]), min(start + plank_length, hi[long_axis])
            if b - a > gap * 2:
                p_lo, p_hi = [0, 0, top - thickness], [0, 0, top]
                p_lo[long_axis], p_hi[long_axis] = a + gap / 2, b - gap / 2
                p_lo[short_axis], p_hi[short_axis] = s + gap / 2, s1 - gap / 2
                planks.append((tuple(p_lo), tuple(p_hi)))
            start += plank_length
        s, row = s1, row + 1
    return [boxes(prefix + '_Planks', planks, mats['plank']),
            box(prefix + '_Underlay', (lo[0], lo[1], top - thickness - .006), (hi[0], hi[1], top - .002), mats['seam'])]


def separate_boxes(name, parts, mat):
    """One object per box. Use for static obstacles whose boxes are not contiguous (wall strips
    around an opening, door jambs): the app collides with one bounding box per object, so packing
    them into one mesh would turn the opening into a solid obstacle."""
    if len(parts) == 1:
        return [box(name, *parts[0], mat)]
    return [box(f'{name}_{i}', lo, hi, mat) for i, (lo, hi) in enumerate(parts, 1)]


def wall(name, axis, a0, a1, t0, t1, height, mat, openings=()):
    """Wall run along X ('x') or Y ('y') from a0 to a1, thickness t0..t1, with (b0, b1, z0, z1) openings
    cut through. Each strip is its own object so doorways stay open for collision."""
    return separate_boxes(name, wall_strips(axis, a0, a1, t0, t1, height, openings), mat)


def sliding_window(prefix, axis, b0, b1, z0, z1, wall_inner, wall_outer, mats, panes=2, transoms=(), fall_bars=()):
    """Window in a wall opening: outer frame, one framed sash per pane on alternating tracks, glass,
    optional horizontal transom rails (absolute heights), exterior fall bars and an interior sill.

    axis 'x': wall runs along X (thickness on Y); 'y': along Y. mats: 'frame', 'glass', 'sill'.
    Returns (frame_names, glass_names); declare the glass material in glazing.
    """
    s = 1 if wall_outer > wall_inner else -1
    f, rail = .04, .03
    track = [wall_inner + s * .03, wall_inner + s * .065]
    outer = [_span(axis, b0, b0 + f, track[0], track[1] + s * .03, z0, z1), _span(axis, b1 - f, b1, track[0], track[1] + s * .03, z0, z1),
             _span(axis, b0, b1, track[0], track[1] + s * .03, z0, z0 + f), _span(axis, b0, b1, track[0], track[1] + s * .03, z1 - f, z1)]
    sashes, glass = [], []
    width = (b1 - b0 - 2 * f) / panes
    for i in range(panes):
        p0 = b0 + f + i * width - (.015 if i else 0)
        p1 = b0 + f + (i + 1) * width + (.015 if i < panes - 1 else 0)
        t0, t1 = sorted((track[i % 2], track[i % 2] + s * .03))
        sashes += [_span(axis, p0, p0 + rail, t0, t1, z0 + f, z1 - f), _span(axis, p1 - rail, p1, t0, t1, z0 + f, z1 - f),
                   _span(axis, p0, p1, t0, t1, z0 + f, z0 + f + rail), _span(axis, p0, p1, t0, t1, z1 - f - rail, z1 - f)]
        sashes += [_span(axis, p0, p1, t0, t1, h - rail / 2, h + rail / 2) for h in transoms]
        mid = (t0 + t1) / 2
        glass.append(_span(axis, p0 + rail, p1 - rail, mid - .003, mid + .003, z0 + f + rail, z1 - f - rail))
    bars = [_span(axis, b0 - .03, b1 + .03, wall_outer + s * .03, wall_outer + s * .055, h - .012, h + .012) for h in fall_bars]
    frame = [boxes(prefix + '_Frame', outer + sashes + bars, mats['frame']),
             box(prefix + '_Sill', *_span(axis, b0 - .02, b1 + .02, wall_inner - s * .02, track[0], z0 - .02, z0), mats['sill'])]
    return frame, [boxes(prefix + '_Glass', glass, mats['glass'])]


def door_frame(prefix, axis, b0, b1, t0, t1, height, mat, jamb=.03, threshold=True):
    """Static jambs, head and optional threshold of an opening, each its own object so the
    doorway between the jambs stays clear for collision; keep the frame out of every door group."""
    return separate_boxes(prefix + '_Frame', frame_parts(axis, b0, b1, t0, t1, height, jamb, threshold), mat)


def _leaf(direction, origin, width, thickness, z0, z1):
    x, y = origin
    h = thickness / 2
    return {'+x': ((x, y - h, z0), (x + width, y + h, z1)), '-x': ((x - width, y - h, z0), (x, y + h, z1)),
            '+y': ((x - h, y, z0), (x + h, y + width, z1)), '-y': ((x - h, y - width, z0), (x + h, y, z1))}[direction]


def hinged_leaf(group, hinge, width, height, mats, direction='+x', thickness=.035, bottom=.01, handle=True):
    """Closed hinged leaf: EMPTY group root on the hinge line at floor level; leaf extends ``direction``.

    In interaction.json give {"name": group, "angle": A}: A > 0 opens counter-clockwise seen from
    above (+X turns toward +Y). Pick the sign from the source and confirm it in a doors_open render.
    mats: 'leaf' and optionally 'handle'. Returns (group, names).
    """
    pivot_root(group, (hinge[0], hinge[1], 0))
    lo, hi = _leaf(direction, hinge, width, thickness, bottom, height)
    names = [box(group + '_Leaf', lo, hi, mats['leaf'])]
    if handle:
        axis = 0 if direction in ('+x', '-x') else 1
        sign = 1 if direction[0] == '+' else -1
        free = hinge[axis] + sign * (width - .07)
        parts = []
        for side in (-1, 1):
            h_lo, h_hi = [0, 0, .95], [0, 0, .97]
            h_lo[axis], h_hi[axis] = sorted((free, free - sign * .12))
            face = (hi if side > 0 else lo)[1 - axis]
            h_lo[1 - axis], h_hi[1 - axis] = sorted((face, face + side * .025))
            parts.append((tuple(h_lo), tuple(h_hi)))
        names.append(boxes(group + '_Handles', parts, mats.get('handle', mats['leaf'])))
    return group, names


def sliding_leaf(group, lo, hi, mats, pull_side=1):
    """Closed sliding leaf; root at its floor centre. In interaction.json use {"name": group, "slide": [dx, dy, 0]}.

    pull_side: +1 puts the pull on the leaf's +thickness face, -1 on the other face, 0 omits it.
    """
    pivot_root(group, ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0))
    names = [box(group + '_Leaf', lo, hi, mats['leaf'])]
    if pull_side:
        thin = 0 if hi[0] - lo[0] < hi[1] - lo[1] else 1
        p_lo, p_hi = list(lo), list(hi)
        p_lo[thin], p_hi[thin] = (hi[thin], hi[thin] + .006) if pull_side > 0 else (lo[thin] - .006, lo[thin])
        p_lo[1 - thin] = lo[1 - thin] + .05; p_hi[1 - thin] = lo[1 - thin] + .08
        p_lo[2], p_hi[2] = .9, 1.15
        names.append(box(group + '_Pull', tuple(p_lo), tuple(p_hi), mats.get('pull', mats['leaf'])))
    return group, names


def bifold_pair(prefix, jamb, panel_width, height, mats, direction='+x', thickness=.025, bottom=.01):
    """Two independently owned bifold panels: A hinged at the jamb, B hinged on A's free edge.

    Returns ({group: names}, parts(angle)) where parts(angle) gives the interaction parts:
    A turns by ``angle`` and B by ``-2 * angle`` relative to A, so B's free edge stays on the
    track line while the pair folds. The static jamb/track belongs in its own group.
    """
    axis = 0 if direction in ('+x', '-x') else 1
    sign = 1 if direction[0] == '+' else -1
    joint = list(jamb)
    joint[axis] += sign * panel_width
    groups = {}
    for group, origin in ((prefix + 'A', jamb), (prefix + 'B', tuple(joint))):
        pivot_root(group, (origin[0], origin[1], 0))
        lo, hi = _leaf(direction, origin, panel_width - .004, thickness, bottom, height)
        groups[group] = [box(group + '_Panel', lo, hi, mats['panel'])]
    k_lo, k_hi = [0, 0, .9], [0, 0, 1.1]
    k_lo[axis], k_hi[axis] = sorted((joint[axis] - sign * .05, joint[axis] - sign * .03))
    k_lo[1 - axis], k_hi[1 - axis] = jamb[1 - axis] - thickness / 2 - .02, jamb[1 - axis] - thickness / 2
    groups[prefix + 'A'].append(box(prefix + 'A_Pull', tuple(k_lo), tuple(k_hi), mats.get('pull', mats['panel'])))

    def parts(angle):
        return [{'name': prefix + 'A', 'angle': angle}, {'name': prefix + 'B', 'angle': -2 * angle, 'parent': prefix + 'A'}]
    return groups, parts
