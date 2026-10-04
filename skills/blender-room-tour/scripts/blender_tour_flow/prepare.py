"""Prepare local video evidence without guessing room geometry or installing tools."""

import hashlib
import html
import json
import math
import os
import re
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile


RECIPE_TEMPLATE = '''"""Author this scene after visually inspecting references and observations.md.

build_scene() runs inside Blender and must return:
{"groups": {"RoomWalls": ["wall_object"], "RoomFloor": ["floor_object"],
            "Furniture_01": ["separate_furniture_object"]},
 "labels": {"Furniture_01": "Sofa"},
 "glazing": ["Window_Glass"],
 "views": [{"name": "Entrance", "position": [0, -4, 1.6], "target": [0, 0, 1.2],
            "source_frames": ["frame_001.jpg"], "spaces": ["living"],
            "orientation": "portrait"}, ...at least one more distinct view],
 "review_lighting": {"camera_fill": "auto"},   # optional; see reference.md
 "notes": ["Describe uncertain dimensions and unseen surfaces."]}

Use Blender Z-up world coordinates. Supply at least two inspection views and
match each roofed view to the reference image(s) it reproduces.
JOB_ROOT is injected as a pathlib.Path value. Optional helpers for inset
basins, burners, shelves, cabinet fronts, plank floors, windows and doors:
    from blender_tour_flow import geometry as g
RoomWalls and RoomFloor are required; RoomCeiling is optional. Each furniture
item needs its own group and independent geometry, never joined to walls.
Assign every mesh/curve object to exactly one group. List every intentionally
transparent material in "glazing" (Principled Alpha below 1); all others must
export opaque. Object, material, label, note, and title strings are published
in the preview, so keep them generic. After completing visual review, set
observations_reviewed to true in scene.json before building.
The example above documents the contract; it is not a model of these sources.
"""


def build_scene():
    raise NotImplementedError(
        "Inspect reference-sheet.html and references, fill observations.md, "
        "then author build_scene() with separate room surfaces and furniture."
    )
'''

COVERAGE_TEMPLATE = {
    'schema_version': 1,
    'requested_scope': '',
    'spaces': [],
    'unmatched_frames': {},
}


def write_authoring_files(out, input_scope):
    """Write observations/recipe/scene/coverage templates; return the gated template hashes."""
    out = Path(out)
    if input_scope == 'screened_stills':
        source_note = ('Inspect every supplied still image. No continuous video is available, so '
                       'never claim a video review or timestamps you did not see.')
    else:
        source_note = 'Inspect the reference sheet and original video before filling this document.'
    (out / 'observations.md').write_text(
        '# Visual observations\n\nStatus: awaiting visual review.\n\n'
        f'{source_note}\n\n'
        '## Room surfaces\n\nRecord visible walls, floor, openings, and reference images or timestamps.\n\n'
        '## Separate objects\n\nRecord each furniture item, approximate shape, placement, '
        'color, and supporting images.\n\n'
        '## Uncertainty\n\nRecord unseen surfaces and estimated dimensions explicitly.\n\n'
        '## Inspection views\n\nChoose at least two differing views that expose separation '
        'between furniture and room surfaces, and name the source image each one reproduces.\n')
    (out / 'recipe.py').write_text(RECIPE_TEMPLATE)
    (out / 'coverage.json').write_text(json.dumps(COVERAGE_TEMPLATE, indent=2) + '\n')
    # The build gate refuses these files while they are still unedited templates.
    templates = {name: hashlib.sha256((out / name).read_bytes()).hexdigest()
                 for name in ('observations.md', 'recipe.py')}
    # The title is published in the preview; never default it to a source file name.
    (out / 'scene.json').write_text(json.dumps({
        'schema_version': 2, 'title': 'Room model',
        'modeling_status': 'awaiting_visual_review', 'observations_reviewed': False,
    }, indent=2) + '\n')
    return templates


STILL_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:jpe?g|png)', re.IGNORECASE)
STILL_MAGIC = (b'\xff\xd8\xff', b'\x89PNG\r\n\x1a\n')


def stills_sheet(frames, title):
    cards = ''.join(
        f'<figure><a href="{html.escape(f["path"])}"><img src="{html.escape(f["path"])}" alt=""></a>'
        f'<figcaption>{html.escape(Path(f["path"]).name)}'
        + (f' · {f["timestamp_seconds"]:.3f} s' if f.get('timestamp_seconds') is not None else '')
        + '</figcaption></figure>' for f in frames)
    return ('<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(title)}</title>'
            '<style>body{font:16px sans-serif;margin:24px;background:#eee}'
            'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}'
            'figure{margin:0}img{width:100%;height:400px;object-fit:contain;background:#222}</style>'
            f'<h1>{html.escape(title)}</h1><p>Screened still images only. No continuous video is part of this job. '
            f'Geometry has not been modeled.</p><main>{cards}</main></html>')


def prepare_stills(images, out: Path) -> Path:
    """Create a job from already screened still images; no video is required or implied.

    Images keep their safe file names so review notes can cite them. Each file's
    SHA-256 is recorded and the build refuses to run if any of them changes.
    """
    out = Path(out).resolve()
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise ValueError('Output directory must be empty; existing work is never overwritten')
    paths = []
    for item in map(Path, images):
        if item.is_symlink():
            raise ValueError(f'Symlinks are refused: {item}')
        if item.is_dir():
            paths += sorted(p for p in item.iterdir() if p.is_file() and STILL_NAME.fullmatch(p.name))
        else:
            paths.append(item)
    if not paths:
        raise ValueError('No .jpg/.jpeg/.png images supplied')
    names, digests, frames = set(), set(), []
    for path in paths:
        if path.is_symlink() or not path.is_file() or not STILL_NAME.fullmatch(path.name):
            raise ValueError(f'Use regular .jpg/.jpeg/.png files with simple names: {path.name}')
        data = path.read_bytes()
        if not data.startswith(STILL_MAGIC):
            raise ValueError(f'Not a JPEG or PNG image: {path.name}')
        digest = hashlib.sha256(data).hexdigest()
        if path.name in names or digest in digests:
            raise ValueError(f'Duplicate image name or content: {path.name}')
        names.add(path.name); digests.add(digest)
        frames.append({'path': 'references/' + path.name, 'sha256': digest, 'timestamp_seconds': None, '_source': path})
    out.mkdir(parents=True, exist_ok=True)
    (out / 'references').mkdir()
    for frame in frames:
        shutil.copyfile(frame.pop('_source'), out / frame['path'])
    metadata = {'schema_version': 2, 'kind': 'stills', 'input_scope': 'screened_stills', 'source': None,
                'status': 'references_ready', 'frames': frames,
                'privacy_screening': {'method': 'Images supplied as already screened by the user; '
                                                'this command does not detect faces, text or metadata',
                                      'raw_video_copied': False}}
    (out / 'reference-sheet.html').write_text(stills_sheet(frames, 'Screened still references'))
    metadata['templates'] = write_authoring_files(out, 'screened_stills')
    (out / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    return out


def prepare(video: Path, out: Path, ffmpeg: Path, ffprobe: Path,
            max_frames=12, long_edge=1920, decoder='ffmpeg') -> Path:
    """Create a fresh evidence folder; failures remain marked in metadata.json."""
    video, out = Path(video).resolve(), Path(out).resolve()
    ffmpeg, ffprobe = Path(ffmpeg).resolve(), Path(ffprobe).resolve()
    if not video.is_file() or video.stat().st_size == 0:
        raise ValueError('Source video must be an existing, nonempty file')
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise ValueError('Output directory must be empty; existing work is never overwritten')
    if not isinstance(max_frames, int) or isinstance(max_frames, bool) or max_frames < 1:
        raise ValueError('max_frames must be a positive integer')
    if not isinstance(long_edge, int) or isinstance(long_edge, bool) or long_edge < 2:
        raise ValueError('long_edge must be an integer of at least 2')
    for tool in (ffmpeg, ffprobe):
        if not tool.is_file() or not os.access(tool, os.X_OK):
            raise ValueError(f'Provide an existing executable: {tool}; no tools are installed')
    try:
        probe_result = subprocess.run(
            [str(ffprobe), '-v', 'error', '-show_format', '-show_streams',
             '-of', 'json', str(video)], check=True, capture_output=True, text=True)
        probe = json.loads(probe_result.stdout)
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError) as exc:
        raise ValueError(f'Unable to probe source video: {exc}') from exc
    streams = [s for s in probe.get('streams', [])
               if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')]
    if not streams:
        raise ValueError('Source contains no video stream')
    stream = streams[0]
    is_hdr = stream.get('color_transfer') in ('smpte2084', 'arib-std-b67') or any(
        'DOVI' in entry.get('side_data_type', '') for entry in stream.get('side_data_list', []))
    if decoder not in ('ffmpeg', 'avfoundation'):
        raise ValueError('Unknown decoder')
    if decoder == 'avfoundation' and (sys.platform != 'darwin' or not shutil.which('swiftc')):
        raise ValueError('AVFoundation extraction requires macOS 15+ and installed Swift compiler; nothing is installed automatically')
    if is_hdr and decoder == 'ffmpeg':
        # Fail before creating a partial job; never silently treat HDR as SDR.
        result = subprocess.run(
            [str(ffmpeg), '-hide_banner', '-filters'],
            check=True, capture_output=True, text=True)
        filters = {parts[1] for line in result.stdout.splitlines()
                   if len(parts := line.split()) >= 3 and '->' in parts[2]}
        missing = {'zscale', 'tonemap'} - filters
        if missing:
            raise ValueError(
                'HDR source requires FFmpeg filters: ' + ', '.join(sorted(missing)) +
                f'. Selected executable: {ffmpeg}. Set FFMPEG_BIN and FFPROBE_BIN '
                'to an installed HDR-capable build, then run doctor. See reference.md '
                'HDR setup. Installing zimg alone does not add filters to an existing '
                'FFmpeg binary. No files were created and no software was installed.')
    try:
        duration = float(probe.get('format', {}).get('duration') or stream.get('duration'))
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        raise ValueError('Source video requires a finite positive duration') from None
    digest = hashlib.sha256()
    with video.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    source = {'video': str(video), 'sha256': digest.hexdigest(),
              'size_bytes': video.stat().st_size, 'duration_seconds': duration,
              'video_stream': stream}
    metadata = {'schema_version': 2, 'kind': 'video', 'source': source, 'status': 'extracting',
                'tools': {'ffmpeg': str(ffmpeg), 'ffprobe': str(ffprobe)},
                'tonemapping': ('Apple forceSDR followed by color-managed sRGB conversion' if decoder == 'avfoundation' else 'HDR to SDR Hable BT709' if is_hdr else 'SDR unchanged'),
                'decoder': decoder,
                'long_edge': long_edge, 'frames': []}
    out.mkdir(parents=True, exist_ok=True)
    (out / 'references').mkdir()

    def save_metadata():
        (out / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')

    save_metadata()
    try:
        if decoder == 'avfoundation':
            native = out / 'native-extraction'
            with tempfile.TemporaryDirectory(prefix='blender-tour-native-') as tmp:
                binary = Path(tmp) / 'extract-sdr'
                helper = Path(__file__).with_name('extract_sdr.swift')
                subprocess.run([shutil.which('swiftc'), '-parse-as-library', '-module-cache-path',
                                str(Path(tmp) / 'cache'), str(helper), '-o', str(binary)],
                               check=True, capture_output=True, text=True)
                subprocess.run([str(binary), str(video), str(native), str(max_frames), str(long_edge)],
                               check=True, capture_output=True, text=True)
            extraction = json.loads((native / 'extraction.json').read_text())
            if len(extraction['frames']) != max_frames:
                raise RuntimeError('Native extraction returned an unexpected frame count')
            metadata['native_extraction'] = extraction
            for frame in extraction['frames']:
                name = Path(frame['path']).name
                if name != frame['path'] or not name.endswith('.jpg'):
                    raise RuntimeError('Unexpected native frame path')
                relative = 'references/' + name
                shutil.move(str(native / name), out / relative)
                metadata['frames'].append({'path': relative, 'timestamp_seconds': frame['timestamp_seconds'],
                                           'actual_timestamp_seconds': frame['actual_timestamp_seconds']})
            save_metadata()
        # Use bin midpoints so even the last sample is strictly before EOF.
        for index in range(max_frames if decoder == 'ffmpeg' else 0):
            timestamp = duration * (index + 0.5) / max_frames
            relative = f'references/frame_{index + 1:03d}.jpg'
            target = out / relative
            scale = (f'scale=w=min({long_edge}\\,iw):h=min({long_edge}\\,ih):'
                     'force_original_aspect_ratio=decrease')
            # HDR tonemapping needs an FFmpeg build with zscale (zimg); doctor reports it.
            filters = (['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709',
                        'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv']
                       if is_hdr else []) + [scale, 'format=yuvj420p']
            subprocess.run(
                [str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
                 '-ss', str(timestamp), '-i', str(video), '-map', f'0:{stream.get("index", 0)}',
                 '-frames:v', '1', '-vf', ','.join(filters), '-q:v', '2', str(target)],
                check=True, capture_output=True, text=True)
            if not target.is_file() or target.stat().st_size == 0:
                raise RuntimeError(f'No reference image produced at {timestamp:.3f}s')
            metadata['frames'].append({'path': relative, 'timestamp_seconds': timestamp})
            save_metadata()
        cards = ''.join(
            f'<figure><a href="{f["path"]}"><img src="{f["path"]}" '
            f'alt="Video at {f["timestamp_seconds"]:.3f} seconds"></a>'
            f'<figcaption>{f["timestamp_seconds"]:.3f} seconds</figcaption></figure>'
            for f in metadata['frames'])
        (out / 'reference-sheet.html').write_text(
            '<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(video.stem)} references</title>'
            '<style>body{font:16px sans-serif;margin:24px;background:#eee}'
            'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}'
            'figure{margin:0}img{width:100%;height:400px;object-fit:contain;background:#222}</style>'
            f'<h1>{html.escape(video.stem)}</h1><p>Original video reference frames. '
            f'Geometry has not been modeled.</p><main>{cards}</main></html>')
        metadata['templates'] = write_authoring_files(out, 'video_frames')
        metadata['status'] = 'references_ready'
        save_metadata()
    except Exception as exc:
        metadata['status'] = 'failed'
        metadata['error'] = str(getattr(exc, 'stderr', None) or exc)
        save_metadata()
        raise RuntimeError(f'Preparation failed; inspect {out / "metadata.json"}: '
                           f'{metadata["error"]}') from exc
    return out
