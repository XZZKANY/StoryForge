from __future__ import annotations

from app.common.llm_http import openai_compatible_headers, optional_float, optional_int
from app.common.version import APP_VERSION


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


def test_headers_carry_self_identifying_user_agent() -> None:
    """出网必须自报 UA：缺省 "Python-urllib/x" 会被 Cloudflare WAF 403（error code 1010）。

    实证（2026-08-01，某 OpenAI 兼容中转站）：缺省 UA 全线 403、任何显式 UA 均 200。
    对 BYO-key 作者表现为「key 有效却全线 403 且不说原因」，故钉成断言。
    """

    for auth_header in ("bearer", "api-key"):
        headers = openai_compatible_headers(credential="k", auth_header=auth_header)
        user_agent = headers.get("User-Agent", "")
        assert user_agent.startswith("StoryForge/"), f"{auth_header} 缺自报 UA：{user_agent!r}"
        assert "urllib" not in user_agent.lower()
        assert APP_VERSION in user_agent, "UA 未跟随 APP_VERSION 单点"
