"""Composite a baked transparent cover over the baked body beneath it (pure numpy)."""
import numpy as np


def srgb_to_linear(value):
    value = np.asarray(value, dtype=float)
    return np.where(value <= .04045, value / 12.92, ((value + .055) / 1.055) ** 2.4)


def linear_to_srgb(value):
    value = np.clip(np.asarray(value, dtype=float), 0, 1)
    return np.where(value <= .0031308, value * 12.92, 1.055 * value ** (1 / 2.4) - .055)


def composite_cover(cover_srgb, body_srgb, alpha):
    """Per texel `alpha * cover + (1 - alpha) * body` in linear light.

    Colours are encoded sRGB in [0, 1] with shape (..., 3); alpha is the
    cover's own alpha with shape (...). Texels with alpha 1 keep the cover
    exactly, so surfaces without a transparent layer are unchanged.
    """
    cover = np.asarray(cover_srgb, dtype=float)
    body = np.asarray(body_srgb, dtype=float)
    weight = np.clip(np.asarray(alpha, dtype=float), 0, 1)[..., None]
    mixed = linear_to_srgb(weight * srgb_to_linear(cover) + (1 - weight) * srgb_to_linear(body))
    return np.where(weight >= 1, cover, mixed)
