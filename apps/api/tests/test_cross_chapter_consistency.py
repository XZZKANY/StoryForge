import pytest

from app.domains.ide import cross_chapter_consistency as ccc


def test_requires_at_least_two_chapters_with_content():
    with pytest.raises(ValueError):
        ccc.check_cross_chapter_consistency({}, [{"name": "第1章", "content": "沈砚"}])
    with pytest.raises(ValueError):
        ccc.check_cross_chapter_consistency({}, [{"name": "第1章", "content": "x"}, {"name": "第2章", "content": "  "}])


def test_build_user_prompt_includes_full_chapters_and_focus():
    prompt = ccc._build_user_prompt(
        [{"name": "第1章", "content": "沈砚在苍岭城调查"}, {"name": "第2章", "content": "沈岩走出县衙"}],
        focus="主角称谓是否一致",
    )
    assert "第1章" in prompt and "第2章" in prompt
    assert "沈砚" in prompt and "沈岩" in prompt
    assert "主角称谓是否一致" in prompt
    assert prompt.count("<<<") == 2  # 每章一个完整分块,非摘录


def test_parse_findings_tolerates_code_fence_and_normalizes():
    raw = (
        "```json\n"
        '[{"type":"naming","severity":"HIGH","chapters":["第1章","第2章"],"finding":"名字不一致","evidence":"沈砚/沈岩"},'
        '{"type":"weird","severity":"x","finding":"f"}]\n'
        "```"
    )
    out = ccc._parse_findings(raw)
    assert out[0]["type"] == "naming" and out[0]["severity"] == "high"
    assert out[0]["chapters"] == ["第1章", "第2章"]
    assert out[1]["type"] == "other" and out[1]["severity"] == "medium"  # 非法值归一化


def test_check_calls_llm_with_both_chapters(monkeypatch):
    captured = {}

    def fake_call_llm(source, *, system_prompt, user_prompt):
        captured["user"] = user_prompt
        return {
            "content": '[{"type":"setting","severity":"high","chapters":["第1章","第3章"],"finding":"位置矛盾","evidence":"东南角/城北角"}]',
            "latency_ms": 12,
        }

    monkeypatch.setattr(ccc, "_call_llm", fake_call_llm)
    res = ccc.check_cross_chapter_consistency(
        {"STORYFORGE_LLM_MODEL": "deepseek-v4-pro"},
        [{"name": "第1章", "content": "旧水门在东南角"}, {"name": "第3章", "content": "旧水门在城北角"}],
        focus="设定一致性",
    )
    assert res["findings"][0]["type"] == "setting"
    assert res["model"] == "deepseek-v4-pro"
    assert "第1章" in captured["user"] and "第3章" in captured["user"]
