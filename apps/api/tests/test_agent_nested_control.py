from __future__ import annotations

import io
import json
import threading

import pytest

from app.common import llm_client
from app.common.llm_control import LLMRunControl, LLMRunInterrupted, llm_run_control
from app.domains.ide.review_reasoning import LlmReviewReasoner
from app.domains.judge.schemas import SemanticJudgeInput
from app.domains.judge.semantic import semantic_judge_with_status

ENV = {"STORYFORGE_LLM_MODEL": "fixture", "STORYFORGE_LLM_PROVIDER": "openai",
       "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1", "STORYFORGE_LLM_API_KEY": "fixture-key"}


def test_scoped_review_keeps_control_on_owning_thread_and_stops_next_role(monkeypatch):
    owner = threading.get_ident()
    calls = []
    stopped = False

    def check(boundary):
        assert threading.get_ident() == owner, "run DB callback must stay on its owning thread"
        return "stopped" if stopped else None

    def urlopen(request, *, timeout):
        nonlocal stopped
        calls.append(threading.get_ident())
        stopped = True
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": "[]"}, "finish_reason": "stop"}],
                                     "usage": {"prompt_tokens": 4, "completion_tokens": 2}}).encode())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    with llm_run_control(LLMRunControl(check)), pytest.raises(LLMRunInterrupted) as raised:
        LlmReviewReasoner(ENV).review_all(content="正文", paragraphs=["正文"], context_bundle=None)
    assert raised.value.reason == "stopped"
    assert calls == [owner]


def test_semantic_judge_does_not_turn_run_cancellation_into_provider_failure(monkeypatch):
    for name in ("API_KEY", "BASE_URL", "MODEL", "TIMEOUT_SECONDS", "REASONING_EFFORT"):
        monkeypatch.delenv(f"STORYFORGE_JUDGE_LLM_{name}", raising=False)
    calls = []

    def unexpected(*args, **kwargs):
        calls.append(True)
        raise AssertionError("cancelled judge must not contact provider")

    monkeypatch.setattr(llm_client.request, "urlopen", unexpected)
    with llm_run_control(LLMRunControl(lambda boundary: "stopped")), pytest.raises(LLMRunInterrupted):
        semantic_judge_with_status(SemanticJudgeInput(content="正文"), llm_env=ENV)
    assert not calls


def test_unscoped_review_retains_parallel_roles(monkeypatch):
    owner = threading.get_ident()
    barrier = threading.Barrier(3)
    calls = []

    def urlopen(request, *, timeout):
        calls.append(threading.get_ident())
        barrier.wait(timeout=3)
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": "[]"}, "finish_reason": "stop"}]}).encode())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    results = LlmReviewReasoner(ENV).review_all(content="正文", paragraphs=["正文"], context_bundle=None)
    assert len(results) == 3 and all(item.mode == "llm" for item in results)
    assert len(set(calls)) == 3 and owner not in calls
