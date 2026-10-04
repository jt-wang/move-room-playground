"""Source-versus-render review: manifest, sheet, verdicts and the acceptance gate.

A successful build is never a visual acceptance. `review` lists, for the current
immutable build, each view's render and its explicitly matched source images.
The model author opens those actual pixels, records a verdict per view in
verdicts.json, revises its own recipe, rebuilds and reviews again. `review-check`
accepts only when every view of a final-quality build passes, every earlier
defect was rechecked, coverage is complete or explicitly unresolved/not visible,
and no source, recipe, scene, coverage, interaction or build file changed since
the manifest. Nothing here measures fidelity or produces an accuracy score.
Standard library only.
"""
import hashlib
import html
import json
from datetime import datetime, timezone
from pathlib import Path

from .contract import BLOCKING_EXPOSURE_FLAGS, SPACE_ID

SPACE_STATUS = ('modeled', 'unresolved', 'not_visible', 'missing')
DEFECT_CATEGORIES = ('geometry', 'proportion', 'fixture_detail', 'material', 'lighting', 'camera', 'door',
                     'coverage', 'other')
DEFECT_STATUS = ('open', 'fixed', 'unresolved')
INPUT_FILES = ('metadata.json', 'observations.md', 'recipe.py', 'scene.json', 'coverage.json', 'interaction.json')
STATEMENT = ('Model-author visual review against the supplied source images. It is not a measurement, '
             'an accuracy score, or a fidelity certification.')


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def input_scope(meta):
    if meta.get('kind') == 'stills':
        return {'kind': 'screened_stills', 'images': len(meta.get('frames', [])),
                'statement': f'{len(meta.get("frames", []))} screened still images. No continuous video was '
                             'available or reviewed.'}
    return {'kind': 'video_frames', 'images': len(meta.get('frames', [])),
            'statement': 'Extracted video frames; the author may also inspect the original local video.'}


def input_hashes(job, meta):
    job = Path(job)
    files = {name: (sha(job / name) if (job / name).is_file() else None) for name in INPUT_FILES}
    for frame in meta.get('frames', []):
        path = job / frame['path']
        files[frame['path']] = sha(path) if path.is_file() else None
    extra = sorted(p.name for p in (job / 'references').iterdir()) if (job / 'references').is_dir() else []
    files['references/'] = sorted(extra)
    video = (meta.get('source') or {}).get('sha256')
    if video:
        files['source_video_sha256'] = video
    return files


def frame_names(meta):
    return [Path(f['path']).name for f in meta.get('frames', [])]


def validate_coverage(coverage, frames, views):
    """Return blockers for incomplete or unexplained scope and frame coverage."""
    blockers = []
    if not isinstance(coverage, dict) or coverage.get('schema_version') != 1 or \
            not set(coverage) <= {'schema_version', 'requested_scope', 'spaces', 'unmatched_frames', 'notes'}:
        return ['coverage.json must have schema_version 1 with requested_scope, spaces and unmatched_frames']
    if not isinstance(coverage.get('requested_scope'), str) or not coverage['requested_scope'].strip():
        blockers.append('coverage.json requested_scope must state what the user asked to model')
    spaces = coverage.get('spaces')
    if not isinstance(spaces, list) or not spaces:
        return blockers + ['coverage.json must list every visible or requested space']
    ids = set()
    covered = {s for v in views if v.get('source_frames') for s in v.get('spaces', [])}
    for space in spaces:
        if not isinstance(space, dict) or not set(space) <= {'id', 'label', 'in_scope', 'status', 'evidence', 'note'}:
            blockers.append('Each space needs id, label, in_scope, status and optional evidence/note'); continue
        sid = space.get('id')
        if not isinstance(sid, str) or not SPACE_ID.fullmatch(sid) or sid in ids:
            blockers.append(f'Invalid or duplicate space id {sid!r}'); continue
        ids.add(sid)
        if not isinstance(space.get('label'), str) or not space['label'].strip() or not isinstance(space.get('in_scope'), bool):
            blockers.append(f'Space {sid} needs a label and boolean in_scope')
        status = space.get('status')
        if status not in SPACE_STATUS:
            blockers.append(f'Space {sid} status must be one of {", ".join(SPACE_STATUS)}'); continue
        evidence = space.get('evidence', [])
        if not isinstance(evidence, list) or not all(isinstance(x, str) and x in frames for x in evidence):
            blockers.append(f'Space {sid} evidence must name supplied reference images')
        note = space.get('note')
        if not space.get('in_scope'):
            continue
        if status == 'modeled' and sid not in covered:
            blockers.append(f'Space {sid} is marked modeled but no view with a matched source image covers it')
        elif status == 'missing':
            blockers.append(f'In-scope space {sid} is missing; model it, or mark it unresolved/not_visible with the reason')
        elif status in ('unresolved', 'not_visible') and (not isinstance(note, str) or not note.strip()):
            blockers.append(f'Space {sid} is {status} and needs a note explaining the evidence gap')
    for v in views:
        unknown = set(v.get('spaces', [])) - ids
        if unknown:
            blockers.append(f'View {v["name"]} names spaces missing from coverage.json: {sorted(unknown)}')
    unmatched = coverage.get('unmatched_frames', {})
    if not isinstance(unmatched, dict) or not all(isinstance(r, str) and r.strip() for r in unmatched.values()):
        return blockers + ['unmatched_frames must map image names to a reason']
    matched = {f for v in views for f in v.get('source_frames', [])}
    for name in frames:
        if name not in matched and name not in unmatched:
            blockers.append(f'Reference {name} is neither matched to a view nor listed in unmatched_frames with a reason')
    for name in unmatched:
        if name not in frames:
            blockers.append(f'unmatched_frames names unknown image {name}')
    return blockers


def adjacency(views):
    """Views sharing a space or declared adjacent (either direction)."""
    result = {v['name']: set(v.get('adjacent', [])) for v in views}
    for a in views:
        for b in views:
            if a is not b and (set(a.get('spaces', [])) & set(b.get('spaces', [])) or a['name'] in b.get('adjacent', [])):
                result[a['name']].add(b['name'])
    return {k: sorted(v) for k, v in result.items()}


def prior_reviews(job, build_id):
    """Earlier builds' verdicts, oldest first."""
    root = Path(job) / 'review'
    found = []
    if root.is_dir():
        for folder in sorted(p for p in root.iterdir() if p.is_dir() and p.name < build_id):
            if (folder / 'verdicts.json').is_file():
                try:
                    found.append((folder.name, load(folder / 'verdicts.json')))
                except json.JSONDecodeError:
                    continue
    return found


def carried_defects(prior):
    """Failed views and every defect recorded in earlier reviews."""
    failed, defects = set(), {}
    for build, verdicts in prior:
        for view, entry in (verdicts.get('views') or {}).items():
            if not isinstance(entry, dict):
                continue
            if entry.get('verdict') == 'fail':
                failed.add(view)
            for d in entry.get('defects', []):
                if isinstance(d, dict) and isinstance(d.get('id'), str):
                    defects[d['id']] = {'id': d['id'], 'view': view, 'build': build,
                                        'category': d.get('category'), 'description': d.get('description', '')}
    return failed, defects


def create(job):
    """Write review/<build>/manifest.json, sheet.html and a pending verdicts.json for the current build."""
    from . import cli
    job = Path(job).resolve()
    meta = load(job / 'metadata.json')
    if meta.get('kind') == 'synthetic':
        raise ValueError('Synthetic examples have no source images; there is nothing to review against')
    build_dir, state = cli.current(job)
    cli.check_gates(job)
    summary, checks = load(build_dir / 'summary.json'), load(build_dir / 'checks.json')
    build_id = build_dir.name
    frames = {Path(f['path']).name: f for f in meta.get('frames', [])}
    lighting = {item['view']: item for item in checks.get('review_lighting', [])}
    views = []
    for v in summary['views']:
        render = f'renders/{v["name"]}.png'
        sources = []
        for name in v.get('source_frames', []):
            if name not in frames or not (job / 'references' / name).is_file():
                raise ValueError(f'View {v["name"]} names unknown reference image {name}')
            sources.append({'frame': name, 'path': 'references/' + name, 'sha256': sha(job / 'references' / name),
                            'timestamp_seconds': frames[name].get('timestamp_seconds')})
        open_render = f'renders/{v["name"]}__doors_open.png'
        views.append({'name': v['name'], 'label': v.get('label', v['name']), 'cutaway': v.get('cutaway', False),
                      'orientation': v.get('orientation', 'landscape'), 'spaces': v.get('spaces', []),
                      'adjacent': v.get('adjacent', []),
                      'render': {'path': f'builds/{build_id}/{render}', 'sha256': sha(build_dir / render)},
                      'doors_open_render': ({'path': f'builds/{build_id}/{open_render}', 'sha256': sha(build_dir / open_render)}
                                            if (build_dir / open_render).is_file() else None),
                      'sources': sources, 'exposure': (checks.get('exposure') or {}).get(v['name']),
                      'lighting': lighting.get(v['name']), 'near_occluder': (checks.get('near_occluder') or {}).get(v['name']),
                      'flags': (checks.get('review_flags') or {}).get(v['name'], [])})
    failed, defects = carried_defects(prior_reviews(job, build_id))
    near = adjacency(summary['views'])
    recheck = sorted(failed | {n for f in failed for n in near.get(f, [])})
    manifest = {'schema_version': 1, 'build': build_id, 'build_receipt_sha256': sha(build_dir / 'receipt.json'),
                'render_tier': checks.get('render_tier', 'unknown'), 'samples': checks.get('samples'),
                'resolution': checks.get('resolution'), 'input_scope': input_scope(meta),
                'inputs': input_hashes(job, meta), 'views': views, 'adjacency': near,
                'recheck': {'previously_failed_views': sorted(failed), 'views_to_recheck': recheck,
                            'carried_defects': sorted(defects.values(), key=lambda d: d['id'])},
                'door_checks': checks.get('door_checks'), 'statement': STATEMENT}
    folder = job / 'review' / build_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (folder / 'sheet.html').write_text(sheet(manifest))
    if not (folder / 'verdicts.json').exists():
        (folder / 'verdicts.json').write_text(json.dumps(verdict_template(build_id, views), indent=2) + '\n')
    return folder


def verdict_template(build_id, views):
    entries = {}
    for v in views:
        entry = {'render_sha256': v['render']['sha256'], 'opened': {'render': False, 'sources': []},
                 'verdict': 'pending', 'defects': [], 'resolved_defects': {}, 'flag_dispositions': {}}
        if v.get('doors_open_render'):
            # The open pose is separate evidence: a correct closed render cannot vouch for folding or swing.
            entry['opened']['doors_open_render'] = False
            entry['doors_open_render_sha256'] = v['doors_open_render']['sha256']
            entry['doors_open_verdict'] = 'pending'
        entries[v['name']] = entry
    return {'schema_version': 1, 'build': build_id, 'iteration_note': '', 'views': entries}


def _rel(manifest_path):
    return '../../' + manifest_path


def sheet(manifest):
    e = html.escape
    rows = []
    tier = manifest['render_tier']
    banner = ('' if tier == 'final' else
              '<p class="warn">DIAGNOSTIC PREVIEW: these renders are below final quality and cannot be used as '
              'acceptance evidence.</p>')
    for v in manifest['views']:
        sources = ''.join(f'<figure><img src="{e(_rel(s["path"]))}" alt=""><figcaption>Source {e(s["frame"])}</figcaption></figure>'
                          for s in v['sources']) or '<p class="warn">No matched source image.</p>'
        door = (f'<figure><img src="{e(_rel(v["doors_open_render"]["path"]))}" alt=""><figcaption>Doors open</figcaption></figure>'
                if v['doors_open_render'] else '')
        stats = v.get('exposure') or {}
        rstats = stats.get('render') or {}
        src_stats = '; '.join(f'{e(k)} p05 {s["stats"]["p05"]} p50 {s["stats"]["p50"]} p95 {s["stats"]["p95"]}'
                              for k, s in (stats.get('sources') or {}).items() if s)
        fill = (v.get('lighting') or {}).get('fill')
        rows.append(
            f'<section><h2>{e(v["name"])} — {e(v["label"])}</h2>'
            f'<p>Spaces: {e(", ".join(v["spaces"]) or "none")} · Adjacent: {e(", ".join(manifest["adjacency"].get(v["name"], [])) or "none")}'
            f' · Flags: <b>{e(", ".join(v["flags"]) or "none")}</b></p>'
            f'<div class="pair">{sources}<figure><img src="{e(_rel(v["render"]["path"]))}" alt="">'
            f'<figcaption>Render {e(v["render"]["sha256"][:12])}</figcaption></figure>{door}</div>'
            f'<p>Render luma p05 {rstats.get("p05")} p50 {rstats.get("p50")} p95 {rstats.get("p95")} clipped {rstats.get("clipped_high")}'
            f' · Source {src_stats or "n/a"} · Camera fill: {e(json.dumps(fill)) if fill else "none"}'
            f' · Near occluder share: {v.get("near_occluder")}</p></section>')
    recheck = manifest['recheck']
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><title>Source versus render review</title>'
            '<style>body{font:15px sans-serif;margin:24px;background:#f3f3f1}section{background:#fff;padding:12px;margin:12px 0}'
            '.pair{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}'
            'img{height:420px;max-width:100%;object-fit:contain;background:#222}.warn{color:#a00;font-weight:bold}</style>'
            f'<h1>Source versus render review · build {e(manifest["build"])}</h1>{banner}'
            f'<p>{e(manifest["input_scope"]["statement"])} Render tier: {e(tier)} ({manifest["samples"]} samples, '
            f'{e(str(manifest["resolution"]))}). {e(manifest["statement"])}</p>'
            f'<p>Previously failed views: {e(", ".join(recheck["previously_failed_views"]) or "none")}. '
            f'Recheck: {e(", ".join(recheck["views_to_recheck"]) or "all views")}.</p>'
            + ''.join(rows) + '</html>')


def review_records(job, build_id):
    """Hashes of every review record the outcome depends on: this build's manifest and verdicts, and all
    earlier manifests/verdicts, which define previously failed views and carried defects."""
    root = Path(job) / 'review'
    records = {}
    if root.is_dir():
        for folder in sorted(p for p in root.iterdir() if p.is_dir() and p.name <= build_id):
            for name in ('manifest.json', 'verdicts.json'):
                if (folder / name).is_file():
                    records[f'{folder.name}/{name}'] = sha(folder / name)
    return records


def evaluate(job):
    """Read-only review evaluation of the current build: (build_id, blockers, context).

    Re-runs the build gates, which rehash a video source or every still image, so a
    changed source can never leave an earlier acceptance visible. context is None when
    the build has no review manifest yet.
    """
    from . import cli
    job = Path(job).resolve()
    build_dir, state = cli.current(job)
    build_id = build_dir.name
    folder = job / 'review' / build_id
    if not (folder / 'manifest.json').is_file():
        return build_id, [f'No review manifest for build {build_id}; run review first'], None
    manifest = load(folder / 'manifest.json')
    meta = load(job / 'metadata.json')
    blockers = []
    try:
        cli.check_gates(job)
    except ValueError as exc:
        blockers.append(f'Build inputs no longer pass the gates: {exc}')
    current = input_hashes(job, meta)
    for key in sorted(set(current) | set(manifest['inputs'])):
        if current.get(key) != manifest['inputs'].get(key):
            blockers.append(f'{key} changed since the review manifest; rebuild and run review again')
    if sha(build_dir / 'receipt.json') != manifest['build_receipt_sha256']:
        blockers.append('Build receipt differs from the reviewed build')
    for name, key in (('recipe.py', 'recipe_sha256'), ('scene.json', 'scene_sha256'), ('interaction.json', 'interaction_sha256')):
        path = job / name
        if (sha(path) if path.is_file() else None) != state.get(key):
            blockers.append(f'{name} changed after build {build_id}; rebuild before review')
    if manifest['render_tier'] != 'final':
        blockers.append('Diagnostic preview build; final evidence needs 64 samples at 1920x1080 (or the same size in portrait)')
    coverage_path = job / 'coverage.json'
    coverage = load(coverage_path) if coverage_path.is_file() else None
    blockers += validate_coverage(coverage, frame_names(meta),
                                  [{'name': v['name'], 'spaces': v['spaces'], 'source_frames': [s['frame'] for s in v['sources']]}
                                   for v in manifest['views']])
    verdict_path = folder / 'verdicts.json'
    verdicts = load(verdict_path) if verdict_path.is_file() else {}
    entries = verdicts.get('views') if isinstance(verdicts.get('views'), dict) else {}
    if verdicts.get('build') != build_id:
        blockers.append('verdicts.json must name the current build')
    resolved = {}
    for v in manifest['views']:
        name, entry = v['name'], entries.get(v['name'])
        if not isinstance(entry, dict):
            blockers.append(f'View {name}: no verdict'); continue
        if entry.get('render_sha256') != v['render']['sha256']:
            blockers.append(f'View {name}: verdict is for a different render')
        opened = entry.get('opened') or {}
        if opened.get('render') is not True:
            blockers.append(f'View {name}: open the actual render pixels and set opened.render to true')
        expected = sorted(s['frame'] for s in v['sources'])
        if sorted(opened.get('sources') or []) != expected:
            blockers.append(f'View {name}: open each matched source image {expected} and list it in opened.sources')
        if not v['cutaway'] and not v['sources']:
            blockers.append(f'View {name}: roofed views need at least one matched source image')
        open_render = v.get('doors_open_render')
        if open_render:
            if entry.get('doors_open_render_sha256') != open_render['sha256']:
                blockers.append(f'View {name}: doors-open verdict is for a different render')
            if opened.get('doors_open_render') is not True:
                blockers.append(f'View {name}: open the doors-open render pixels and set opened.doors_open_render to true')
            if entry.get('doors_open_verdict') != 'pass':
                blockers.append(f'View {name}: doors_open_verdict is {entry.get("doors_open_verdict")!r}, not pass; '
                                'check swing side, folding and that linked panels stay joined')
        if entry.get('verdict') != 'pass':
            blockers.append(f'View {name}: verdict is {entry.get("verdict")!r}, not pass')
        for d in entry.get('defects', []):
            if not isinstance(d, dict) or not isinstance(d.get('id'), str) or d.get('category') not in DEFECT_CATEGORIES \
                    or d.get('status') not in DEFECT_STATUS or not str(d.get('description', '')).strip():
                blockers.append(f'View {name}: each defect needs id, category, description and status'); continue
            if d['status'] != 'fixed':
                blockers.append(f'View {name}: defect {d["id"]} is {d["status"]}')
        for key, note in (entry.get('resolved_defects') or {}).items():
            if isinstance(note, str) and note.strip():
                resolved[key] = (name, entry.get('verdict'))
        dispositions = entry.get('flag_dispositions') or {}
        for flag in v['flags']:
            if flag in BLOCKING_EXPOSURE_FLAGS:
                sources = [s for s in ((v.get('exposure') or {}).get('sources') or {}).values() if s]
                if not sources or not all(flag in s['flags'] for s in sources):
                    blockers.append(f'View {name}: render is {flag} but its source is not; fix the recipe lighting '
                                    'or review_lighting policy and rebuild')
                    continue
            if not str(dispositions.get(flag, '')).strip():
                blockers.append(f'View {name}: flag {flag} needs a written disposition')
    prior = prior_reviews(job, build_id)
    failed, defects = carried_defects(prior)
    names = {v['name'] for v in manifest['views']}
    for view in sorted(failed - names):
        blockers.append(f'Previously failed view {view} is missing; keep it to verify the correction')
    for defect_id, d in sorted(defects.items()):
        if defect_id not in resolved:
            blockers.append(f'Earlier defect {defect_id} ({d["view"]}, build {d["build"]}) is not recorded in resolved_defects')
    if prior and not str(verdicts.get('iteration_note', '')).strip():
        blockers.append('iteration_note must describe what changed since the previous review')
    return build_id, blockers, {'folder': folder, 'manifest': manifest, 'verdicts': verdicts, 'coverage': coverage,
                                'prior': prior, 'names': names, 'receipt_sha256': sha(build_dir / 'receipt.json')}


def _append_history(job, entry):
    """Append-only log of every review-check outcome (and each acceptance it produced)."""
    path = Path(job) / 'review' / 'history.json'
    history = load(path) if path.is_file() else []
    history.append(entry)
    path.write_text(json.dumps(history, ensure_ascii=False, indent=2) + '\n')


def check(job):
    """Return (status, blockers). Writes review/acceptance.json only when nothing blocks.

    Every outcome is appended to review/history.json; nothing earlier is deleted. A failed
    check is recorded in review/<build>/check.json, which status() then reports as stale.
    """
    job = Path(job).resolve()
    build_id, blockers, ctx = evaluate(job)
    if ctx is None:
        return 'not_reviewed', blockers
    folder, manifest, verdicts, coverage, prior, names = (ctx[k] for k in ('folder', 'manifest', 'verdicts', 'coverage', 'prior', 'names'))
    records = review_records(job, build_id)
    outcome = {'status': 'not_accepted' if blockers else 'accepted', 'build': build_id,
               'checked_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
               'build_receipt_sha256': ctx['receipt_sha256'], 'inputs': manifest['inputs'],
               'review_records': records, 'blockers': blockers}
    (folder / 'check.json').write_text(json.dumps(outcome, indent=2) + '\n')
    if blockers:
        _append_history(job, outcome)
        return 'not_accepted', blockers
    spaces = coverage['spaces']
    acceptance = {'status': 'accepted', 'build': build_id, 'build_receipt_sha256': manifest['build_receipt_sha256'],
                  'inputs': manifest['inputs'], 'render_tier': manifest['render_tier'],
                  'input_scope': manifest['input_scope'], 'requested_scope': coverage['requested_scope'],
                  'views': sorted(names),
                  'spaces': {s['id']: s['status'] for s in spaces if s.get('in_scope')},
                  'limitations': [f'{s["label"]}: {s["status"]} - {s.get("note", "")}' for s in spaces
                                  if s.get('in_scope') and s['status'] != 'modeled'],
                  'iterations': [{'build': b, 'failed_views': sorted(k for k, e in (v.get('views') or {}).items()
                                                                        if isinstance(e, dict) and e.get('verdict') == 'fail'),
                                  'note': v.get('iteration_note', '')} for b, v in prior] +
                                [{'build': build_id, 'failed_views': [], 'note': verdicts.get('iteration_note', '')}],
                  'review_records': records, 'checked_at': outcome['checked_at'], 'statement': STATEMENT}
    (job / 'review' / 'acceptance.json').write_text(json.dumps(acceptance, ensure_ascii=False, indent=2) + '\n')
    _append_history(job, dict(outcome, acceptance=acceptance))
    return 'accepted', []


def status(job):
    """'accepted' only if the current review still evaluates clean right now, matches the recorded
    acceptance (build, inputs, manifest, verdicts and history), and the latest review-check for
    this build passed with those same records. Otherwise 'stale' (or 'pending' if never accepted)."""
    job = Path(job).resolve()
    path = job / 'review' / 'acceptance.json'
    if not path.is_file():
        return 'pending'
    try:
        acceptance = load(path)
        build_id, blockers, ctx = evaluate(job)
        if ctx is None or blockers:
            return 'stale'
        records = review_records(job, build_id)
        last = load(ctx['folder'] / 'check.json') if (ctx['folder'] / 'check.json').is_file() else {}
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError):
        return 'stale'
    if acceptance.get('build') != build_id or acceptance.get('build_receipt_sha256') != ctx['receipt_sha256'] \
            or acceptance.get('inputs') != ctx['manifest']['inputs'] or acceptance.get('review_records') != records:
        return 'stale'
    if last.get('status') != 'accepted' or last.get('review_records') != records:
        return 'stale'
    return 'accepted'
