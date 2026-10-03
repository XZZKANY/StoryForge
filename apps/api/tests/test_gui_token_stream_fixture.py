from __future__ import annotations

import json

import pytest
from gui_lifecycle_backend import wait_token_stream

from app.common.llm_control import LLMRunControl, LLMRunInterrupted, llm_run_control


def test_token_barrier_is_bounded_and_only_observes(tmp_path):
    with pytest.raises(TimeoutError, match="gui_fixture_token_timeout"):
        wait_token_stream(tmp_path, "initial", 1, timeout=0)
    assert json.loads((tmp_path / "token-stream-initial-1-entered.json").read_text()) == {
        "stage": "initial", "provider_call": 1,
    }
    assert list(tmp_path.iterdir()) == [tmp_path / "token-stream-initial-1-entered.json"]
    (tmp_path / "token-stream-initial-1-release").touch()
    wait_token_stream(tmp_path, "initial", 1, timeout=0)


def test_token_barrier_preserves_cooperative_stop(tmp_path):
    with llm_run_control(LLMRunControl(check_interruption=lambda boundary: "stopped")), pytest.raises(LLMRunInterrupted):
        wait_token_stream(tmp_path, "final", 2)
    assert not (tmp_path / "token-stream-final-2-release").exists()

@pytest.mark.parametrize(("stage", "call"), [("../outside", 1), ("final", 0)])
def test_token_barrier_rejects_invalid_identity(tmp_path, stage, call):
    with pytest.raises(ValueError, match="gui_fixture_token_identity_invalid"):
        wait_token_stream(tmp_path, stage, call, timeout=0)
    assert not list(tmp_path.iterdir())
