from __future__ import annotations

from scripts import ai_sdk_real_smoke


def test_real_smoke_requires_explicit_opt_in_without_exposing_configured_key(
    monkeypatch, capsys
) -> None:
    secret = "smoke-secret-value"
    monkeypatch.delenv("STORYFORGE_AI_SDK_REAL_SMOKE", raising=False)
    monkeypatch.setenv("STORYFORGE_AI_SDK_SMOKE_API_KEY", secret)

    assert ai_sdk_real_smoke.main() == 0

    output = capsys.readouterr().out
    assert '"status": "skipped"' in output
    assert secret not in output
