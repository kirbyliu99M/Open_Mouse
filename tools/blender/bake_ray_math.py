"""Pure selection for missed-ray repair; successful first-pass texels win."""
import numpy as np


def fallback_selection(first_hits, second_hits, source_normals, target_normals, valid):
    facing = np.sum(np.asarray(source_normals)*np.asarray(target_normals), axis=-1) >= 0
    return (np.asarray(valid, bool) & ~np.asarray(first_hits, bool)
            & np.asarray(second_hits, bool) & facing)


def merge_fallback(first, second, selection):
    result = np.array(first, copy=True)
    result[np.asarray(selection, bool)] = np.asarray(second)[np.asarray(selection, bool)]
    return result


def fill_from_neighbours(values, known, region):
    """Grow known texels into unknown ones inside `region`, one 4-neighbour ring at a time.

    Each unknown texel takes the mean of its already-known neighbours. Texels
    outside `region` are never read or written, so islands do not bleed across
    the atlas gap. Returns (filled values, texels filled, texels left unknown).
    """
    values = np.array(values, dtype=np.float32, copy=True)
    region = np.asarray(region, bool)
    known = np.asarray(known, bool) & region
    target = region & ~known
    start = int(target.sum())
    while True:
        total = np.zeros(values.shape, np.float32)
        count = np.zeros(known.shape, np.float32)
        for axis, step in ((0, 1), (0, -1), (1, 1), (1, -1)):
            shifted_known = np.zeros_like(known)
            shifted = np.zeros_like(values)
            src = [slice(None)] * 2
            dst = [slice(None)] * 2
            src[axis] = slice(None, -1) if step == 1 else slice(1, None)
            dst[axis] = slice(1, None) if step == 1 else slice(None, -1)
            shifted_known[tuple(dst)] = known[tuple(src)]
            shifted[tuple(dst)] = values[tuple(src)]
            total += shifted * shifted_known[..., None]
            count += shifted_known
        grow = target & ~known & (count > 0)
        if not grow.any():
            break
        values[grow] = total[grow] / count[grow][:, None]
        known = known | grow
    remaining = int((target & ~known).sum())
    return values, start - remaining, remaining
