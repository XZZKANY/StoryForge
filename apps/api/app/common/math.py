from __future__ import annotations


def safe_ratio(success: int, total: int) -> float:
    """安全比率计算，分母为零时返回 0.0。"""

    if total <= 0:
        return 0.0
    return round(success / total, 4)
