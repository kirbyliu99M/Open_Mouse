"""Pure source-to-catalogue calibration, before carving or smoothing."""


def source_calibration(original_dimensions, axis_permutation, target, cable_trim=None):
    """All inputs are metres; permutation maps output XYZ to source axes."""
    dimensions = [original_dimensions[index] for index in axis_permutation]
    return {
        'uncalibratedDimensionsXYZmm': [value * 1000 for value in dimensions],
        'dimensionCalibrationScale': [goal / value for goal, value in zip(target, dimensions)],
        'cableTrim': cable_trim,
    }
