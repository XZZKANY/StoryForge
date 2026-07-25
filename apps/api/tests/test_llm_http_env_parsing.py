from __future__ import annotations

from app.common.llm_http import optional_float, optional_int


def test_optional_int_falls_back_on_malformed_value() -> None:
    """C2-001: 畸形数值 env 回退默认值、不抛 ValueError（否则冒泡成不脱敏 500）。"""

    assert optional_int({"X": "30s"}, "X", 7) == 7
    assert optional_int({"X": "60.0"}, "X", 7) == 7  # 浮点串对 int() 亦属畸形
    assert optional_int({"X": ""}, "X", 7) == 7
    assert optional_int({"X": None}, "X", 7) == 7
    assert optional_int({}, "X", 7) == 7
    assert optional_int({"X": "12"}, "X", 7) == 12  # 合法值不受影响


def test_optional_float_falls_back_on_malformed_value() -> None:
    """C2-001/UF-06 根：optional_float 畸形值回退默认，provider-health 的 always-200 契约不破。"""

    assert optional_float({"X": "30s"}, "X", 300.0) == 300.0
    assert optional_float({"X": "abc"}, "X", 300.0) == 300.0
    assert optional_float({"X": ""}, "X", 300.0) == 300.0
    assert optional_float({"X": "45"}, "X", 300.0) == 45.0  # 合法值不受影响
    assert optional_float({"X": "30.5"}, "X", 300.0) == 30.5
