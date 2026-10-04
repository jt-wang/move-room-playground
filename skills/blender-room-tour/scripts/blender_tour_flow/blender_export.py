"""Runs inside `blender --background --factory-startup --python THIS -- CONFIG.json`.

Executes the job's trusted recipe.py, checks group ownership and declared door
pivots, renders review views on CPU, measures render and matched source-frame
exposure, and writes private outputs. The host publishes the public subset.
Materials are never modified; review lighting follows the recorded policy.
"""
import bpy, json, runpy, sys
from pathlib import Path
from mathutils import Matrix, Vector

CONFIG = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text())
job = Path(CONFIG['job']); out = Path(CONFIG['out'])
sys.path.insert(0, CONFIG['scripts'])
from blender_tour_flow.contract import (validate_scene, review_fill_for_view, review_lighting_policy, view_resolution,
                                        luma_histogram, exposure_stats, exposure_flags, ROOM_GROUPS,
                                        NEAR_OCCLUDER_DISTANCE, NEAR_OCCLUDER_FRACTION)
from blender_tour_flow import doors as door_contract
try:
    import numpy as np
except ImportError:
    np = None


def hidden_groups_for_view(scene, view):
    if view.get('cutaway') is not True: return set()
    return {'RoomCeiling'} if 'RoomCeiling' in scene.get('groups', {}) else set()


def world_bounds(names):
    verts = [bpy.data.objects[n].matrix_world @ Vector(v) for n in names for v in bpy.data.objects[n].bound_box]
    return {'min': [min(v[i] for v in verts) for i in range(3)], 'max': [max(v[i] for v in verts) for i in range(3)]}


def histogram(path):
    """Luma histogram of the stored (display-encoded) pixels, without colour management."""
    img = bpy.data.images.load(str(path), check_existing=False)
    try:
        try: img.colorspace_settings.name = 'Non-Color'
        except TypeError: pass
        channels = img.channels; w, h = img.size
        if np is not None:
            arr = np.empty(w * h * channels, dtype=np.float32); img.pixels.foreach_get(arr); arr = arr.reshape(-1, channels)
            y = arr[:, 0] * .2126 + arr[:, 1] * .7152 + arr[:, 2] * .0722 if channels >= 3 else arr[:, 0]
            return np.bincount(np.clip(np.floor(y * 255 + .5), 0, 255).astype(np.int64), minlength=256).tolist()
        return luma_histogram(img.pixels[:], channels)
    finally:
        bpy.data.images.remove(img)


def near_occluder_fraction(scene, camera, grid=9):
    """Share of a ray grid through the frame that hits geometry closer than the threshold."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tr, br, bl, tl = camera.data.view_frame(scene=scene)
    origin = camera.matrix_world.translation; rotation = camera.matrix_world.to_3x3()
    hits = 0
    for i in range(grid):
        for j in range(grid):
            u, w = (i + .5) / grid, (j + .5) / grid
            direction = (rotation @ bl.lerp(br, u).lerp(tl.lerp(tr, u), w)).normalized()
            hits += bool(scene.ray_cast(depsgraph, origin, direction, distance=NEAR_OCCLUDER_DISTANCE)[0])
    return round(hits / (grid * grid), 4)


for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
recipe = runpy.run_path(str(job / 'recipe.py'), init_globals={'JOB_ROOT': job})
spec = recipe['build_scene']()
bpy.context.view_layer.update()
renderable = {o.name for o in bpy.data.objects if o.type in ('MESH', 'CURVE')}
validate_scene(spec, renderable, {m.name for m in bpy.data.materials})
policy = review_lighting_policy(spec)
roots = {}
for name, members in spec['groups'].items():
    root = bpy.data.objects.get(name)
    if root is None:
        root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root)
    if root.type != 'EMPTY': raise ValueError('Group root must be EMPTY: ' + name)
    roots[name] = root
    for n in members:
        o = bpy.data.objects[n]; world = o.matrix_world.copy(); o.parent = root; o.matrix_world = world
bpy.context.view_layer.update()
# Move every group and prove all other assigned groups retain their world transforms.
for name, root in roots.items():
    others = {n: bpy.data.objects[n].matrix_world.copy() for g, names in spec['groups'].items() if g != name for n in names}
    before = root.location.copy(); root.location.x += .317; bpy.context.view_layer.update()
    for n, m in others.items():
        if any(abs(a - b) > 1e-5 for ra, rb in zip(bpy.data.objects[n].matrix_world, m) for a, b in zip(ra, rb)):
            raise ValueError('Cross-group movement: ' + name + ' changes ' + n)
    root.location = before; bpy.context.view_layer.update()
# Optional pairwise minimum bounds gaps are explicit per-scene constraints, not inferred dimensions.
for check in spec.get('separations', []):
    a, b = check['a'], check['b']; axis = check.get('axis', 1)
    av = [(bpy.data.objects[n].matrix_world @ Vector(v))[axis] for n in spec['groups'][a] for v in bpy.data.objects[n].bound_box]
    bv = [(bpy.data.objects[n].matrix_world @ Vector(v))[axis] for n in spec['groups'][b] for v in bpy.data.objects[n].bound_box]
    gap = max(min(bv) - max(av), min(av) - max(bv))
    if gap < check['min_gap']: raise ValueError('Required gap failed: ' + a + ' / ' + b)

# Declared doors: pivots must sit on their panels; the open pose uses the same contract as the app.
interaction = CONFIG.get('interaction')
door_report, door_pivots = None, {}
if interaction:
    door_bounds = {}
    for door in interaction['doors']:
        for part in door['parts']:
            name = part['name']
            if name not in roots or name in ROOM_GROUPS: raise ValueError('Door part must be a separate object group: ' + name)
            door_pivots[name] = list(roots[name].matrix_world.translation); door_bounds[name] = world_bounds(spec['groups'][name])
    door_report = door_contract.check_geometry(interaction, door_bounds, door_pivots)

# Portable default: Cycles on CPU. Quality comes from the host (stricter floor for source jobs).
s = bpy.context.scene; s.render.engine = 'CYCLES'; s.cycles.device = 'CPU'
s.cycles.samples = CONFIG['samples']; s.cycles.use_denoising = True
for transform in ('AgX', 'Filmic', 'Standard'):
    try: s.view_settings.view_transform = transform; break
    except TypeError: pass
s.view_settings.look = 'None'; s.view_settings.exposure = policy['film_exposure']
s.render.resolution_percentage = 100
s.render.image_settings.file_format = 'PNG'; s.render.film_transparent = False
interior_lights = sum(1 for o in s.objects if o.type == 'LIGHT' and o.data.type in ('POINT', 'SPOT', 'AREA'))
views = []
for v in spec['views']:
    c = bpy.data.cameras.new('Review_' + v['name']); c.lens = v.get('lens', 24)
    o = bpy.data.objects.new(c.name, c); s.collection.objects.link(o); o.location = v['position']
    o.rotation_euler = (Vector(v['target']) - o.location).to_track_quat('-Z', 'Y').to_euler(); views.append((o, v))
s.camera = views[0][0]
for image in bpy.data.images:
    if image.source == 'FILE' and not image.packed_file: image.pack()
s['reconstruction_notes'] = '\n'.join(spec['notes'])
(out / 'renders').mkdir()
outputs = []; open_outputs = []; review_lighting = []; exposure = {}; near = {}; flags = {}
review_fill = None; review_fill_data = None
original_hide_render = {n: bpy.data.objects[n].hide_render for names in spec['groups'].values() for n in names}
source_frames = CONFIG.get('source_frames') or {}
source_stats = {}


def source_exposure(frame):
    if frame not in source_stats:
        path = source_frames.get(frame)
        if not path or not Path(path).is_file(): source_stats[frame] = None
        else:
            stats = exposure_stats(histogram(path)); source_stats[frame] = {'stats': stats, 'flags': exposure_flags(stats)}
    return source_stats[frame]


def render_view(camera, v, rel):
    global review_fill, review_fill_data
    hidden = hidden_groups_for_view(spec, v)
    for name, members in spec['groups'].items():
        for n in members: bpy.data.objects[n].hide_render = original_hide_render[n] or name in hidden
    s.render.resolution_x, s.render.resolution_y = view_resolution(CONFIG['resolution'], v)
    fill = review_fill_for_view(spec, v, interior_lights)
    if fill:
        if review_fill is None:
            review_fill_data = bpy.data.lights.new('ReviewCameraFill', 'AREA'); review_fill_data.shape = 'DISK'
            review_fill = bpy.data.objects.new('ReviewCameraFill', review_fill_data); s.collection.objects.link(review_fill)
        review_fill.hide_render = False; review_fill.location = fill['position']; review_fill.rotation_euler = camera.rotation_euler
        review_fill_data.energy = fill['energy']; review_fill_data.size = fill['size']
    elif review_fill is not None: review_fill.hide_render = True
    s.camera = camera; s.render.filepath = str(out / rel); bpy.ops.render.render(write_still=True)
    stats = exposure_stats(histogram(out / rel))
    return fill, stats


try:
    for camera, v in views:
        rel = 'renders/' + v['name'] + '.png'
        s.render.resolution_x, s.render.resolution_y = view_resolution(CONFIG['resolution'], v)
        bpy.context.view_layer.update()
        near[v['name']] = None if v.get('cutaway') else near_occluder_fraction(s, camera)
        fill, stats = render_view(camera, v, rel); outputs.append(rel)
        view_flags = exposure_flags(stats)
        if near[v['name']] is not None and near[v['name']] >= NEAR_OCCLUDER_FRACTION: view_flags.append('near_occluder')
        flags[v['name']] = view_flags
        exposure[v['name']] = {'render': stats, 'sources': {f: source_exposure(f) for f in v.get('source_frames', [])}}
        review_lighting.append({'view': v['name'], 'fill': fill, 'interior_lights': interior_lights, 'policy': policy,
                                'resolution': [s.render.resolution_x, s.render.resolution_y]})
    # Fully open doors for the views that request it; restored before saving or exporting.
    open_views = [(c, v) for c, v in views if v.get('doors_open')] if interaction else []
    if open_views:
        closed = {name: roots[name].matrix_world.copy() for name in door_pivots}
        try:
            for door in interaction['doors']:
                for name, (angle, t) in door_contract.part_transforms(door, 1.0, door_pivots).items():
                    roots[name].matrix_world = Matrix.Translation(t) @ Matrix.Rotation(angle, 4, 'Z') @ closed[name]
            bpy.context.view_layer.update()
            for camera, v in open_views:
                rel = 'renders/' + v['name'] + '__doors_open.png'
                render_view(camera, v, rel); open_outputs.append(rel)
        finally:
            for name, matrix in closed.items(): roots[name].matrix_world = matrix
            bpy.context.view_layer.update()
finally:
    if review_fill is not None: bpy.data.objects.remove(review_fill, do_unlink=True)
    if review_fill_data is not None: bpy.data.lights.remove(review_fill_data)
    for n, value in original_hide_render.items(): bpy.data.objects[n].hide_render = value
s.camera = views[0][0]
s.render.resolution_x, s.render.resolution_y = view_resolution(CONFIG['resolution'], views[0][1])
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'room.blend'))
# Raw export stays private; the host strips names/extras before publishing.
bpy.ops.export_scene.gltf(filepath=str(out / 'export-raw.glb'), export_format='GLB', export_apply=True,
                          export_cameras=False, export_lights=False, export_extras=False)


def web(v): return [v[0], v[2], -v[1]]


groups = []
for name, members in spec['groups'].items():
    verts = [bpy.data.objects[n].matrix_world @ Vector(v) for n in members for v in bpy.data.objects[n].bound_box]
    lo = Vector(tuple(min(v[i] for v in verts) for i in range(3))); hi = Vector(tuple(max(v[i] for v in verts) for i in range(3)))
    kind = {'RoomCeiling': 'ceiling', 'RoomWalls': 'walls', 'RoomFloor': 'floor'}.get(name, 'object')
    groups.append({'name': name, 'label': spec.get('labels', {}).get(name, name), 'center': web((lo + hi) / 2),
                   'radius': max((hi - lo).length / 2, .25), 'kind': kind})
summary = {'groups': groups, 'notes': spec['notes'], 'glazing': spec.get('glazing', []), 'renders': outputs,
           'door_open_renders': open_outputs,
           'views': [{'name': v['name'], 'label': v.get('label', v['name']), 'camera': web(v['position']),
                      'target': web(v['target']), 'fov': v.get('fov', 60), 'cutaway': v.get('cutaway') is True,
                      'source_frames': v.get('source_frames', []), 'spaces': v.get('spaces', []),
                      'adjacent': v.get('adjacent', []), 'orientation': v.get('orientation', 'landscape'),
                      'doors_open': bool(v.get('doors_open')) and bool(interaction)} for _, v in views]}
(out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
bpy.ops.wm.open_mainfile(filepath=str(out / 'room.blend'))
for name, members in spec['groups'].items():
    for n in members: assert bpy.data.objects[n].parent.name == name
result = {'groups': {n: len(m) for n, m in spec['groups'].items()}, 'movement_independence': 'pass', 'reopen': 'pass',
          'device': 'CPU', 'samples': CONFIG['samples'], 'resolution': CONFIG['resolution'],
          'render_tier': CONFIG['render_tier'], 'blender_version': bpy.app.version_string, 'renders': outputs,
          'door_open_renders': open_outputs, 'visual_review': 'pending',
          'color_management': {'view_transform': bpy.context.scene.view_settings.view_transform, 'look': 'None',
                               'film_exposure': policy['film_exposure'], 'materials_modified': False},
          'review_lighting': review_lighting, 'exposure': exposure, 'near_occluder': near, 'review_flags': flags,
          'histogram_method': 'numpy' if np is not None else 'python', 'door_checks': door_report}
(out / 'checks.json').write_text(json.dumps(result, indent=2))
