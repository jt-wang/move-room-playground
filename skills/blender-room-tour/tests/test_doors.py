"""Door interaction contract: Blender-space sign, links, rejection and pivot geometry.

Uses the invented tests/fixtures/articulated-doors.json, which the app's Node tests
also read, so Blender render poses and browser poses are checked against one truth.
"""
import copy, json, math, sys, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / 'scripts'))
from blender_tour_flow import doors  # noqa: E402

FIXTURE = json.loads((SKILL / 'tests' / 'fixtures' / 'articulated-doors.json').read_text())
EXAMPLE = SKILL / 'scripts' / 'blender_tour_flow' / 'examples' / 'articulated_room.interaction.json'


def door(spec, ident):
    return next(d for d in spec['doors'] if d['id'] == ident)


class Contract(unittest.TestCase):
    def setUp(self):
        self.spec = copy.deepcopy(FIXTURE['interaction'])

    def test_fixture_and_bundled_example_validate(self):
        doors.validate_spec(self.spec)
        doors.validate_spec(json.loads(EXAMPLE.read_text()))

    def test_legacy_schema_is_not_silently_accepted(self):
        legacy = {k: v for k, v in self.spec.items() if k not in ('schema_version', 'coordinates')}
        with self.assertRaisesRegex(ValueError, 'schema_version'):
            doors.validate_spec(legacy)

    def test_cycles_missing_parents_and_self_links_are_rejected(self):
        closet = door(self.spec, 'closet')['parts']
        cases = []
        cycle = copy.deepcopy(self.spec); parts = door(cycle, 'closet')['parts']; parts[0]['parent'] = 'ClosetPanelB'; cases.append((cycle, 'cycle'))
        missing = copy.deepcopy(self.spec); door(missing, 'closet')['parts'][1]['parent'] = 'Nowhere'; cases.append((missing, 'missing parent'))
        other = copy.deepcopy(self.spec); door(other, 'closet')['parts'][1]['parent'] = 'HingedDoor'; cases.append((other, 'missing parent'))
        selfish = copy.deepcopy(self.spec); door(selfish, 'closet')['parts'][1]['parent'] = 'ClosetPanelB'; cases.append((selfish, 'parent'))
        for spec, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                doors.validate_spec(spec)
        self.assertEqual(len(closet), 2)

    def test_invalid_motion_and_shared_ownership_are_rejected(self):
        mutations = [
            lambda s: door(s, 'hall')['parts'][0].update(angle=0),
            lambda s: door(s, 'hall')['parts'][0].update(angle=181),
            lambda s: door(s, 'hall')['parts'][0].update(angle=float('nan')),
            lambda s: door(s, 'hall')['parts'][0].update(angle=True),
            lambda s: door(s, 'hall')['parts'][0].update(slide=[1, 0, 0]),
            lambda s: door(s, 'slider')['parts'][0].update(slide=[0, 0, 0]),
            lambda s: door(s, 'slider')['parts'][0].update(slide=[5, 0, 0]),
            lambda s: door(s, 'slider')['parts'][0].update(slide=[0, float('inf'), 0]),
            lambda s: door(s, 'slider')['parts'][0].update(name='HingedDoor'),
            lambda s: door(s, 'closet')['parts'][1].update(name='ClosetPanelA'),
            lambda s: s['bounds'].update(min=[0, 0, 0.1]),
            lambda s: s.update(coordinates='web-y-up'),
            lambda s: s.update(id='practice-room'),
            lambda s: s.update(levels=[]),
        ]
        for i, mutate in enumerate(mutations):
            spec = copy.deepcopy(self.spec); mutate(spec)
            with self.subTest(case=i), self.assertRaises(ValueError):
                doors.validate_spec(spec)


class Kinematics(unittest.TestCase):
    def setUp(self):
        self.spec = FIXTURE['interaction']
        self.pivots = {k: tuple(v) for k, v in FIXTURE['pivots'].items()}

    def pose(self, name, fraction):
        d = next(d for d in self.spec['doors'] if any(p['name'] == name for p in d['parts']))
        return doors.part_transforms(d, fraction, self.pivots)[name]

    def test_panel_endpoints_and_sign(self):
        for probe in FIXTURE['probes']:
            with self.subTest(probe=probe):
                got = doors.apply(self.pose(probe['part'], probe['fraction']), probe['point'])
                for a, b in zip(got, probe['expected']):
                    self.assertAlmostEqual(a, b, delta=1e-6)

    def test_closed_pose_is_identity(self):
        for name in self.pivots:
            angle, t = self.pose(name, 0)
            self.assertEqual(angle, 0); self.assertEqual(tuple(t), (0, 0, 0))

    def test_bifold_panels_stay_joined_and_on_track(self):
        closet = door(self.spec, 'closet')
        for step in range(11):
            f = step / 10
            poses = doors.part_transforms(closet, f, self.pivots)
            joint_on_a = doors.apply(poses['ClosetPanelA'], self.pivots['ClosetPanelB'])
            joint_on_b = doors.apply(poses['ClosetPanelB'], self.pivots['ClosetPanelB'])
            self.assertLess(math.dist(joint_on_a, joint_on_b), 1e-9)
            hinge = doors.apply(poses['ClosetPanelA'], self.pivots['ClosetPanelA'])
            self.assertLess(math.dist(hinge, self.pivots['ClosetPanelA']), 1e-9)  # jamb hinge never moves
            free_end = doors.apply(poses['ClosetPanelB'], (2.9, 3.0, 1.0))
            self.assertAlmostEqual(free_end[1], 3.0, delta=1e-9)  # equal panels: free edge rides the track

    def test_runtime_conversion_matches_web_convention(self):
        bounds, runtime = doors.to_runtime(self.spec)
        self.assertEqual(bounds, FIXTURE['runtime']['bounds'])
        self.assertEqual(runtime, FIXTURE['runtime']['doors'])
        # Blender +Z by angle equals web +Y by the same angle: check one rotated point both ways.
        a = math.radians(37)
        p = (0.3, -1.2, 0.7)
        blender_rotated = doors.apply((a, (0, 0, 0)), p)
        x, y, z = doors.web(p)
        web_rotated = [x * math.cos(a) + z * math.sin(a), y, -x * math.sin(a) + z * math.cos(a)]
        for u, v in zip(doors.web(blender_rotated), web_rotated):
            self.assertAlmostEqual(u, v, delta=1e-12)


class PivotGeometry(unittest.TestCase):
    def setUp(self):
        self.spec = FIXTURE['interaction']
        self.bounds = copy.deepcopy(FIXTURE['bounds'])
        self.pivots = copy.deepcopy(FIXTURE['pivots'])

    def test_fixture_passes_and_reports_open_corners(self):
        report = doors.check_geometry(self.spec, self.bounds, self.pivots)
        self.assertEqual({r['part'] for r in report}, set(self.pivots))
        self.assertNotIn('ClosetFrame', {r['part'] for r in report})
        hinged = next(r for r in report if r['part'] == 'HingedDoor')
        # The free edge (x=1.8) ends 0.8 m along +Y from the hinge, within the leaf thickness of x=1.0.
        self.assertTrue(any(abs(c[1] - .8) < 1e-6 and abs(c[0] - 1.0) <= .02 + 1e-6 for c in hinged['open_corners']))
        self.assertFalse(any(c[1] < -.03 for c in hinged['open_corners']))

    def test_hinge_off_its_panel_is_rejected(self):
        self.pivots['HingedDoor'] = [0.5, 0.0, 0.0]
        with self.assertRaisesRegex(ValueError, 'Hinge pivot'):
            doors.check_geometry(self.spec, self.bounds, self.pivots)

    def test_linked_panel_away_from_parent_is_rejected(self):
        self.bounds['ClosetPanelB'] = {'min': [2.6, 2.99, 0.0], 'max': [3.05, 3.01, 2.0]}
        self.pivots['ClosetPanelB'] = [2.6, 3.0, 0.0]
        with self.assertRaisesRegex(ValueError, 'separate'):
            doors.check_geometry(self.spec, self.bounds, self.pivots)

    def test_missing_group_is_rejected(self):
        del self.bounds['SlidingDoor']
        with self.assertRaisesRegex(ValueError, 'not an exported group'):
            doors.check_geometry(self.spec, self.bounds, self.pivots)


if __name__ == '__main__':
    unittest.main()
