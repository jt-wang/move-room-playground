"""Portable direct-Blender room flow. Never installs software or trains a model."""
import argparse, hashlib, json, shutil, subprocess, sys, uuid
from datetime import datetime, timezone
from pathlib import Path

from . import doors
from .contract import render_tier
from .publish import (PUBLIC_FILES, VIEWER_ASSETS, assert_public_text, check_glazing,
                      check_public, embedded_images, public_strings, sanitize_glb)
from .runtime import ASSETS, PACKAGE, SCRIPTS, find_tool, run_blender

# Synthetic smoke builds may be tiny; source jobs keep a review-quality floor.
# Final evidence is 64 samples at 1920x1080; --preview builds are marked diagnostic.
QUALITY = {'synthetic': {'samples': 8, 'resolution': (480, 270), 'min_samples': 1, 'min_width': 64},
           'video': {'samples': 64, 'resolution': (1920, 1080), 'min_samples': 16, 'min_width': 1280},
           'stills': {'samples': 64, 'resolution': (1920, 1080), 'min_samples': 16, 'min_width': 1280}}
PREVIEW = {'samples': 16, 'resolution': (1280, 720)}
EXAMPLES = {'basic': ('synthetic_room.py', None),
            'articulated': ('articulated_room.py', 'articulated_room.interaction.json')}
# Full-quality multiroom jobs render every closed/open review view on CPU.
# Keep a finite total budget without stopping valid jobs at the old 15-minute default.
DEFAULT_BUILD_TIMEOUT = 7200


def digest(p):
    with Path(p).open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()


def load(p): return json.loads(Path(p).read_text())


def verify_source(source):
    path = Path(source.get('video') or '')
    if not path.is_file(): raise ValueError(f'Source video missing: {path}')
    if digest(path) != source['sha256']: raise ValueError('Source video changed since prepare')
    return path


def verify_stills(job, meta):
    """Screened stills replace the video as evidence: the hashed set must be exact and unchanged."""
    if meta.get('source'): raise ValueError('Still-image jobs must not reference a video source')
    frames = meta.get('frames') or []
    if not frames: raise ValueError('Still-image job has no reference images')
    listed = set()
    for frame in frames:
        rel = frame.get('path', '')
        path = (job / rel).resolve()
        if not rel.startswith('references/') or path.parent != (job / 'references').resolve() or path.is_symlink() \
                or not path.is_file() or not frame.get('sha256'):
            raise ValueError('Invalid reference image entry ' + str(rel))
        if digest(path) != frame['sha256']: raise ValueError(f'Reference image changed since the job was created: {rel}')
        listed.add(path.name)
    extra = {p.name for p in (job / 'references').iterdir()} - listed
    if extra: raise ValueError(f'Unlisted files in references/: {sorted(extra)}')
    return True


def write_receipt(folder):
    folder = Path(folder)
    receipt = {str(p.relative_to(folder)): digest(p) for p in sorted(folder.rglob('*')) if p.is_file() and p.name != 'receipt.json'}
    (folder / 'receipt.json').write_text(json.dumps(receipt, indent=2)); return receipt


def verify_files(folder):
    folder = Path(folder).resolve()
    for name, sha in load(folder / 'receipt.json').items():
        p = (folder / name).resolve()
        if not p.is_relative_to(folder) or not p.is_file(): raise ValueError('Artifact missing: ' + name)
        if digest(p) != sha: raise ValueError('Artifact changed: ' + name)
    return True


def check_gates(job):
    """Return (kind, metadata, scene) or raise before Blender is started."""
    job = Path(job).resolve()
    meta = load(job / 'metadata.json'); scene = load(job / 'scene.json')
    if not (job / 'recipe.py').is_file(): raise ValueError('Missing recipe.py')
    kind = meta.get('kind')
    if kind == 'synthetic':
        # A synthetic example has no video, so nothing can claim review of one.
        if meta.get('source') or (job / 'references').exists():
            raise ValueError('Synthetic jobs cannot contain a video source or references')
        if scene.get('observations_reviewed') is not False:
            raise ValueError('Synthetic jobs must keep observations_reviewed=false')
        return kind, meta, scene
    if kind not in ('video', 'stills'): raise ValueError('Unknown job kind; create jobs with prepare, stills or example')
    if scene.get('observations_reviewed') is not True:
        raise ValueError('Inspect every reference image (and the full video when one exists), fill observations.md, '
                         'then set observations_reviewed=true in scene.json')
    if meta.get('status') != 'references_ready': raise ValueError('Reference extraction has not completed')
    if kind == 'video': verify_source(meta['source'])
    else: verify_stills(job, meta)
    templates = meta.get('templates')
    if not templates: raise ValueError('Job metadata lacks template hashes; re-run prepare into a new job')
    for name in ('observations.md', 'recipe.py'):
        if digest(job / name) == templates.get(name): raise ValueError(f'{name} is still the unedited template')
    return kind, meta, scene


def quality(kind, samples, resolution, preview=False):
    q = QUALITY[kind]
    defaults = PREVIEW if preview and kind != 'synthetic' else q
    samples = defaults['samples'] if samples is None else samples
    w, h = defaults['resolution'] if resolution is None else resolution
    if samples < q['min_samples'] or w < q['min_width'] or h < 2:
        raise ValueError(f'{kind} builds need at least {q["min_samples"]} samples and {q["min_width"]}px width')
    return samples, [w, h]


def load_interaction(job):
    """Schema 2 interaction.json is checked before Blender starts; legacy files are not used by the build."""
    path = Path(job) / 'interaction.json'
    if not path.is_file(): return None
    spec = load(path)
    if isinstance(spec, dict) and 'schema_version' not in spec: return None
    return doors.validate_spec(spec)


def build(job, timeout=DEFAULT_BUILD_TIMEOUT, samples=None, resolution=None, preview=False):
    job = Path(job).resolve()
    kind, meta, scene = check_gates(job)
    samples, resolution = quality(kind, samples, resolution, preview)
    tier = 'diagnostic_preview' if kind == 'synthetic' else render_tier(samples, resolution, preview)
    interaction = load_interaction(job)
    # Hash inputs before Blender starts so later edits can never be attributed to this build.
    optional = lambda n: digest(job / n) if (job / n).is_file() else None
    inputs = {'recipe_sha256': digest(job / 'recipe.py'), 'scene_sha256': digest(job / 'scene.json'),
              'interaction_sha256': optional('interaction.json')}
    blender = find_tool('blender')
    name = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
    out = job / 'builds' / name; out.mkdir(parents=True)
    frames = {Path(f['path']).name: str(job / f['path']) for f in meta.get('frames', []) if f.get('path')}
    config = {'job': str(job), 'out': str(out), 'scripts': str(SCRIPTS), 'samples': samples, 'resolution': resolution,
              'render_tier': tier, 'interaction': interaction, 'source_frames': frames}
    (out / 'config.json').write_text(json.dumps(config, indent=2))
    try:
        run_blender(blender, PACKAGE / 'blender_export.py', [out / 'config.json'], timeout, out / 'blender.log')
        for filename in ('room.blend', 'export-raw.glb', 'summary.json', 'checks.json'):
            if not (out / filename).is_file() or not (out / filename).stat().st_size: raise ValueError('Missing export ' + filename)
        summary = load(out / 'summary.json')
        renders = [r for r in summary['renders'] if (out / r).is_file() and (out / r).stat().st_size]
        if len(renders) < 2 or len(renders) != len(summary['renders']): raise ValueError('At least two review renders are required')
        gltf, glb = sanitize_glb((out / 'export-raw.glb').read_bytes())
        check_glazing(gltf, summary['glazing'])
        # Review metadata (source image names, spaces) stays private; the preview gets camera poses only.
        public_views = [{k: v[k] for k in ('name', 'label', 'camera', 'target', 'fov')} for v in summary['views']]
        viewer = {'title': scene.get('title') or 'Room model', 'synthetic': kind == 'synthetic', 'model': 'room.glb',
                  'groups': summary['groups'], 'views': public_views, 'notes': summary['notes']}
        source = (meta.get('source') or {}).get('video', '')
        assert_public_text(public_strings(viewer, gltf), [str(job), str(Path.home()), source, Path(source).name])
        checks = load(out / 'checks.json')
        checks['embedded_textures'] = embedded_images(gltf)
        (out / 'checks.json').write_text(json.dumps(checks, indent=2))
        public = out / 'public'; public.mkdir()
        (public / 'room.glb').write_bytes(glb); (out / 'export-raw.glb').unlink()
        (public / 'viewer.json').write_text(json.dumps(viewer, ensure_ascii=False, indent=2))
        for asset in VIEWER_ASSETS: shutil.copyfile(ASSETS / asset, public / asset)
        check_public(public)
        write_receipt(out)
        state = {'build': str(out.relative_to(job)), 'kind': kind, 'status': 'exported', 'visual_review': 'pending',
                 'render_tier': tier, 'observations_reviewed': scene.get('observations_reviewed') is True, **inputs,
                 'source_sha256': (meta.get('source') or {}).get('sha256'), 'checks': load(out / 'checks.json')}
        (job / 'state.json').write_text(json.dumps(state, indent=2)); return out
    except BaseException as e:
        (out / 'failure.json').write_text(json.dumps({'status': 'failed', 'error': str(e)}, indent=2)); raise


def current(job):
    job = Path(job).resolve(); state = load(job / 'state.json'); p = (job / state['build']).resolve()
    if not p.is_relative_to(job / 'builds'): raise ValueError('Invalid build path')
    verify_files(p); check_public(p / 'public'); return p, state


def example(out, variant='basic'):
    out = Path(out).resolve()
    if variant not in EXAMPLES: raise ValueError('Unknown example variant')
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise ValueError('Output directory must be empty; existing work is never overwritten')
    out.mkdir(parents=True, exist_ok=True)
    recipe, interaction = EXAMPLES[variant]
    shutil.copyfile(PACKAGE / 'examples' / recipe, out / 'recipe.py')
    if interaction: shutil.copyfile(PACKAGE / 'examples' / interaction, out / 'interaction.json')
    (out / 'metadata.json').write_text(json.dumps({'schema_version': 2, 'kind': 'synthetic', 'source': None,
                                                   'status': 'synthetic_ready'}, indent=2) + '\n')
    (out / 'scene.json').write_text(json.dumps({'schema_version': 2, 'title': 'Synthetic example room',
                                                'modeling_status': 'synthetic_example', 'observations_reviewed': False}, indent=2) + '\n')
    (out / 'observations.md').write_text('# Synthetic example\n\nNo video exists for this job and no observations were reviewed. '
                                         'The geometry is invented to exercise the build, verify, and serve steps.\n')
    return out


def serve(job):
    from .server import make_server
    build_dir, _ = current(job)
    server = make_server(build_dir / 'public')
    try:
        print(f'http://127.0.0.1:{server.server_port}/', flush=True); server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


# Official install commands, printed next to a missing tool so the agent can offer them to the person.
# Checked 2026-10-07: Homebrew cask blender and formulae ffmpeg, python@3.12; the Blender Foundation's verified
# classic snap; Ubuntu's ffmpeg package; winget manifests BlenderFoundation.Blender, Gyan.FFmpeg, Python.Python.3.12.
INSTALL = {
    'darwin': {'blender': 'brew install --cask blender', 'ffmpeg': 'brew install ffmpeg', 'python': 'brew install python@3.12'},
    'linux': {'blender': 'sudo snap install blender --classic', 'ffmpeg': 'sudo apt install ffmpeg', 'python': 'sudo apt install python3'},
    'win32': {'blender': 'winget install -e --id BlenderFoundation.Blender', 'ffmpeg': 'winget install -e --id Gyan.FFmpeg',
              'python': 'winget install -e --id Python.Python.3.12'},
}
DOWNLOADS = {'blender': 'https://www.blender.org/download/', 'ffmpeg': 'https://ffmpeg.org/download.html',
             'python': 'https://www.python.org/downloads/'}


def install_hint(name):
    if name == 'ffprobe': return 'comes with ffmpeg'
    platform = 'linux' if sys.platform.startswith('linux') else sys.platform
    command = INSTALL.get(platform, {}).get(name)
    return f'{command} (or {DOWNLOADS[name]})' if command else DOWNLOADS[name]


def doctor(stills=False):
    ok = True
    v = sys.version_info; version = f'{v[0]}.{v[1]}.{v[2]}'
    if tuple(v[:2]) >= (3, 11): print(f'python: OK {version}')
    else: ok = False; print(f'python: MISSING {version} is older than 3.11'); print(f'install python: {install_hint("python")}')
    if stills: print('Still-image jobs: FFmpeg/ffprobe are not required and are not checked.')
    for name in (('blender',) if stills else ('ffmpeg', 'ffprobe', 'blender')):
        try:
            path = find_tool(name)
            flag = '--version' if name == 'blender' else '-version'
            first = subprocess.run([str(path), flag], capture_output=True, text=True, timeout=120).stdout.splitlines()[:1]
            print(f'{name}: OK {path} {first[0] if first else ""}')
        except (ValueError, OSError, subprocess.SubprocessError) as e:
            ok = False; print(f'{name}: MISSING {e}'); print(f'install {name}: {install_hint(name)}')
    try:
        if not stills:
            filters = subprocess.run([str(find_tool('ffmpeg')), '-hide_banner', '-filters'], capture_output=True, text=True, timeout=60).stdout
            print('ffmpeg zscale (HDR sources):', 'OK' if ' zscale ' in filters else 'MISSING; HDR videos need --decoder avfoundation on macOS 15+ or an HDR-capable FFmpeg')
    except (ValueError, OSError, subprocess.SubprocessError): pass
    for asset in VIEWER_ASSETS:
        present = (ASSETS / asset).is_file(); ok &= present
        print(f'viewer asset {asset}:', 'OK' if present else 'MISSING')
    return 0 if ok else 1


def resolution_arg(text):
    try: w, h = (int(x) for x in text.lower().split('x'))
    except ValueError: raise argparse.ArgumentTypeError('use WIDTHxHEIGHT, e.g. 1920x1080') from None
    return w, h


def main(argv=None):
    p = argparse.ArgumentParser(prog='blender-tour'); sub = p.add_subparsers(dest='command', required=True)
    q = sub.add_parser('doctor', help='report tools and bundled viewer assets')
    q.add_argument('--stills', action='store_true', help='check only what still-image jobs need (no FFmpeg)')
    q = sub.add_parser('prepare', help='hash a video and extract reference frames into a new job')
    q.add_argument('video', type=Path); q.add_argument('--out', type=Path, required=True)
    q.add_argument('--decoder', choices=('ffmpeg', 'avfoundation'), default='ffmpeg');
    q.add_argument('--frames', type=int, default=12); q.add_argument('--long-edge', type=int, default=1920)
    q = sub.add_parser('stills', help='create a job from already screened still images (no video)')
    q.add_argument('images', type=Path, nargs='+', help='image files or one folder of .jpg/.png images')
    q.add_argument('--out', type=Path, required=True)
    q = sub.add_parser('example', help='create a synthetic example job (no video)'); q.add_argument('out', type=Path)
    q.add_argument('--variant', choices=sorted(EXAMPLES), default='basic')
    q = sub.add_parser('build', help='run recipe.py in background Blender and publish the preview')
    q.add_argument('job', type=Path)
    q.add_argument('--timeout', type=float, default=DEFAULT_BUILD_TIMEOUT,
                   help='total Blender time limit in seconds (default: 7200 / 2 hours); partial renders are retained on timeout')
    q.add_argument('--samples', type=int); q.add_argument('--resolution', type=resolution_arg)
    q.add_argument('--preview', action='store_true', help='faster diagnostic renders; never acceptance evidence')
    q = sub.add_parser('verify', help='check build artifact hashes and the public allowlist'); q.add_argument('job', type=Path)
    q = sub.add_parser('review', help='write the source-versus-render manifest, sheet and verdict template'); q.add_argument('job', type=Path)
    q = sub.add_parser('review-check', help='accept the current build only if the recorded review is complete'); q.add_argument('job', type=Path)
    q = sub.add_parser('serve', help='serve the public preview on a random localhost port'); q.add_argument('job', type=Path)
    a = p.parse_args(argv)
    try:
        if a.command == 'doctor': return doctor(a.stills)
        if a.command == 'prepare':
            from .prepare import prepare
            print(prepare(a.video, a.out, find_tool('ffmpeg'), find_tool('ffprobe'), a.frames, a.long_edge, a.decoder))
        elif a.command == 'stills':
            from .prepare import prepare_stills
            print(prepare_stills(a.images, a.out))
            print('Selection is a privacy claim by whoever supplied the images; nothing was detected or redacted.')
        elif a.command == 'example': print(example(a.out, a.variant))
        elif a.command == 'build':
            if a.timeout <= 0: raise ValueError('timeout must be positive')
            out = build(a.job, a.timeout, a.samples, a.resolution, a.preview)
            print(out)
            tier = load(out / 'checks.json').get('render_tier')
            print(f'Exported ({tier}). A successful build is not visual acceptance: run review, open every listed '
                  'source and render, record verdicts, then run review-check.')
        elif a.command == 'verify':
            from .review import status
            path, state = current(a.job)
            print('Artifact hashes verified:', path)
            print('Public preview files:', ', '.join(sorted(PUBLIC_FILES)))
            print('Render tier:', state.get('render_tier', 'unknown (built before render tiers existed)'))
            textures = state.get('checks', {}).get('embedded_textures', {})
            if textures.get('count'):
                print(f'Embedded textures: {textures["count"]} ({textures["bytes"]} bytes). '
                      'Review their pixels and image metadata before sharing.')
            if state.get('kind') == 'synthetic': print('Synthetic example: no video was observed or reviewed.')
            if state.get('kind') == 'stills': print('Input: screened still images only; no continuous video was reviewed.')
            if (Path(a.job) / 'recipe.py').is_file() and digest(Path(a.job) / 'recipe.py') != state.get('recipe_sha256'):
                print('recipe.py changed after this build; rebuild before review.')
            print('Visual review:', status(a.job), '(accepted only via review-check; hashes do not prove resemblance '
                  'or rights to share the source).')
        elif a.command == 'review':
            from .review import create
            folder = create(a.job)
            print(folder)
            print('Open each render and its matched source images listed in manifest.json, then fill verdicts.json.')
        elif a.command == 'review-check':
            from .review import check
            result, blockers = check(a.job)
            print('Visual review:', result)
            for b in blockers: print(' -', b)
            if result != 'accepted': return 1
            print('Accepted by the model author against the supplied sources; not a measured or certified fidelity result.')
        elif a.command == 'serve': serve(a.job)
        return 0
    except (ValueError, RuntimeError, OSError, KeyError, json.JSONDecodeError, subprocess.CalledProcessError) as e:
        print(str(e), file=sys.stderr); return 1
