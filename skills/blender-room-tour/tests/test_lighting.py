"""Review lighting policy and exposure checks on deterministic synthetic frames.

The frames are generated here from invented region fractions (no real images):
an enclosed room rendered without light, a well-exposed light-walled interior
with dark window frames and plank seams, a washed-out render like the failure
mode this policy exists to catch, a blown-out frame and a flat grey frame.
"""
import importlib.util, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from blender_tour_flow import contract  # noqa: E402


def frame(regions, width=96, height=54):
    """Flat RGB pixel list: regions are (share, (r, g, b)) in display-encoded 0..1 values."""
    total = width * height
    counts = [round(share * total) for share, _ in regions]
    counts[-1] += total - sum(counts)
    pixels = []
    for count, (_, rgb) in zip(counts, regions):
        pixels += list(rgb) * count
    return pixels


FRAMES = {
    'enclosed_unlit': [(.6, (.05, .05, .05)), (.3, (.07, .06, .05)), (.1, (.02, .02, .02))],
    'light_walls_source_like': [(.30, (.80, .79, .76)), (.18, (.58, .57, .55)), (.30, (.66, .64, .60)),
                                (.08, (.36, .34, .31)), (.06, (.06, .06, .07)), (.08, (.93, .95, .97))],
    'washed_out': [(.55, (.97, .97, .96)), (.40, (.94, .94, .93)), (.03, (.80, .80, .80)), (.02, (.20, .20, .20))],
    'blown_window': [(.40, (1.0, 1.0, 1.0)), (.40, (.62, .60, .58)), (.20, (.30, .29, .28))],
    'flat_grey': [(.5, (.50, .50, .50)), (.5, (.53, .53, .53))],
}
# A washed-out frame is also genuinely flat: its few dark pixels (just under 5% after rounding)
# leave p05 ~0.94 and p95 ~0.97, so low_contrast is a correct second flag, not noise.
# blown_window covers washout from clipping while contrast survives.
EXPECTED = {'enclosed_unlit': ['too_dark', 'low_contrast'], 'light_walls_source_like': [],
            'washed_out': ['washed_out', 'low_contrast'], 'blown_window': ['washed_out'], 'flat_grey': ['low_contrast']}


class Exposure(unittest.TestCase):
    def test_regression_frames(self):
        for name, regions in FRAMES.items():
            with self.subTest(frame=name):
                stats = contract.exposure_stats(contract.luma_histogram(frame(regions), 3))
                self.assertEqual(contract.exposure_flags(stats), EXPECTED[name], stats)

    def test_light_walls_are_not_mistaken_for_washout(self):
        stats = contract.exposure_stats(contract.luma_histogram(frame(FRAMES['light_walls_source_like']), 3))
        self.assertGreater(stats['p50'], .55)  # predominantly light surfaces
        self.assertLess(stats['p05'], contract.WASHED_OUT_P05)

    def test_histogram_formats_and_rejections(self):
        rgba = contract.luma_histogram([1, 1, 1, 1, 0, 0, 0, 1], 4)
        self.assertEqual((rgba[255], rgba[0], sum(rgba)), (1, 1, 2))
        self.assertEqual(contract.luma_histogram([.5, .5], 1)[128], 2)
        for bad in ([0] * 255, [0] * 256, [1.5] * 256, [True] * 256):
            with self.assertRaises(ValueError): contract.exposure_stats(bad)
        with self.assertRaises(ValueError): contract.luma_histogram([1, 1], 3)

    @unittest.skipUnless(importlib.util.find_spec('numpy'), 'numpy not installed')
    def test_numpy_binning_matches_reference(self):
        import numpy as np
        pixels = frame(FRAMES['light_walls_source_like'])
        arr = np.array(pixels, dtype=np.float32).reshape(-1, 3)
        y = arr[:, 0] * .2126 + arr[:, 1] * .7152 + arr[:, 2] * .0722
        fast = np.bincount(np.clip(np.floor(y * 255 + .5), 0, 255).astype(np.int64), minlength=256).tolist()
        self.assertEqual(contract.exposure_stats(fast), contract.exposure_stats(contract.luma_histogram(pixels, 3)))


class FillPolicy(unittest.TestCase):
    def scene(self, ceiling=True, **lighting):
        groups = {'RoomWalls': ['W'], 'RoomFloor': ['F'], 'Chair': ['C']}
        if ceiling: groups['RoomCeiling'] = ['Ceil']
        return {'groups': groups, **({'review_lighting': lighting} if lighting else {})}

    view = {'name': 'A', 'position': [0, 0, 1.6], 'target': [0, 4, 1.0]}

    def test_enclosed_room_without_interior_lights_gets_bounded_fill(self):
        fill = contract.review_fill_for_view(self.scene(), self.view, interior_lights=0)
        self.assertEqual(fill['purpose'], 'review_only_camera_fill')
        self.assertEqual(fill['policy'], 'auto')
        self.assertTrue(10 <= fill['energy'] <= 160)
        far = contract.review_fill_for_view(self.scene(), {**self.view, 'target': [0, 40, 1]}, 0)
        self.assertEqual(far['energy'], 160)

    def test_authored_interior_lights_cutaway_or_open_rooms_get_no_fill(self):
        self.assertIsNone(contract.review_fill_for_view(self.scene(), self.view, interior_lights=3))
        self.assertIsNone(contract.review_fill_for_view(self.scene(), {**self.view, 'cutaway': True}, 0))
        self.assertIsNone(contract.review_fill_for_view(self.scene(ceiling=False), self.view, 0))

    def test_explicit_policy_needs_reason_and_bounds(self):
        off = self.scene(camera_fill='off', reason='Recipe lights match the source exposure')
        self.assertIsNone(contract.review_fill_for_view(off, self.view, 0))
        on = self.scene(camera_fill='on', fill_scale=.5, reason='Interior lights alone leave the far wall black')
        auto = contract.review_fill_for_view(self.scene(), self.view, 0)
        self.assertAlmostEqual(contract.review_fill_for_view(on, self.view, 2)['energy'], auto['energy'] * .5, places=2)
        self.assertEqual(contract.review_lighting_policy(on)['reason'], 'Interior lights alone leave the far wall black')
        for bad in ({'camera_fill': 'off'}, {'fill_scale': 5, 'reason': 'x'}, {'film_exposure': 3, 'reason': 'x'},
                    {'film_exposure': True, 'reason': 'x'}, {'camera_fill': 'max', 'reason': 'x'}, {'whiten': 1}):
            with self.subTest(policy=bad), self.assertRaises(ValueError):
                contract.review_lighting_policy({'review_lighting': bad})

    def test_default_policy_is_neutral(self):
        self.assertEqual(contract.review_lighting_policy({}), {'camera_fill': 'auto', 'fill_scale': 1.0, 'film_exposure': 0.0})


class Framing(unittest.TestCase):
    def test_render_tier_and_portrait_resolution(self):
        self.assertEqual(contract.render_tier(64, [1920, 1080]), 'final')
        self.assertEqual(contract.render_tier(64, [1080, 1920]), 'final')
        self.assertEqual(contract.render_tier(64, [1920, 1080], preview=True), 'diagnostic_preview')
        self.assertEqual(contract.render_tier(32, [1920, 1080]), 'diagnostic_preview')
        self.assertEqual(contract.render_tier(64, [1280, 720]), 'diagnostic_preview')
        self.assertEqual(contract.view_resolution([1920, 1080], {'orientation': 'portrait'}), [1080, 1920])
        self.assertEqual(contract.view_resolution([1920, 1080], {}), [1920, 1080])

    def scene(self, **view_changes):
        return {'groups': {'RoomWalls': ['W'], 'RoomFloor': ['F'], 'Chair_01': ['C']},
                'views': [{'name': 'A', 'position': [0, -3, 1.6], 'target': [0, 0, 1], **view_changes},
                          {'name': 'B', 'position': [2, -2, 2], 'target': [0, 0, 1]}],
                'notes': ['Estimated.']}

    def test_view_review_fields(self):
        contract.validate_scene(self.scene(source_frames=['frame_003.jpg'], spaces=['kitchen'], adjacent=['B'],
                                           orientation='portrait', doors_open=True), {'W', 'F', 'C'})
        for bad in ({'source_frames': ['../frame.jpg']}, {'source_frames': ['a.jpg', 'a.jpg']}, {'spaces': ['Kitchen Room']},
                    {'adjacent': ['A']}, {'adjacent': ['Missing']}, {'orientation': 'square'}, {'doors_open': 1},
                    {'source_frame': ['a.jpg']}):
            with self.subTest(view=bad), self.assertRaises(ValueError):
                contract.validate_scene(self.scene(**bad), {'W', 'F', 'C'})


if __name__ == '__main__':
    unittest.main()
