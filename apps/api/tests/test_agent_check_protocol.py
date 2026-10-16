"""检查结果必须可解析、完整消费并绑定正在检查的正文/brief。"""

from __future__ import annotations

import hashlib
import json

import pytest
from agent_run_test_support import _seed_agent_run
from chapter_check_test_support import chapter_check_reply
from sqlalchemy import select

from app.domains.agent_runs.adapters.chapter_writing_contracts import build_check, check_prompt
from app.domains.agent_runs.event_sink import _AgentRunEventSink
from app.domains.agent_runs.models import AgentArtifact, AgentRunEvent
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.service import handle_agent_control_message
from app.domains.assistant import service as assistant_service

CONTENT = "他推开门，屋里没有人。\r\n她在窗口等他。\n" + "一" * 1200
BRIEF = {
    "brief_id": "brief-check",
    "revision": 2,
    "goal": "GOAL_SENTINEL：交出钥匙",
    "pov": "POV_SENTINEL：第三人称有限视角",
    "setting": "SETTING_SENTINEL：封闭的车站",
    "required_beats": ["BEAT_SENTINEL：见面"],
    "forbidden_items": ["FORBIDDEN_SENTINEL：不能下雨"],
    "continuity_constraints": ["CONTINUITY_SENTINEL：钥匙已碎"],
    "target_chars_min": 1000,
    "target_chars_max": 2000,
}


def _reply(findings, *, content=CONTENT, brief=BRIEF):
    return {
        "protocol_version": 2,
        "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "brief_sha256": hashlib.sha256(
            json.dumps(brief, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
        "findings": findings,
    }


def _hard(**overrides):
    return {
        "rule": "missing_required_beat",
        "severity": "hard",
        "message": "没有交出钥匙",
        "line": 2,
        "evidence": "她在窗口等他。",
        **overrides,
    }


@pytest.mark.parametrize("raw", ["{}", "null", "[]", "not-json", {"findings": None}, {"findings": []}])
def test_invalid_or_unbound_results_block_instead_of_passing(raw):
    result = build_check(CONTENT, BRIEF, raw)
    assert result["status"] == "blocked"
    assert any(item["rule"] == "checker_failure" for item in result["findings"])


@pytest.mark.parametrize(
    "findings",
    [
        None,
        {},
        [None],
        [_hard(rule="unknown")],
        [_hard(severity="HIGH")],
        [_hard(message=9)],
        [_hard(line=True)],
        [_hard(line="2")],
        [_hard(evidence=[])],
        [_hard(message="")],
    ],
)
def test_malformed_findings_do_not_silently_disappear(findings):
    result = build_check(CONTENT, BRIEF, _reply(findings))
    assert result["status"] == "blocked"


def test_valid_empty_array_is_explicitly_bound_to_current_source():
    result = build_check(CONTENT, BRIEF, json.dumps(_reply([])))
    assert result["status"] == "pass"
    assert result["content_sha256"] == _reply([])["content_sha256"]
    assert result["brief_sha256"] == _reply([])["brief_sha256"]
    assert result["protocol_version"] == 2
    assert result["model_finding_count"] == 0


def test_31st_hard_finding_is_not_lost_after_thirty_advisories():
    advisory = {"rule": "advisory", "severity": "advisory", "message": "节奏建议", "line": None, "evidence": None}
    result = build_check(CONTENT, BRIEF, _reply([advisory] * 30 + [_hard()]))
    assert result["status"] == "repairable"
    assert result["hard_failure_count"] == 1
    assert result["advisory_count"] == 30
    assert result["model_finding_count"] == 31


@pytest.mark.parametrize("finding", [_hard(evidence="伪造引文"), _hard(evidence=None)])
def test_ungrounded_hard_results_are_blocked_not_auto_repaired(finding):
    result = build_check(CONTENT, BRIEF, _reply([finding]))
    assert result["status"] == "blocked"
    assert not any(item["rule"] == "missing_required_beat" for item in result["findings"])


@pytest.mark.parametrize("line", [1, 999, None])
def test_quote_with_wrong_or_missing_line_is_located_at_its_real_line(line):
    result = build_check(CONTENT, BRIEF, _reply([_hard(line=line)]))
    assert result["status"] == "repairable"
    finding = result["findings"][0]
    assert finding["evidence_verified"] is True
    assert finding["line_start"] == 2 and finding["line_end"] == 2
    assert CONTENT[finding["char_start"] : finding["char_end"]] == "她在窗口等他。"


def test_quote_folds_full_and_half_width_marks_and_ignores_whitespace():
    content = "守卫喝道：“站住，别动！”\n林舟停下。\n" + "一" * 1200
    evidence = '守卫喝道: "站住,别动!"'
    result = build_check(content, BRIEF, _reply([_hard(line=1, evidence=evidence)], content=content))
    assert result["status"] == "repairable"
    finding = result["findings"][0]
    assert content[finding["char_start"] : finding["char_end"]] == "守卫喝道：“站住，别动！”"
    assert finding["line_start"] == 1 and finding["line_end"] == 1


def test_several_matches_pick_the_one_nearest_the_reported_line():
    # 10-16 真书第 6 章：检查器把全角引号写成直引号，行号报在两处原文之前，整份检查因此作废。
    prompt = "【检测到进化点达到阈值。可激活“随机变异池”。是否激活？】"
    content = "\n".join(["他走进车间。", prompt, "他没有回答。", prompt, "一" * 1200]) + "\n"
    evidence = '【检测到进化点达到阈值。可激活"随机变异池"。是否激活？】'
    for line, expected in ((1, 2), (3, 2), (4, 4), (99, 4), (None, 2)):
        result = build_check(content, BRIEF, _reply([_hard(line=line, evidence=evidence)], content=content))
        finding = result["findings"][0]
        assert result["status"] == "repairable"
        assert finding["line_start"] == expected
        assert content[finding["char_start"] : finding["char_end"]] == prompt


@pytest.mark.parametrize("field", ["content_sha256", "brief_sha256", "protocol_version"])
def test_stale_or_wrong_version_response_cannot_pass(field):
    raw = _reply([])
    raw[field] = 1 if field == "protocol_version" else "0" * 64
    assert build_check(CONTENT, BRIEF, raw)["status"] == "blocked"


def test_exact_multiline_quote_resolves_crlf_and_real_line_range():
    evidence = "他推开门，屋里没有人。\r\n她在窗口等他。"
    result = build_check(CONTENT, BRIEF, _reply([_hard(line=1, evidence=evidence)]))
    assert result["status"] == "repairable"
    finding = result["findings"][0]
    assert finding["evidence"] == evidence
    assert finding["line_start"] == 1 and finding["line_end"] == 2
    assert finding["evidence_verified"] is True
    assert CONTENT[finding["char_start"] : finding["char_end"]] == evidence


def test_evidence_is_verified_before_any_length_reduction():
    result = build_check(CONTENT, BRIEF, _reply([_hard(line=3, evidence="一" * 600 + "不存在")]))
    assert result["status"] == "blocked"


def test_checker_receives_all_confirmed_contract_fields_and_source_identity():
    prompt = check_prompt(BRIEF, CONTENT)
    for value in [
        BRIEF["goal"],
        BRIEF["pov"],
        BRIEF["setting"],
        *BRIEF["required_beats"],
        *BRIEF["forbidden_items"],
        *BRIEF["continuity_constraints"],
        CONTENT,
    ]:
        assert value in prompt
    for field, value in _reply([]).items():
        if field != "findings":
            assert str(value) in prompt


def test_checker_is_not_asked_to_judge_length():
    prompt = check_prompt({**BRIEF, "target_chars_min": 1357, "target_chars_max": 2468}, CONTENT)
    assert "target_chars" not in prompt and "1357" not in prompt and "2468" not in prompt
    assert "篇幅由程序另行核对" in prompt


def _advisory(message):
    return {"rule": "advisory", "severity": "advisory", "message": message, "line": None, "evidence": None}


def test_dialogue_quoted_with_unescaped_straight_quotes_is_still_read():
    # The shape real checkers returned when the draft used straight quotes for dialogue.
    raw = "```json\n" + json.dumps(_reply([_advisory("MSG")]), ensure_ascii=False, indent=2) + "\n```"
    # An escaped quote the checker did get right stays as it is.
    message = '他说\\"走\\"，两条短信（"后天见"和"别忘了"）引入了悬念'
    result = build_check(CONTENT, BRIEF, raw.replace("MSG", message))
    assert result["execution_status"] == "completed"
    assert result["findings"][0]["message"] == '他说"走"，两条短信（"后天见"和"别忘了"）引入了悬念'
    assert result["checker_reply_excerpt"] is None


def test_repaired_quote_in_evidence_is_still_located_verbatim():
    content = '第一章\n\n守卫喝道:"站住。"\n林舟停下。\n'
    brief = {**BRIEF, "target_chars_min": 10, "target_chars_max": 400}
    hard = _hard(line=3, evidence="EVIDENCE")
    raw = json.dumps(_reply([hard], content=content, brief=brief), ensure_ascii=False)
    result = build_check(content, brief, raw.replace("EVIDENCE", '守卫喝道:"站住。"'))
    assert result["execution_status"] == "completed"
    assert result["findings"][0]["evidence"] == '守卫喝道:"站住。"'
    assert result["findings"][0]["evidence_verified"] is True
    forged = build_check(content, brief, raw.replace("EVIDENCE", '守卫喝道:"别动。"'))
    assert forged["execution_status"] == "failed"


@pytest.mark.parametrize(
    "raw",
    [
        # A stray quote right before a comma reads as the end of the string: still invalid, never guessed.
        json.dumps(_reply([_advisory("MSG")]), ensure_ascii=False).replace("MSG", '"好",她说'),
        # The repair cannot hide a duplicate key.
        json.dumps(_reply([]), ensure_ascii=False)[:-1].replace('"findings"', '"note": "说"好"", "findings"')
        + ', "findings": []}',
    ],
)
def test_quote_repair_does_not_admit_what_it_cannot_read(raw):
    result = build_check(CONTENT, BRIEF, raw)
    assert result["execution_status"] == "failed"
    assert result["checker_reply_excerpt"] == raw


def test_failed_result_keeps_a_bounded_excerpt_of_the_reply():
    raw = "检查完毕" + "长" * 3000
    assert build_check(CONTENT, BRIEF, raw)["checker_reply_excerpt"] == raw[:2000]
    assert build_check(CONTENT, BRIEF, None, provider_failed=True)["checker_reply_excerpt"] is None
    assert build_check(CONTENT, BRIEF, json.dumps(_reply([])))["checker_reply_excerpt"] is None


def test_large_result_cannot_hide_late_hard_failure_behind_budget():
    advisory = {"rule": "advisory", "severity": "advisory", "message": "建议", "line": None, "evidence": None}
    result = build_check(CONTENT, BRIEF, _reply([advisory] * 1000 + [_hard()]))
    assert result["status"] == "blocked"


@pytest.mark.parametrize("findings,expected", [([], "pass"), ([_hard()], "fail")])
def test_execution_completion_is_independent_of_manuscript_judgment(findings, expected):
    result = build_check(CONTENT, BRIEF, _reply(findings))
    assert result["execution_status"] == "completed"
    assert result["manuscript_status"] == expected
    assert result["manuscript_hard_failure_count"] == len(findings)
    assert result["coverage"] == {
        "supplied_content_chars": len(CONTENT),
        "source_verified": True,
        "findings_received": len(findings),
        "findings_validated": len(findings),
        "findings_limit": 100,
        "result_complete": True,
    }


def test_finding_limit_is_inclusive_and_local_failure_remains_explicit_when_checker_fails():
    valid = build_check(CONTENT, BRIEF, _reply([_hard()] * 100))
    assert valid["execution_status"] == "completed"
    assert valid["coverage"]["findings_validated"] == 100
    invalid = build_check("", BRIEF, "{}")
    assert invalid["execution_status"] == "failed"
    assert invalid["manuscript_status"] == "fail"
    assert invalid["manuscript_hard_failure_count"] == 2
    assert invalid["hard_failure_count"] == 3  # Legacy gate also includes checker_failure.


def test_nested_duplicate_finding_fields_cannot_hide_invalid_evidence():
    raw = json.dumps(_reply([_hard()]), ensure_ascii=False)
    raw = raw.replace('"evidence": "她在窗口等他。"', '"evidence": "伪造", "evidence": "她在窗口等他。"')
    assert build_check(CONTENT, BRIEF, raw)["execution_status"] == "failed"


@pytest.mark.parametrize("failure", ["invalid", "over-limit", "raw-budget", "duplicate", "nonfinite", "late-invalid"])
def test_failed_or_incomplete_checker_cannot_claim_manuscript_failure(failure):
    raw = _reply([])
    if failure == "invalid":
        raw = "{}"
    elif failure == "over-limit":
        raw = _reply([_hard()] * 101)
    elif failure == "raw-budget":
        raw = json.dumps(raw) + " " * 256_000
    elif failure == "duplicate":
        raw = json.dumps(_reply([_hard()]))[:-1] + ',"findings":[]}'
    elif failure == "nonfinite":
        raw = json.dumps(raw)[:-1] + ',"extra":NaN}'
    elif failure == "late-invalid":
        raw = _reply([_hard(), _hard(evidence="伪造引文")])
    result = build_check(CONTENT, BRIEF, raw)
    assert result["status"] == "blocked"
    assert result["execution_status"] == ("incomplete" if failure in {"over-limit", "raw-budget"} else "failed")
    assert result["manuscript_status"] == "unknown"
    assert result["manuscript_hard_failure_count"] == 0
    assert result["coverage"]["result_complete"] is False
    assert result["coverage"]["findings_validated"] == 0
    assert result["coverage"]["source_verified"] is (failure in {"over-limit", "late-invalid"})


@pytest.mark.parametrize(
    "failure",
    [
        "valid-empty",
        "invalid-empty",
        "fake-quote",
        "stale-source",
        "hard-at-31",
        "duplicate",
        "over-limit",
        "provider",
        "recovers-on-recheck",
    ],
)
def test_actual_confirmed_chapter_pipeline_rechecks_once_and_offers_unchecked_draft_for_confirmation(
    session,
    tmp_path,
    monkeypatch,
    failure,
):
    target = tmp_path / "正文/第001章.md"
    target.parent.mkdir()
    target.write_text("", encoding="utf-8")
    prompts = []
    draft = "他推开门，屋里没有人。\n她在窗口等他。\n" + "一" * 1780
    checks = 0
    repairs = 0
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])

    def chat_provider(_source, *, system_prompt, user_prompt):
        nonlocal checks
        prompts.append(user_prompt)
        if "整理成 Chapter Brief" in user_prompt:
            result = json.dumps(
                {k: v for k, v in BRIEF.items() if k not in {"brief_id", "revision"}}, ensure_ascii=False
            )
        else:
            checks += 1
            if failure == "provider":
                raise assistant_service.AssistantReviseError("synthetic provider unavailable")
            assert draft in user_prompt
            for key in ("goal", "pov", "setting", "required_beats", "forbidden_items", "continuity_constraints"):
                assert str(BRIEF[key][0] if isinstance(BRIEF[key], list) else BRIEF[key]) in user_prompt
            findings = []
            if failure == "recovers-on-recheck" and checks == 1:
                return {"content": "{}", "completion_tokens": 5, "latency_ms": 1}
            if failure == "hard-at-31":
                advisory = {
                    "rule": "advisory",
                    "severity": "advisory",
                    "message": "建议",
                    "line": None,
                    "evidence": None,
                }
                findings = [advisory] * 30 + [_hard()]
            elif failure == "fake-quote":
                findings = [_hard(line=999, evidence="不在正文的引文")]
            elif failure == "over-limit":
                findings = [_hard()] * 101
            result = chapter_check_reply(user_prompt, findings)["reply"]
            if failure == "invalid-empty":
                result = "{}"
            elif failure == "stale-source":
                payload = json.loads(result)
                payload["content_sha256"] = "0" * 64
                result = json.dumps(payload)
            elif failure == "duplicate":
                result = chapter_check_reply(user_prompt, [_hard()])["reply"][:-1] + ',"findings":[]}'
        return {"content": result, "completion_tokens": 5, "latency_ms": 1}

    def text_provider(_source, *, system_prompt, user_prompt):
        nonlocal repairs
        if "修复以下硬失败" in user_prompt:
            repairs += 1
        return {"content": draft, "completion_tokens": 10, "latency_ms": 1}

    monkeypatch.setattr(assistant_service, "_call_llm", chat_provider)
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", text_provider)
    run = _seed_agent_run(session, public_id=f"run-check-protocol-{failure}")
    # Auto profile: a checked draft lands without a click, an unchecked one never does.
    run.permission_profile = "auto"
    session.commit()
    initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第一章",
            "args": {
                "project_path": str(tmp_path),
                "file_path": str(target),
                "context_bundle": {"files": []},
            },
        },
    )
    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"chapter_brief": initial["agent_result"]["chapter_brief"]},
    )
    result = control.resumed_result
    assert result is not None
    checked = failure in {"valid-empty", "recovers-on-recheck"}
    unchecked = failure not in {"valid-empty", "recovers-on-recheck", "hard-at-31"}
    if failure == "hard-at-31":
        assert result.get("proposed_patch") is None
        assert result["agent_result"]["chapter_check"]["status"] == "repairable"
    else:
        assert result["proposed_patch"]["after"] == draft
        assert result["proposed_patch"]["requires_confirmation"] is unchecked
        assert result["agent_result"]["requires_user_confirmation"] is unchecked
        assert result["agent_result"]["chapter_check"]["status"] == ("pass" if checked else "blocked")
        assert ("未经检查" in result["agent_result"]["summary"]) is unchecked
    assert checks == (1 if failure == "valid-empty" else 2)
    assert repairs == (1 if failure == "hard-at-31" else 0)
    assert result["agent_result"]["repair_count"] == repairs
    check = result["agent_result"]["chapter_check"]
    expected_execution = (
        "completed"
        if failure in {"valid-empty", "hard-at-31", "recovers-on-recheck"}
        else "incomplete"
        if failure == "over-limit"
        else "failed"
    )
    assert check["execution_status"] == expected_execution
    assert check["manuscript_status"] == ("pass" if checked else "fail" if failure == "hard-at-31" else "unknown")
    check_traces = [trace for trace in result["tool_trace"] if trace["tool_name"] == "chapter.check"]
    assert [trace["input_summary"]["recheck"] for trace in check_traces] == (
        [False] if failure == "valid-empty" else [False, False] if failure == "hard-at-31" else [False, True]
    )
    assert check_traces[-1]["status"] == ("completed" if expected_execution == "completed" else "failed")
    assert check_traces[-1]["output_summary"]["execution_status"] == expected_execution
    assert check_traces[-1]["output_summary"]["coverage"] == check["coverage"]
    saved_check = session.scalars(
        select(AgentArtifact).where(AgentArtifact.run_id == run.id, AgentArtifact.kind == "chapter_check")
    ).one()
    assert saved_check.payload["recheck_count"] == (0 if failure in {"valid-empty", "hard-at-31"} else 1)
    persisted_traces = session.scalars(
        select(AgentRunEvent).where(
            AgentRunEvent.run_id == run.id,
            AgentRunEvent.event_type == "tool_trace",
        )
    ).all()
    assert [
        event.payload["trace"] for event in persisted_traces if event.payload["trace"]["tool_name"] == "chapter.check"
    ] == check_traces
    candidates = session.scalars(
        select(AgentArtifact).where(
            AgentArtifact.run_id == run.id,
            AgentArtifact.kind == "chapter_candidate",
        )
    ).all()
    if failure != "hard-at-31":
        assert not candidates
    else:
        candidate = result["agent_result"]["chapter_candidate"]
        assert candidate["content"] == draft
        assert candidate["content_sha256"] == check["content_sha256"]
        assert candidate["brief_sha256"] == check["brief_sha256"]
        assert candidate["read_only"] is True
        assert "approval_action" not in candidate and "after" not in candidate
        assert len(candidates) == 1 and candidates[0].payload == candidate
        assert candidates[0].requires_confirmation is False
        assert "候选稿" in result["agent_result"]["summary"]
    assert len(prompts) == checks + 1
    assert target.read_text(encoding="utf-8") == ""


def test_brief_seed_takes_its_default_length_from_the_books_recent_chapters(session, tmp_path, monkeypatch):
    for name, text in (("第001章.md", "甲" * 900), ("第002章.md", "乙" * 1200), ("第003章.md", "")):
        path = tmp_path / "正文" / name
        path.parent.mkdir(exist_ok=True)
        path.write_text(text, encoding="utf-8")
    prompts = []
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])

    def chat_provider(_source, *, system_prompt, user_prompt):
        prompts.append(user_prompt)
        unsized = {k: v for k, v in BRIEF.items() if not k.startswith("target_chars") and k not in {"brief_id", "revision"}}
        return {"content": json.dumps(unsized, ensure_ascii=False), "completion_tokens": 5, "latency_ms": 1}

    monkeypatch.setattr(assistant_service, "_call_llm", chat_provider)
    run = _seed_agent_run(session, public_id="run-brief-seed-from-book")
    initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第三章",
            "args": {
                "project_path": str(tmp_path),
                "file_path": str(tmp_path / "正文/第003章.md"),
                "context_bundle": {"files": []},
            },
        },
    )
    brief = initial["agent_result"]["chapter_brief"]
    # 模型没给字数：按本书最近两章（900、1200 字）的中位数取低位 900，下浮两成 700、上浮两成 1100。
    assert (brief["target_chars_min"], brief["target_chars_max"]) == (700, 1100)
    assert '"target_chars_min": 700, "target_chars_max": 1100' in prompts[0]
