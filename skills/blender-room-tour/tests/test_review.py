"""Still-image jobs and the source-versus-render review gate, without Blender.

Builds are simulated with the same files a real build writes (receipt, public
allowlist, renders, summary.json, checks.json), so the gate logic is exercised
end to end: a build is never acceptance, verdicts bind to exact renders, every
earlier defect must be rechecked, coverage must be explicit, and any source,
recipe, coverage or build change invalidates the review.
"""
import hashlib, json, os, sys, tempfile, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / 'scripts'))
from blender_tour_flow import cli, publish, review  # noqa: E402
from blender_tour_flow.prepare import prepare_stills  # noqa: E402

PNG, JPG = b'\x89PNG\r\n\x1a\n', b'\xff\xd8\xff'
GOOD = {'pixels': 100, 'mean': .55, 'p05': .1, 'p50': .6, 'p95': .9, 'clipped_high': 0, 'crushed_low': 0}
WASHED = {'pixels': 100, 'mean': .93, 'p05': .8, 'p50': .94, 'p95': .97, 'clipped_high': .1, 'crushed_low': 0}
VIEWS = [{'name': 'Kitchen', 'label': 'Kitchen', 'source_frames': ['frame_a.png'], 'spaces': ['kitchen'], 'cutaway': False},
         {'name': 'Hall', 'label': 'Hall', 'source_frames': ['frame_b.jpg'], 'spaces': ['hall'], 'cutaway': False},
         {'name': 'Overview', 'label': 'Overview', 'source_frames': [], 'spaces': ['kitchen', 'hall'], 'cutaway': True}]
COVERAGE = {'schema_version': 1, 'requested_scope': 'Every space visible in the supplied images',
            'spaces': [{'id': 'kitchen', 'label': 'Kitchen', 'in_scope': True, 'status': 'modeled', 'evidence': ['frame_a.png']},
                       {'id': 'hall', 'label': 'Hall', 'in_scope': True, 'status': 'modeled'},
                       {'id': 'bath', 'label': 'Bath', 'in_scope': True, 'status': 'not_visible',
                        'note': 'No supplied image shows it'}],
            'unmatched_frames': {'frame_c.jpg': 'Same viewpoint as frame_b.jpg'}}


def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()


class StillsJob(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.images = root / 'approved'; self.images.mkdir()
        (self.images / 'frame_a.png').write_bytes(PNG + b'a'); (self.images / 'frame_b.jpg').write_bytes(JPG + b'b')
        (self.images / 'frame_c.jpg').write_bytes(JPG + b'c'); (self.images / 'notes.txt').write_text('ignored')
        self.job = prepare_stills([self.images], root / 'job')
        self.build_count = 0

    def tearDown(self): self.tmp.cleanup()

    def author(self):
        (self.job / 'observations.md').write_text('# Visual observations\n\nKitchen in frame_a.png; hall in frame_b.jpg.\n')
        (self.job / 'recipe.py').write_text('def build_scene():\n    return {}\n')
        scene = json.loads((self.job / 'scene.json').read_text()); scene['observations_reviewed'] = True
        (self.job / 'scene.json').write_text(json.dumps(scene))
        (self.job / 'coverage.json').write_text(json.dumps(COVERAGE))

    def make_build(self, tier='final', flags=None, sources=None, open_views=()):
        self.build_count += 1
        build_id = f'20260101-00000{self.build_count}-abcdef'
        out = self.job / 'builds' / build_id; (out / 'renders').mkdir(parents=True); (out / 'public').mkdir()
        for name in publish.PUBLIC_FILES: (out / 'public' / name).write_text(name)
        for v in VIEWS: (out / 'renders' / f'{v["name"]}.png').write_bytes(PNG + f'{build_id}{v["name"]}'.encode())
        for name in open_views: (out / 'renders' / f'{name}__doors_open.png').write_bytes(PNG + f'{build_id}{name}open'.encode())
        flags = flags or {}
        sources = sources or {}
        checks = {'render_tier': tier, 'samples': 64 if tier == 'final' else 16,
                  'resolution': [1920, 1080] if tier == 'final' else [1280, 720], 'visual_review': 'pending',
                  'review_flags': {v['name']: flags.get(v['name'], []) for v in VIEWS},
                  'exposure': {v['name']: {'render': WASHED if 'washed_out' in flags.get(v['name'], []) else GOOD,
                                           'sources': {f: sources.get(f, {'stats': GOOD, 'flags': []}) for f in v['source_frames']}}
                               for v in VIEWS},
                  'review_lighting': [{'view': v['name'], 'fill': None} for v in VIEWS], 'near_occluder': {}}
        (out / 'summary.json').write_text(json.dumps({'views': VIEWS, 'renders': [f'renders/{v["name"]}.png' for v in VIEWS]}))
        (out / 'checks.json').write_text(json.dumps(checks))
        cli.write_receipt(out)
        state = {'build': f'builds/{build_id}', 'kind': 'stills', 'render_tier': tier,
                 'recipe_sha256': sha(self.job / 'recipe.py'), 'scene_sha256': sha(self.job / 'scene.json'),
                 'interaction_sha256': None}
        (self.job / 'state.json').write_text(json.dumps(state))
        return build_id

    def fill(self, folder, overrides=None, note='', open_pose=False):
        manifest = json.loads((folder / 'manifest.json').read_text())
        verdicts = json.loads((folder / 'verdicts.json').read_text())
        for v in manifest['views']:
            entry = verdicts['views'][v['name']]
            entry['opened'] = {'render': True, 'sources': [s['frame'] for s in v['sources']]}
            entry['verdict'] = 'pass'
            if v['doors_open_render'] and open_pose:
                entry['opened']['doors_open_render'] = True
                entry['doors_open_verdict'] = 'pass'
            entry.update((overrides or {}).get(v['name'], {}))
        verdicts['iteration_note'] = note
        (folder / 'verdicts.json').write_text(json.dumps(verdicts))
        return manifest

    # --- stills job and gates ---------------------------------------------------------
    def test_stills_job_records_hashes_and_never_claims_video(self):
        meta = json.loads((self.job / 'metadata.json').read_text())
        self.assertEqual((meta['kind'], meta['source'], meta['input_scope']), ('stills', None, 'screened_stills'))
        self.assertEqual(sorted(Path(f['path']).name for f in meta['frames']), ['frame_a.png', 'frame_b.jpg', 'frame_c.jpg'])
        self.assertFalse((self.job / 'references' / 'notes.txt').exists())
        self.assertIn('No continuous video', (self.job / 'reference-sheet.html').read_text())
        self.assertIn('No continuous video', review.input_scope(meta)['statement'])
        with self.assertRaisesRegex(ValueError, 'observations'): cli.check_gates(self.job)
        self.author(); self.assertEqual(cli.check_gates(self.job)[0], 'stills')

    def test_stills_gate_refuses_changed_or_extra_images(self):
        self.author()
        (self.job / 'references' / 'frame_b.jpg').write_bytes(JPG + b'edited')
        with self.assertRaisesRegex(ValueError, 'changed'): cli.check_gates(self.job)
        (self.job / 'references' / 'frame_b.jpg').write_bytes(JPG + b'b')
        (self.job / 'references' / 'frame_x.jpg').write_bytes(JPG + b'x')
        with self.assertRaisesRegex(ValueError, 'Unlisted'): cli.check_gates(self.job)

    def test_stills_input_rejections(self):
        root = Path(self.tmp.name)
        (root / 'bad').mkdir(); (root / 'bad' / 'fake.jpg').write_text('not an image')
        with self.assertRaisesRegex(ValueError, 'Not a JPEG'): prepare_stills([root / 'bad' / 'fake.jpg'], root / 'j1')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            prepare_stills([self.images / 'frame_a.png', self.images / 'frame_a.png'], root / 'j2')
        os.symlink(self.images / 'frame_b.jpg', root / 'link.jpg')
        with self.assertRaisesRegex(ValueError, 'Symlink'): prepare_stills([root / 'link.jpg'], root / 'j3')
        with self.assertRaisesRegex(ValueError, 'empty'): prepare_stills([self.images], self.job)

    # --- review gate -------------------------------------------------------------------
    def test_build_alone_is_not_acceptance_and_complete_review_is(self):
        self.author(); self.make_build()
        self.assertEqual(review.status(self.job), 'pending')
        folder = review.create(self.job)
        manifest = json.loads((folder / 'manifest.json').read_text())
        self.assertEqual(manifest['input_scope']['kind'], 'screened_stills')
        self.assertEqual([s['frame'] for s in manifest['views'][0]['sources']], ['frame_a.png'])
        self.assertIn('../../references/frame_a.png', (folder / 'sheet.html').read_text())
        result, blockers = review.check(self.job)
        self.assertEqual(result, 'not_accepted')
        self.assertTrue(any('not pass' in b for b in blockers))
        self.assertFalse((self.job / 'review' / 'acceptance.json').exists())
        self.fill(folder)
        self.assertEqual(review.check(self.job), ('accepted', []))
        acceptance = json.loads((self.job / 'review' / 'acceptance.json').read_text())
        self.assertEqual(acceptance['limitations'], ['Bath: not_visible - No supplied image shows it'])
        self.assertNotIn('%', json.dumps(acceptance))
        self.assertEqual(review.status(self.job), 'accepted')
        # Any later change to the recipe or sources makes the acceptance stale.
        (self.job / 'recipe.py').write_text('def build_scene():\n    return {"changed": True}\n')
        self.assertEqual(review.status(self.job), 'stale')
        result, blockers = review.check(self.job)
        self.assertEqual(result, 'not_accepted')
        self.assertTrue(any('recipe.py changed' in b for b in blockers))

    def test_unopened_pixels_wrong_render_and_diagnostic_builds_are_refused(self):
        self.author(); self.make_build(tier='diagnostic_preview')
        folder = review.create(self.job)
        self.assertIn('DIAGNOSTIC PREVIEW', (folder / 'sheet.html').read_text())
        self.fill(folder, {'Kitchen': {'opened': {'render': True, 'sources': []}, 'render_sha256': 'stale'}})
        _, blockers = review.check(self.job)
        text = '\n'.join(blockers)
        self.assertIn('Diagnostic preview build', text)
        self.assertIn("open each matched source image ['frame_a.png']", text)
        self.assertIn('different render', text)

    def test_correction_iteration_requires_recheck_of_failed_views_and_defects(self):
        self.author(); self.make_build()
        first = review.create(self.job)
        defect = {'id': 'sink-flat', 'category': 'fixture_detail', 'description': 'Sink is a flat plate', 'status': 'open'}
        self.fill(first, {'Kitchen': {'verdict': 'fail', 'defects': [defect]}})
        result, blockers = review.check(self.job)
        self.assertEqual(result, 'not_accepted')
        self.assertTrue(any('defect sink-flat is open' in b for b in blockers))
        # The author revises its own recipe and rebuilds.
        (self.job / 'recipe.py').write_text('def build_scene():\n    return {"hollow_basin": True}\n')
        self.make_build()
        second = review.create(self.job)
        manifest = json.loads((second / 'manifest.json').read_text())
        self.assertEqual(manifest['recheck']['previously_failed_views'], ['Kitchen'])
        self.assertEqual(manifest['recheck']['views_to_recheck'], ['Kitchen', 'Overview'])
        self.fill(second)
        _, blockers = review.check(self.job)
        self.assertTrue(any('Earlier defect sink-flat' in b for b in blockers))
        self.assertTrue(any('iteration_note' in b for b in blockers))
        self.fill(second, {'Kitchen': {'resolved_defects': {'sink-flat': 'Hollow basin now visible in Kitchen and Overview'}}},
                  note='Rebuilt the sink as a cut-out with a hollow basin')
        self.assertEqual(review.check(self.job), ('accepted', []))
        iterations = json.loads((self.job / 'review' / 'acceptance.json').read_text())['iterations']
        self.assertEqual(iterations[0]['failed_views'], ['Kitchen'])

    def test_washed_out_render_blocks_unless_the_source_shares_it(self):
        self.author(); self.make_build(flags={'Kitchen': ['washed_out']})
        folder = review.create(self.job); self.fill(folder)
        _, blockers = review.check(self.job)
        self.assertTrue(any('washed_out but its source is not' in b for b in blockers))
        self.make_build(flags={'Kitchen': ['washed_out'], 'Hall': ['near_occluder']},
                        sources={'frame_a.png': {'stats': WASHED, 'flags': ['washed_out']}})
        folder = review.create(self.job); self.fill(folder)
        _, blockers = review.check(self.job)
        self.assertTrue(any('flag washed_out needs a written disposition' in b for b in blockers))
        self.assertTrue(any('flag near_occluder needs a written disposition' in b for b in blockers))
        self.fill(folder, {'Kitchen': {'flag_dispositions': {'washed_out': 'Source frame is equally overexposed by the window'}},
                           'Hall': {'flag_dispositions': {'near_occluder': 'Source also has the door edge in the foreground'}}},
                  note='Re-rendered after comparing exposure with the sources')
        self.assertEqual(review.check(self.job), ('accepted', []))

    def test_coverage_must_be_complete_or_explicit(self):
        self.author()
        coverage = json.loads(json.dumps(COVERAGE))
        coverage['spaces'][2] = {'id': 'bath', 'label': 'Bath', 'in_scope': True, 'status': 'missing'}
        coverage['unmatched_frames'] = {}
        coverage['spaces'].append({'id': 'storage', 'label': 'Storage', 'in_scope': True, 'status': 'modeled'})
        (self.job / 'coverage.json').write_text(json.dumps(coverage))
        self.make_build()
        folder = review.create(self.job); self.fill(folder)
        _, blockers = review.check(self.job)
        text = '\n'.join(blockers)
        self.assertIn('In-scope space bath is missing', text)
        self.assertIn('Space storage is marked modeled but no view', text)
        self.assertIn('Reference frame_c.jpg is neither matched', text)
        # Editing coverage after the manifest invalidates the review until it is regenerated.
        (self.job / 'coverage.json').write_text(json.dumps(COVERAGE))
        _, blockers = review.check(self.job)
        self.assertTrue(any('coverage.json changed' in b for b in blockers))
        review.create(self.job)
        self.assertEqual(review.check(self.job), ('accepted', []))

    def accept(self, **build):
        self.author(); self.make_build(**build)
        folder = review.create(self.job); self.fill(folder)
        self.assertEqual(review.check(self.job), ('accepted', []))
        self.assertEqual(review.status(self.job), 'accepted')
        return folder

    def edit_verdict(self, folder, view, **changes):
        path = folder / 'verdicts.json'; verdicts = json.loads(path.read_text())
        verdicts['views'][view].update(changes); path.write_text(json.dumps(verdicts))

    def test_changing_a_passed_verdict_to_fail_revokes_acceptance(self):
        folder = self.accept()
        self.edit_verdict(folder, 'Kitchen', verdict='fail')
        self.assertEqual(review.status(self.job), 'stale')  # without running review-check again

    def test_failed_review_check_revokes_acceptance_until_a_new_pass_and_keeps_history(self):
        folder = self.accept()
        self.edit_verdict(folder, 'Kitchen', verdict='fail')
        self.assertEqual(review.check(self.job)[0], 'not_accepted')
        self.edit_verdict(folder, 'Kitchen', verdict='pass')  # restoring the file does not revive the old pass
        self.assertEqual(review.status(self.job), 'stale')
        self.assertEqual(review.check(self.job), ('accepted', []))
        self.assertEqual(review.status(self.job), 'accepted')
        history = json.loads((self.job / 'review' / 'history.json').read_text())
        self.assertEqual([h['status'] for h in history], ['accepted', 'not_accepted', 'accepted'])
        self.assertIn('acceptance', history[0])
        self.assertTrue((folder / 'manifest.json').is_file() and (folder / 'verdicts.json').is_file())

    def test_editing_earlier_review_history_or_manifest_revokes_acceptance(self):
        self.author(); self.make_build()
        first = review.create(self.job)
        defect = {'id': 'sink-flat', 'category': 'fixture_detail', 'description': 'Sink is a flat plate', 'status': 'open'}
        self.fill(first, {'Kitchen': {'verdict': 'fail', 'defects': [defect]}})
        (self.job / 'recipe.py').write_text('def build_scene():\n    return {"hollow_basin": True}\n')
        self.make_build(); second = review.create(self.job)
        self.fill(second, {'Kitchen': {'resolved_defects': {'sink-flat': 'Hollow basin checked'}}}, note='Rebuilt sink')
        self.assertEqual(review.check(self.job), ('accepted', []))
        original = (first / 'verdicts.json').read_bytes()
        self.edit_verdict(first, 'Kitchen', defects=[])  # rewriting history that defined the carried defect
        self.assertEqual(review.status(self.job), 'stale')
        (first / 'verdicts.json').write_bytes(original)
        self.assertEqual(review.status(self.job), 'accepted')
        manifest = json.loads((second / 'manifest.json').read_text()); manifest['recheck']['carried_defects'] = []
        (second / 'manifest.json').write_text(json.dumps(manifest))
        self.assertEqual(review.status(self.job), 'stale')

    def test_changed_source_image_revokes_acceptance(self):
        self.accept()
        (self.job / 'references' / 'frame_a.png').write_bytes(PNG + b'replaced')
        self.assertEqual(review.status(self.job), 'stale')

    def test_doors_open_render_needs_its_own_opened_hash_bound_verdict(self):
        self.author(); self.make_build(open_views=('Kitchen',))
        folder = review.create(self.job)
        template = json.loads((folder / 'verdicts.json').read_text())['views']
        manifest = json.loads((folder / 'manifest.json').read_text())
        self.assertEqual(template['Kitchen']['doors_open_render_sha256'], manifest['views'][0]['doors_open_render']['sha256'])
        self.assertEqual((template['Kitchen']['opened']['doors_open_render'], template['Kitchen']['doors_open_verdict']), (False, 'pending'))
        self.assertNotIn('doors_open_verdict', template['Hall'])
        self.fill(folder)  # every closed render passes, the open pose was never opened
        _, blockers = review.check(self.job)
        self.assertTrue(any('opened.doors_open_render' in b for b in blockers))
        self.assertTrue(any('doors_open_verdict' in b for b in blockers))
        self.fill(folder, {'Kitchen': {'doors_open_verdict': 'fail'}}, open_pose=True)
        self.assertEqual(review.check(self.job)[0], 'not_accepted')
        good = manifest['views'][0]['doors_open_render']['sha256']
        self.fill(folder, {'Kitchen': {'doors_open_render_sha256': 'other'}}, open_pose=True)
        self.assertTrue(any('doors-open verdict is for a different render' in b for b in review.check(self.job)[1]))
        self.fill(folder, {'Kitchen': {'doors_open_render_sha256': good}}, open_pose=True)
        self.assertEqual(review.check(self.job), ('accepted', []))

    def test_synthetic_examples_cannot_be_reviewed(self):
        job = cli.example(Path(self.tmp.name) / 'example', 'articulated')
        self.assertTrue((job / 'interaction.json').is_file())
        with self.assertRaisesRegex(ValueError, 'Synthetic'): review.create(job)


if __name__ == '__main__':
    unittest.main()
