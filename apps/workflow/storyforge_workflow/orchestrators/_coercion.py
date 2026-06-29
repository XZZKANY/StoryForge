from __future__ import annotations


def _positive_int_or_zero(value: object) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def _positive_float_or_zero(value: object) -> float:
    return float(value) if isinstance(value, int | float) and value > 0 else 0.0
