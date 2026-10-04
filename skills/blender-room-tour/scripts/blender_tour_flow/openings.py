"""Box layout for walls with openings and for door frames. Standard library only.

The app's static collision uses one axis-aligned box per exported mesh object.
Strips around a doorway packed into one mesh would therefore fill the doorway, so
these layouts are emitted as separate objects (still owned by one group).
"""


def span(axis, b0, b1, t0, t1, z0, z1):
    tl, th = min(t0, t1), max(t0, t1)
    return ((b0, tl, z0), (b1, th, z1)) if axis == 'x' else ((tl, b0, z0), (th, b1, z1))


def wall_strips(axis, a0, a1, t0, t1, height, openings=()):
    """Disjoint boxes of a wall run along X ('x') or Y ('y') with (b0, b1, z0, z1) openings cut through."""
    parts, cursor = [], a0
    for b0, b1, z0, z1 in sorted(openings):
        if not a0 <= cursor <= b0 < b1 <= a1 or not 0 <= z0 < z1 <= height:
            raise ValueError('Opening outside wall or overlapping another opening')
        if b0 > cursor:
            parts.append(span(axis, cursor, b0, t0, t1, 0, height))
        if z0 > 0:
            parts.append(span(axis, b0, b1, t0, t1, 0, z0))
        if z1 < height:
            parts.append(span(axis, b0, b1, t0, t1, z1, height))
        cursor = b1
    if a1 > cursor:
        parts.append(span(axis, cursor, a1, t0, t1, 0, height))
    return parts


def frame_parts(axis, b0, b1, t0, t1, height, jamb=.03, threshold=True):
    """Jambs, head and optional threshold of an opening, as separate boxes."""
    parts = [span(axis, b0 - jamb, b0, t0, t1, 0, height), span(axis, b1, b1 + jamb, t0, t1, 0, height),
             span(axis, b0 - jamb, b1 + jamb, t0, t1, height, height + jamb)]
    if threshold:
        parts.append(span(axis, b0, b1, t0, t1, 0, .01))
    return parts
