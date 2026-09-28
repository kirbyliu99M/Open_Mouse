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
