"""Scene ownership, view, and review-lighting contract; geometry accuracy requires visual review.

Runs inside Blender's bundled Python and on the host; standard library only.
"""
import math
import re

ID = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,63}')
SPACE_ID = re.compile(r'[a-z][a-z0-9_-]{0,63}')
FRAME_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}')
ROOM_GROUPS = ('RoomWalls', 'RoomFloor', 'RoomCeiling')
VIEW_KEYS = {'name', 'label', 'position', 'target', 'lens', 'fov', 'cutaway', 'source_frames', 'spaces',
             'adjacent', 'orientation', 'doors_open'}

# Review renders only. Final evidence needs 64 samples at 1920x1080 or the same
# pixel dimensions in portrait; anything less is a diagnostic preview.
FINAL_SAMPLES = 64
FINAL_LONG_EDGE, FINAL_SHORT_EDGE = 1920, 1080

LIGHTING_KEYS = {'camera_fill', 'fill_scale', 'film_exposure', 'reason'}
LIGHTING_DEFAULT = {'camera_fill': 'auto', 'fill_scale': 1.0, 'film_exposure': 0.0}

# Deterministic exposure heuristics on 0..1 display-encoded luma. They flag
# renders for review; they never certify resemblance.
WASHED_OUT_P05, WASHED_OUT_CLIPPED = .66, .30
TOO_DARK_P50, TOO_DARK_P95 = .12, .30
LOW_CONTRAST_SPREAD = .15
BLOCKING_EXPOSURE_FLAGS = ('washed_out', 'too_dark')
NEAR_OCCLUDER_DISTANCE, NEAR_OCCLUDER_FRACTION = .5, .05


def _strings(value, pattern, what):
    if not isinstance(value, list) or len(set(map(str, value))) != len(value) or \
            not all(isinstance(x, str) and pattern.fullmatch(x) for x in value):
        raise ValueError(f'{what} must be a list of unique identifiers')
    return value


def validate_scene(scene, renderable_names, material_names=()):
    groups = scene.get('groups', {})
    for required in ('RoomWalls', 'RoomFloor'):
        if not groups.get(required):
            raise ValueError('Missing nonempty group ' + required)
    if not any(n not in ROOM_GROUPS for n in groups):
        raise ValueError('At least one separate furniture group is required')
    owners = {}
    for group, names in groups.items():
        if not ID.fullmatch(group):
            raise ValueError('Invalid group name ' + group)
        if not names:
            raise ValueError('Empty group ' + group)
        for name in names:
            if name in owners:
                raise ValueError(name + ' belongs to more than one group')
            if name not in renderable_names:
                raise ValueError('Unknown renderable ' + name)
            owners[name] = group
    unassigned = set(renderable_names) - owners.keys()
    if unassigned:
        raise ValueError('Unassigned renderable objects: ' + str(sorted(unassigned)))
    for group, label in scene.get('labels', {}).items():
        if group not in groups or not isinstance(label, str) or not 0 < len(label) <= 80:
            raise ValueError('Invalid label for ' + str(group))
    views = scene.get('views', [])
    if len(views) < 2:
        raise ValueError('At least two distinct views required')
    names = set()
    positions = set()
    for v in views:
        name = v.get('name', '')
        if not ID.fullmatch(name) or name in names:
            raise ValueError('Invalid or duplicate view name')
        names.add(name)
        unknown = set(v) - VIEW_KEYS
        if unknown:
            raise ValueError(f'Unknown view keys for {name}: {sorted(unknown)}')
        for key in ('position', 'target'):
            a = v.get(key, [])
            if len(a) != 3 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in a):
                raise ValueError('Invalid view ' + key)
        if math.dist(v['position'], v['target']) < .01:
            raise ValueError('Camera must differ from target')
        positions.add(tuple(v['position']))
        _strings(v.get('source_frames', []), FRAME_NAME, f'View {name} source_frames')
        _strings(v.get('spaces', []), SPACE_ID, f'View {name} spaces')
        if v.get('orientation', 'landscape') not in ('landscape', 'portrait'):
            raise ValueError(f'View {name} orientation must be landscape or portrait')
        for key in ('cutaway', 'doors_open'):
            if key in v and not isinstance(v[key], bool):
                raise ValueError(f'View {name} {key} must be true or false')
    if len(positions) < 2:
        raise ValueError('Camera positions must be distinct')
    for v in views:
        adjacent = _strings(v.get('adjacent', []), ID, f'View {v["name"]} adjacent')
        if v['name'] in adjacent or not set(adjacent) <= names:
            raise ValueError(f'View {v["name"]} adjacent must name other existing views')
    glazing = scene.get('glazing', [])
    if not isinstance(glazing, list) or len(set(glazing)) != len(glazing):
        raise ValueError('glazing must be a list of unique material names')
    for name in glazing:
        if name not in material_names:
            raise ValueError('Unknown glazing material ' + str(name))
    notes = scene.get('notes')
    if not notes or not all(isinstance(n, str) for n in notes):
        raise ValueError('State estimated dimensions and unseen surfaces in notes')
    review_lighting_policy(scene)


def review_lighting_policy(scene):
    """Explicit, recorded review-lighting policy. Materials are never changed.

    camera_fill: "auto" adds a review-only fill to roofed views only when the
    recipe has no interior point/spot/area lights; "on" always adds it to roofed
    views; "off" never does. fill_scale multiplies the fill energy. film_exposure
    is the render camera's exposure in stops. Any non-default value needs a
    written reason, which is published in the review manifest beside the renders.
    """
    raw = scene.get('review_lighting', {})
    if not isinstance(raw, dict) or set(raw) - LIGHTING_KEYS:
        raise ValueError('review_lighting accepts only ' + ', '.join(sorted(LIGHTING_KEYS)))
    policy = dict(LIGHTING_DEFAULT, **{k: v for k, v in raw.items() if k != 'reason'})
    if policy['camera_fill'] not in ('auto', 'on', 'off'):
        raise ValueError('review_lighting.camera_fill must be auto, on or off')
    for key, lo, hi in (('fill_scale', .1, 2.0), ('film_exposure', -2.0, 2.0)):
        value = policy[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
            raise ValueError(f'review_lighting.{key} must be between {lo} and {hi}')
        policy[key] = float(value)
    if policy != LIGHTING_DEFAULT:
        reason = raw.get('reason')
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError('Non-default review_lighting needs a written reason')
        policy['reason'] = reason
    return policy


def review_fill_for_view(scene, view, interior_lights=0):
    """Neutral camera-side fill for roofed views; a review aid, not a room fixture.

    Closed ceilings block outside lights. When the recipe supplies no interior
    lights, a small area light near the camera keeps an enclosed view legible.
    Its energy targets roughly 2.5 W/m2 on axis at the target distance, which is
    an uncalibrated default; the measured render/source exposure in checks.json
    and the visual review decide whether it is acceptable.
    """
    policy = review_lighting_policy(scene)
    if not scene.get('groups', {}).get('RoomCeiling') or view.get('cutaway') is True:
        return None
    if policy['camera_fill'] == 'off' or (policy['camera_fill'] == 'auto' and interior_lights > 0):
        return None
    position = view['position']
    target = view['target']
    distance = math.dist(position, target)
    if distance < .01:
        raise ValueError('Camera must differ from target')
    return {'position': [position[i] + .05 * (target[i] - position[i]) / distance for i in range(3)],
            'target': list(target), 'energy': round(policy['fill_scale'] * max(10, min(160, 8 * distance * distance)), 3),
            'size': .4, 'policy': policy['camera_fill'], 'purpose': 'review_only_camera_fill'}


def view_resolution(resolution, view):
    """Per-view pixel size; portrait views swap the configured landscape size."""
    w, h = resolution
    if view.get('orientation') == 'portrait':
        return [min(w, h), max(w, h)]
    return [max(w, h), min(w, h)]


def render_tier(samples, resolution, preview=False):
    w, h = resolution
    final = not preview and samples >= FINAL_SAMPLES and max(w, h) >= FINAL_LONG_EDGE and min(w, h) >= FINAL_SHORT_EDGE
    return 'final' if final else 'diagnostic_preview'


def luma_histogram(pixels, channels):
    """256-bin Rec.709 luma histogram of display-encoded 0..1 pixel values (flat RGBA/RGB/gray list)."""
    if channels < 1 or len(pixels) % channels:
        raise ValueError('Pixel buffer does not match channel count')
    hist = [0] * 256
    for i in range(0, len(pixels), channels):
        if channels >= 3:
            y = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]
        else:
            y = pixels[i]
        hist[min(255, max(0, int(math.floor(y * 255 + .5))))] += 1
    return hist


def exposure_stats(hist):
    if len(hist) != 256 or not all(isinstance(c, int) and not isinstance(c, bool) and c >= 0 for c in hist):
        raise ValueError('Expected a 256-bin histogram of pixel counts')
    n = sum(hist)
    if not n:
        raise ValueError('Empty histogram')

    def percentile(q):
        target, total = q * n, 0
        for i, count in enumerate(hist):
            total += count
            if total >= target:
                return round(i / 255, 4)
        return 1.0
    return {'pixels': n, 'mean': round(sum(i * c for i, c in enumerate(hist)) / n / 255, 4),
            'p05': percentile(.05), 'p50': percentile(.5), 'p95': percentile(.95),
            'clipped_high': round(sum(hist[250:]) / n, 4), 'crushed_low': round(sum(hist[:6]) / n, 4)}


def exposure_flags(stats):
    flags = []
    if stats['p05'] >= WASHED_OUT_P05 or stats['clipped_high'] >= WASHED_OUT_CLIPPED:
        flags.append('washed_out')
    if stats['p50'] < TOO_DARK_P50 or stats['p95'] < TOO_DARK_P95:
        flags.append('too_dark')
    if stats['p95'] - stats['p05'] < LOW_CONTRAST_SPREAD:
        flags.append('low_contrast')
    return flags
