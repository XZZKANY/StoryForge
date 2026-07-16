"""project.prose_check 文笔气味静态检查：确定性、无 LLM、无 key 可验。

覆盖坏味道检测（套话 / 说明腔 / 情绪直述 / 四类段落套路）、path-scoped 只读边界、空文件显式报错、
结果结构，以及从 workflow 抢救来的 check_prose_static_quality 纯函数关键分支。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.prose_scan import check_prose_static_quality, prose_static_scan


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    return tmp_path


def _write(project: Path, name: str, content: str) -> str:
    (project / "正文" / name).write_text(content, encoding="utf-8")
    return f"正文/{name}"


# --- 1. 坏味道检测 ---


def test_detects_cliches(project: Path) -> None:
    rel = _write(project, "第01章.md", "他不禁停下脚步，心中五味杂陈。")
    result = prose_static_scan(str(project), rel)

    assert result["issue_count"] == 1
    assert result["dimension_counts"] == {"套话": 1}
    issue = result["issues"][0]
    assert issue["dimension"] == "套话"
    assert issue["severity"] == "中"  # 命中 ≥2 条陈词
    assert "不禁" in issue["snippet"] and "五味杂陈" in issue["snippet"]


def test_detects_telling_and_emotion(project: Path) -> None:
    rel = _write(project, "第01章.md", "林岚非常害怕。她感到十分绝望。")
    result = prose_static_scan(str(project), rel)

    dims = result["dimension_counts"]
    assert dims.get("说明腔") == 1  # 「非常害怕」直述情绪
    assert dims.get("情绪直述") == 1  # 害怕 + 绝望 两个抽象情绪词


def test_clean_action_prose_has_no_prose_smell(project: Path) -> None:
    rel = _write(project, "第01章.md", "他推开门，握紧刀，转身，看向巷口，又停下。")
    result = prose_static_scan(str(project), rel)

    # 动作密集、无陈词 / 情绪直述 / 超长句：应无坏味道信号。
    assert result["issue_count"] == 0
    assert result["issues"] == []


def test_mechanical_transition_flags_repeated_paragraph_starters() -> None:
    prose = "\n".join(
        [
            "与此同时，顾迟越过断桥。",
            "另一边，沈禾推开仓门。",
            "镜头一转，巡夜人已经抵达钟楼。",
            "雨水顺着铁门流进排水沟。",
            "顾迟把绳结重新勒紧。",
            "沈禾听见楼上传来脚步。",
            "巡夜人吹灭最后一盏灯。",
            "远处的汽笛压过了雷声。",
        ]
    )

    dimensions = {issue.dimension for issue in check_prose_static_quality(prose)}

    assert "mechanical_transition" in dimensions


def test_mechanical_transition_allows_two_hits_at_quarter_density() -> None:
    prose = "\n".join(
        [
            "与此同时，顾迟越过断桥。",
            "另一边，沈禾推开仓门。",
            "雨水顺着铁门流进排水沟。",
            "顾迟把绳结重新勒紧。",
            "沈禾听见楼上传来脚步。",
            "巡夜人吹灭最后一盏灯。",
            "远处的汽笛压过了雷声。",
            "旧钟在风里轻轻摆动。",
        ]
    )

    dimensions = {issue.dimension for issue in check_prose_static_quality(prose)}

    assert "mechanical_transition" not in dimensions


def test_formulaic_question_flags_high_frequency_narrative_questions() -> None:
    prose = "\n".join(
        [
            "他真的能在天亮前回来吗？",
            "难道门后的脚步一直属于同一个人？",
            "谁也没想到，井底还藏着第二扇门。",
            "沈禾按住摇晃的井绳，示意众人后退。",
        ]
    )

    dimensions = {issue.dimension for issue in check_prose_static_quality(prose)}

    assert "formulaic_question" in dimensions


def test_formulaic_question_allows_dialogue_and_low_frequency_questions() -> None:
    dialogue = "\n".join(["“你要去吗？”", "“难道现在就走？”", "“到底是谁呢？”"])
    diluted = "\n".join(
        [
            "他真的能在天亮前回来吗？",
            "难道门后的脚步一直属于同一个人？",
            "谁也没想到，井底还藏着第二扇门。",
            "石墙" * 800,
        ]
    )

    dialogue_dimensions = {issue.dimension for issue in check_prose_static_quality(dialogue)}
    diluted_dimensions = {issue.dimension for issue in check_prose_static_quality(diluted)}

    assert "formulaic_question" not in dialogue_dimensions
    assert "formulaic_question" not in diluted_dimensions


def test_binary_contrast_flags_repeated_dual_structures() -> None:
    prose = "\n".join(
        [
            "这不是退让，而是换一条路逼近塔顶。",
            "与其说他在等待，不如说他在计算守卫换岗。",
            "表面上仓库已经废弃，实际上地下炉火从未熄灭。",
        ]
    )

    dimensions = {issue.dimension for issue in check_prose_static_quality(prose)}

    assert "binary_contrast" in dimensions


def test_binary_contrast_allows_two_hits_and_sentence_boundaries() -> None:
    prose = "\n".join(
        [
            "这不是退让，而是换一条路逼近塔顶。",
            "与其说他在等待，不如说他在计算守卫换岗。",
            "这不是谎言。守卫沉默，而事实是门锁已经换过。",
        ]
    )

    dimensions = {issue.dimension for issue in check_prose_static_quality(prose)}

    assert "binary_contrast" not in dimensions


@pytest.mark.parametrize(
    "ending",
    [
        "雨停了，一切才刚刚开始。",
        "钟楼再次响起，命运的齿轮已经转动。",
        "他们离开广场，这一切都将改变未来。",
    ],
)
def test_hollow_summary_flags_abstract_paragraph_endings(ending: str) -> None:
    dimensions = {issue.dimension for issue in check_prose_static_quality(ending)}

    assert "hollow_summary" in dimensions


def test_hollow_summary_allows_mid_paragraph_terms_and_dialogue() -> None:
    prose = "\n".join(
        [
            "他提到命运的齿轮，随后拆开怀表，把断裂的铜轴放在桌上。",
            "“一切才刚刚开始。”",
        ]
    )

    dimensions = {issue.dimension for issue in check_prose_static_quality(prose)}

    assert "hollow_summary" not in dimensions


def test_prose_scan_rolls_up_all_four_paragraph_pattern_dimensions(project: Path) -> None:
    prose = "\n".join(
        [
            "与此同时，顾迟越过断桥。",
            "另一边，沈禾推开仓门。",
            "镜头一转，巡夜人抵达钟楼。",
            "他真的能在天亮前回来吗？",
            "难道门后的脚步属于同一个人？",
            "谁也没想到，井底还藏着第二扇门。",
            "这不是退让，而是换路逼近塔顶。",
            "与其说他在等待，不如说他在计算换岗。",
            "表面上仓库废弃，实际上地下炉火未熄。",
            "雨停了，一切才刚刚开始。",
        ]
    )
    rel = _write(project, "第02章.md", prose)

    result = prose_static_scan(str(project), rel)

    assert {
        "mechanical_transition",
        "formulaic_question",
        "binary_contrast",
        "hollow_summary",
    } <= set(result["dimension_counts"])


# --- 2. path-scoped 只读边界 ---


def test_path_escape_is_rejected(project: Path) -> None:
    (project.parent / "outside.md").write_text("不禁五味杂陈", encoding="utf-8")
    with pytest.raises(FsToolError):
        prose_static_scan(str(project), "../outside.md")


def test_missing_file_is_rejected(project: Path) -> None:
    with pytest.raises(FsToolError):
        prose_static_scan(str(project), "正文/不存在.md")


def test_empty_file_is_rejected(project: Path) -> None:
    rel = _write(project, "空.md", "   \n\n  ")
    with pytest.raises(FsToolError):
        prose_static_scan(str(project), rel)


# --- 3. 结果结构与预算 ---


def test_result_shape_and_rollups(project: Path) -> None:
    rel = _write(project, "第01章.md", "他不禁停下，心中五味杂陈。")
    result = prose_static_scan(str(project), rel)

    assert result["path"] == "正文/第01章.md"
    assert set(result) >= {
        "path",
        "content_chars",
        "content_truncated",
        "issue_count",
        "issues",
        "dimension_counts",
        "severity_counts",
        "note",
    }
    assert result["content_truncated"] is False
    for issue in result["issues"]:
        assert set(issue) == {
            "dimension",
            "severity",
            "snippet",
            "message",
            "suggestion",
            "revision_strategy",
        }
    assert sum(result["dimension_counts"].values()) == result["issue_count"]
    assert sum(result["severity_counts"].values()) == result["issue_count"]


def test_content_budget_truncates(project: Path) -> None:
    rel = _write(project, "长.md", "啊" * 25_000)
    result = prose_static_scan(str(project), rel)

    assert result["content_truncated"] is True
    assert result["content_chars"] == 24_000


# --- 4. 抢救来的纯函数关键分支（补 slice-1 工具入口不触达的约束维度） ---


def test_check_prose_static_quality_empty_returns_completeness_issue() -> None:
    issues = check_prose_static_quality("")
    assert len(issues) == 1
    assert issues[0].dimension == "正文完整性"
    assert issues[0].severity == "严重"


def test_character_forbidden_trait_flags_ooc() -> None:
    issues = check_prose_static_quality(
        "他突然放声大笑，语气轻佻。",
        character_constraints=[{"forbidden_traits": ["轻佻"]}],
    )
    assert any(issue.dimension == "角色一致性" and issue.severity == "严重" for issue in issues)
