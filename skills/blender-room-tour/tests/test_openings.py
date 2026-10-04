"""Walls and frames around openings stay separate boxes so a doorway is not a collision obstacle.

The app collides with one axis-aligned box per exported object. These checks use the same
pure layout functions the Blender helpers call (invented dimensions only).
"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from blender_tour_flow.openings import frame_parts, wall_strips  # noqa: E402


def overlaps(box, point, r=.04):
    (lo, hi) = box
    return all(lo[i] - r < point[i] < hi[i] + r for i in range(3))


class Openings(unittest.TestCase):
    # Invented wall along X with a 0.8 m doorway and a window, like the articulated example.
    strips = wall_strips('x', -.1, 4.3, -.1, 0, 2.5, [(.5, 1.3, 0, 2.0), (2.0, 3.0, .9, 2.1)])
    frame = frame_parts('x', .5, 1.3, -.1, 0, 2.02)

    def test_open_doorway_is_clear_while_the_adjacent_wall_blocks(self):
        doorway, wall = (.9, -.05, .9), (.2, -.05, .9)
        self.assertFalse(any(overlaps(b, doorway) for b in self.strips + self.frame))
        self.assertTrue(any(overlaps(b, wall) for b in self.strips))
        # A single box around the same strips (the regression) would block the doorway.
        packed = (tuple(min(b[0][i] for b in self.strips) for i in range(3)), tuple(max(b[1][i] for b in self.strips) for i in range(3)))
        self.assertTrue(overlaps(packed, doorway))

    def test_strips_cover_the_wall_exactly_once(self):
        area = sum((hi[0] - lo[0]) * (hi[2] - lo[2]) for lo, hi in self.strips)
        self.assertAlmostEqual(area, 4.4 * 2.5 - .8 * 2.0 - 1.0 * 1.2)
        for i, a in enumerate(self.strips):
            for b in self.strips[i + 1:]:
                self.assertFalse(all(a[0][k] < b[1][k] - 1e-9 and b[0][k] < a[1][k] - 1e-9 for k in range(3)))
        window_sill = (2.5, -.05, .5)
        self.assertTrue(any(overlaps(b, window_sill, 0) for b in self.strips))  # wall below a window stays solid

    def test_frame_posts_are_separate_and_threshold_is_below_the_furniture_band(self):
        self.assertEqual(len(self.frame), 4)
        jambs = [b for b in self.frame if b[1][2] - b[0][2] > 1]
        self.assertEqual(len(jambs), 2)
        threshold = [b for b in self.frame if b[1][2] <= .01 + 1e-9]
        self.assertEqual(len(threshold), 1)  # the app ignores boxes below 6 cm, so it never blocks the doorway

    def test_invalid_openings_are_rejected(self):
        for bad in ([(-.5, .5, 0, 2)], [(.5, 1.3, 0, 3)], [(.5, 1.3, 0, 2), (1.0, 1.6, 0, 2)]):
            with self.subTest(openings=bad), self.assertRaises(ValueError):
                wall_strips('x', -.1, 4.3, -.1, 0, 2.5, bad)


if __name__ == '__main__':
    unittest.main()
