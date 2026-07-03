from __future__ import annotations

from pathlib import Path

import pytest

from app.domains.agent_runs import deep_consistency
from app.domains.agent_runs.deep_consistency import deep_consistency_review
from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.judge.types import DetectedIssue, SemanticJudgeOutcome

_LLM_ENV = {"STORYFORGE_LLM_API_KEY": "test-key"}


@pytest.fixture()
def bible_project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "人物").mkdir()
    (tmp_path / "设定").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text("林岚举起右臂。\n她走向灯塔。\n", encoding="utf-8")
    (tmp_path / "人物" / "林岚.md").write_text("林岚：语气克制，右臂受伤未愈。\n", encoding="utf-8")
    (tmp_path / "设定" / "世界观.md").write_text("故事发生在灯塔港。\n", encoding="utf-8")
    return tmp_path


def _issue(**overrides: object) -> DetectedIssue:
    values: dict = {
        "category": "setting_conflict",
        "severity": "high",
        "span_start": 2,
        "span_end": 6,
        "summary": "正文与人物设定矛盾：右臂受伤不应能举起。",
        "recommended_repair_mode": "replace_span",
        "expected_text": "右臂受伤",
        "replacement_text": "左臂",
        "matched_text": "举起右臂",
    }
    values.update(overrides)
    return DetectedIssue(**values)


def _capture_judge(monkeypatch: pytest.MonkeyPatch, outcome: SemanticJudgeOutcome) -> dict:
    captured: dict = {}

    def fake_judge(payload, *, provider=None, character_voice_constraints=None, llm_env=None):  # noqa: ANN001
        captured["payload"] = payload
        captured["constraints"] = character_voice_constraints
        captured["llm_env"] = llm_env
        return outcome

    monkeypatch.setattr(deep_consistency, "semantic_judge_with_status", fake_judge)
    return captured


def test_deep_consistency_feeds_bible_and_serializes_issues(
    monkeypatch: pytest.MonkeyPatch, bible_project: Path
) -> None:
    """人物文件进声音约束槽位、设定文件进必含事实，issue 带行号序列化。"""

    captured = _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=[_issue()], failed=False))

    output = deep_consistency_review(
        str(bible_project),
        "正文/第01章.md",
        facts=["地点：灯塔港"],
        llm_env=_LLM_ENV,
    )

    payload = captured["payload"]
    assert "林岚举起右臂" in payload.content
    assert "地点：灯塔港" in payload.required_facts
    assert any("设定/世界观.md" in fact for fact in payload.required_facts)
    constraints = captured["constraints"]
    assert [entry["name"] for entry in constraints] == ["林岚"]
    assert "右臂受伤" in constraints[0]["notes"]
    assert captured["llm_env"] == _LLM_ENV

    assert output["path"] == "正文/第01章.md"
    assert output["issue_count"] == 1
    issue = output["issues"][0]
    assert issue["category"] == "setting_conflict"
    assert issue["severity"] == "high"
    assert issue["line_start"] == 1
    assert issue["matched_text"] == "举起右臂"
    assert {entry["path"] for entry in output["bible_files"]} == {"人物/林岚.md", "设定/世界观.md"}
    assert output["bible_truncated"] is False
    assert "参考信号" in output["note"]


def test_deep_consistency_requires_llm_key(monkeypatch: pytest.MonkeyPatch, bible_project: Path) -> None:
    """未配置 LLM 时显式报错，不伪造「无问题」——口径来自 judge 的 configured 标志，本地不再复制 key 探测。"""

    _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=[], failed=False, configured=False))

    with pytest.raises(FsToolError, match="未配置 LLM"):
        deep_consistency_review(str(bible_project), "正文/第01章.md", llm_env={})


def test_deep_consistency_requires_llm_key_via_real_judge(bible_project: Path) -> None:
    """不打桩走真 judge：空配置源在 judge 内部判未启用，deep_consistency 转成显式报错（无网络调用）。"""

    with pytest.raises(FsToolError, match="未配置 LLM"):
        deep_consistency_review(str(bible_project), "正文/第01章.md", llm_env={})


def test_deep_consistency_converts_spans_to_real_lines(
    monkeypatch: pytest.MonkeyPatch, bible_project: Path
) -> None:
    """真实 span→行号换算：跨行 span 给出正确起止行，越界 span 钳位到末行不崩。"""

    content = "第一行平静。\n第二行开始出事。\n第三行收尾。"
    (bible_project / "正文" / "第02章.md").write_text(content, encoding="utf-8")
    cross_start = content.index("开始出事")
    cross_end = content.index("第三行") + len("第三行")
    issues = [
        _issue(span_start=cross_start, span_end=cross_end, matched_text="开始出事"),
        _issue(span_start=10_000, span_end=20_000, matched_text="原文里不存在"),
    ]
    _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=issues, failed=False))

    output = deep_consistency_review(str(bible_project), "正文/第02章.md", llm_env=_LLM_ENV)

    cross, overflow = output["issues"]
    assert (cross["line_start"], cross["line_end"]) == (2, 3)
    assert (overflow["line_start"], overflow["line_end"]) == (3, 3)


def test_deep_consistency_raises_on_judge_failure(monkeypatch: pytest.MonkeyPatch, bible_project: Path) -> None:
    """远程评审失败不能当成干净通过。"""

    _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=[], failed=True))

    with pytest.raises(FsToolError, match="调用失败"):
        deep_consistency_review(str(bible_project), "正文/第01章.md", llm_env=_LLM_ENV)


def test_deep_consistency_rejects_bad_targets(monkeypatch: pytest.MonkeyPatch, bible_project: Path) -> None:
    _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=[], failed=False))

    with pytest.raises(FsToolError, match="不是文件"):
        deep_consistency_review(str(bible_project), "正文", llm_env=_LLM_ENV)
    with pytest.raises(FsToolError, match="路径越界"):
        deep_consistency_review(str(bible_project), "../外部.md", llm_env=_LLM_ENV)
    (bible_project / "正文" / "空章.md").write_text("", encoding="utf-8")
    with pytest.raises(FsToolError, match="没有可评审的内容"):
        deep_consistency_review(str(bible_project), "正文/空章.md", llm_env=_LLM_ENV)


def test_deep_consistency_explicit_bible_paths(monkeypatch: pytest.MonkeyPatch, bible_project: Path) -> None:
    """显式 bible_paths 优先于默认目录扫描；越界/不存在路径拒绝。"""

    captured = _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=[], failed=False))
    (bible_project / "大纲").mkdir()
    (bible_project / "大纲" / "总纲.md").write_text("三幕结构。\n", encoding="utf-8")

    output = deep_consistency_review(
        str(bible_project),
        "正文/第01章.md",
        bible_paths=["大纲/总纲.md"],
        llm_env=_LLM_ENV,
    )

    assert [entry["path"] for entry in output["bible_files"]] == ["大纲/总纲.md"]
    assert captured["constraints"] is None
    assert any("大纲/总纲.md" in fact for fact in captured["payload"].required_facts)

    with pytest.raises(FsToolError, match="路径越界"):
        deep_consistency_review(
            str(bible_project), "正文/第01章.md", bible_paths=["../密钥.md"], llm_env=_LLM_ENV
        )
    with pytest.raises(FsToolError, match="不是文件"):
        deep_consistency_review(
            str(bible_project), "正文/第01章.md", bible_paths=["人物/不存在.md"], llm_env=_LLM_ENV
        )


def test_deep_consistency_applies_budgets(monkeypatch: pytest.MonkeyPatch, bible_project: Path) -> None:
    """稿件与设定摘录都有预算上限，截断带标记。"""

    captured = _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=[], failed=False))
    (bible_project / "正文" / "长章.md").write_text("章" * 30_000, encoding="utf-8")
    (bible_project / "人物" / "长设定.md").write_text("设" * 5_000, encoding="utf-8")

    output = deep_consistency_review(str(bible_project), "正文/长章.md", llm_env=_LLM_ENV)

    assert output["content_chars"] == 24_000
    assert output["content_truncated"] is True
    assert len(captured["payload"].content) == 24_000
    long_entry = next(entry for entry in output["bible_files"] if entry["path"] == "人物/长设定.md")
    assert long_entry["chars"] == 2_000
    assert long_entry["truncated"] is True


def test_deep_consistency_cleans_and_caps_facts(monkeypatch: pytest.MonkeyPatch, bible_project: Path) -> None:
    captured = _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=[], failed=False))

    output = deep_consistency_review(
        str(bible_project),
        "正文/第01章.md",
        facts=["  地点：灯塔港 ", "地点：灯塔港", ""] + [f"事实{index}" for index in range(50)],
        llm_env=_LLM_ENV,
    )

    user_facts = [fact for fact in captured["payload"].required_facts if not fact.startswith("《")]
    assert user_facts[0] == "地点：灯塔港"
    assert len(user_facts) == 40
    assert output["facts_truncated"] is True


def test_deep_consistency_uses_semantic_input_without_db_fields(
    monkeypatch: pytest.MonkeyPatch, bible_project: Path
) -> None:
    """入参走无 DB 字段的 SemanticJudgeInput，不再伪造 scene_id 哑值。"""

    from app.domains.judge.schemas import SemanticJudgeInput

    captured = _capture_judge(monkeypatch, SemanticJudgeOutcome(issues=[], failed=False))

    deep_consistency_review(str(bible_project), "正文/第01章.md", llm_env=_LLM_ENV)

    payload = captured["payload"]
    assert isinstance(payload, SemanticJudgeInput)
    assert not hasattr(payload, "scene_id")
