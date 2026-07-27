"""文风指纹从本地正文复活：量得准才说，量不准就闭嘴。

背景（2026-07-28 诊断）：「事后检出漂移 → 生成前对齐」的前馈闭环早已建成，却锚在
`Chapter.status == "approved"` 这个桌面产品从不创建的 BookRun 实体上，整个搁浅在退役的
批量管线后面。本刀把同一组特征改从本地手稿算出来。

这个能力最容易做坏的方式不是不生效，而是**用两章语料算个平均数就当测量值喂给模型**——
模型会照做，等于用噪声规训作者的文风。故本文件的红线主要不是「有没有注入」，而是
「样本说不准时有没有闭嘴」。
"""

from __future__ import annotations

from pathlib import Path

from app.common.author_voice import build_generation_system_prompt
from app.common.style_baseline import (
    MIN_CHUNK_CHARS,
    MIN_CHUNKS,
    RECENT_FILES,
    build_style_baseline,
    style_baseline_clause,
)
from app.common.style_fingerprint import style_fingerprint


def _write_chapter(root: Path, name: str, *, sentence: str, repeat: int) -> None:
    target = root / "正文" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(sentence * repeat, encoding="utf-8")


def _uniform_project(tmp_path: Path, *, files: int = 5) -> Path:
    """句长高度一致的语料：块间方差近零，置信区间必然收紧。"""

    for index in range(files):
        _write_chapter(tmp_path, f"第{index + 1:03d}章.md", sentence="他把灯芯捻短了一寸。", repeat=60)
    return tmp_path


def test_uniform_corpus_yields_a_sentence_length_target(tmp_path: Path) -> None:
    baseline = build_style_baseline(str(_uniform_project(tmp_path)))
    assert baseline is not None
    assert baseline.file_count == 5
    assert baseline.average_sentence_length is not None
    assert baseline.average_sentence_length.value == 9.0, "「他把灯芯捻短了一寸」= 9 字，句号是分隔符不计入"


def test_zero_dialogue_never_becomes_a_target(tmp_path: Path) -> None:
    """测得 0 对白不是「这位作者不写对白」，是口径不匹配——照喂等于命令生成器别写对白。

    `dialogue_ratio` 只数「」，弯引号“”是 judge 侧刻意排除的（已记为决定）。用“”的手稿
    会稳稳测出 0.00 且半宽为 0，恰好穿过纯精度闸。删掉零值守卫即红。
    """

    for index in range(4):
        _write_chapter(
            tmp_path,
            f"第{index + 1:03d}章.md",
            sentence="他说“灯该换了”，随后把窗关上。",
            repeat=40,
        )
    baseline = build_style_baseline(str(tmp_path))
    assert baseline is not None
    assert baseline.dialogue_ratio is None


def test_corner_bracket_dialogue_does_become_a_target(tmp_path: Path) -> None:
    """反面对照：确实用「」的手稿，对白密度该量出来并注入。"""

    for index in range(4):
        _write_chapter(
            tmp_path,
            f"第{index + 1:03d}章.md",
            sentence="他说「灯该换了」，随后把窗关上。",
            repeat=40,
        )
    baseline = build_style_baseline(str(tmp_path))
    assert baseline is not None
    assert baseline.dialogue_ratio is not None
    assert baseline.dialogue_ratio.value > 0


def test_too_few_files_yields_nothing(tmp_path: Path) -> None:
    """块数不够估方差就整体沉默，绝不用一两章伪造成测量值。"""

    for index in range(MIN_CHUNKS - 1):
        _write_chapter(tmp_path, f"第{index + 1:03d}章.md", sentence="他把灯芯捻短了一寸。", repeat=60)
    assert build_style_baseline(str(tmp_path)) is None


def test_wildly_varying_corpus_suppresses_the_target(tmp_path: Path) -> None:
    """这是本刀的核心红线：句长逐章剧烈起伏时，均值不可信，必须不注入。

    改成「算个平均数直接喂」即红——那时这里会拿到一个目标值。
    """

    lengths = [("短。", 200), ("这是一句被刻意拉得很长很长的句子用来把平均句长推到完全不同的量级上去。", 30), ("中等长度的句子在这里。", 80)]
    for index, (sentence, repeat) in enumerate(lengths):
        _write_chapter(tmp_path, f"第{index + 1:03d}章.md", sentence=sentence, repeat=repeat)
    baseline = build_style_baseline(str(tmp_path))
    assert baseline is None or baseline.average_sentence_length is None, (
        "章间句长方差极大时仍给出目标 = 把噪声当测量值喂给模型"
    )


def test_short_files_are_not_counted_as_chunks(tmp_path: Path) -> None:
    """便签级短文件不算语料块，否则一堆待办清单会污染文风基线。"""

    for index in range(5):
        _write_chapter(tmp_path, f"第{index + 1:03d}章.md", sentence="短句。", repeat=3)
    assert build_style_baseline(str(tmp_path)) is None


def test_dot_directories_are_excluded(tmp_path: Path) -> None:
    """`.storyforge` 下的派生缓存与作者指令不是正文，绝不能算进基线（否则自我污染）。"""

    _uniform_project(tmp_path, files=3)
    noise = tmp_path / ".storyforge" / "canon"
    noise.mkdir(parents=True)
    (noise / "dossier.md").write_text("设定档" * 500, encoding="utf-8")
    baseline = build_style_baseline(str(tmp_path))
    assert baseline is not None
    assert baseline.file_count == 3, "dot 目录下的文件被算进了语料"


def test_only_recent_files_are_measured(tmp_path: Path) -> None:
    """只取最近 N 个正文：文风还在成形时，近作比首章更代表现在的作者。"""

    _uniform_project(tmp_path, files=RECENT_FILES + 4)
    baseline = build_style_baseline(str(tmp_path))
    assert baseline is not None
    assert baseline.file_count == RECENT_FILES


def test_absent_or_missing_project_yields_nothing(tmp_path: Path) -> None:
    for project_path in (None, "", "   ", "/nonexistent/path/does/not/exist", str(tmp_path)):
        assert build_style_baseline(project_path) is None


def test_clause_marks_itself_as_target_not_rule(tmp_path: Path) -> None:
    """措辞必须是对齐目标且让位于作者显式要求——它是统计量，不是作者的主张。"""

    baseline = build_style_baseline(str(_uniform_project(tmp_path)))
    assert baseline is not None
    clause = style_baseline_clause(baseline)
    assert "不是硬规则" in clause
    assert "以作者为准" in clause
    assert "样本" in clause, "必须自带样本量，作者与模型都要看得见这个数字有多少料"


def test_declared_instructions_outrank_measured_baseline(tmp_path: Path) -> None:
    """分层顺序即优先级：通用准则 → 量出的基线 → 作者声明的指令（最后=最强）。

    顺序拼反即红。作者说「这段要短句」必须压过历史平均句长。
    """

    project = _uniform_project(tmp_path)
    storyforge = project / ".storyforge"
    storyforge.mkdir(exist_ok=True)
    (storyforge / "agent-instructions.md").write_text("这一章一律用短句。", encoding="utf-8")

    prompt = build_generation_system_prompt("通用创作准则在前。", str(project))
    assert prompt.index("通用创作准则在前。") < prompt.index("文风基线")
    assert prompt.index("文风基线") < prompt.index("这一章一律用短句。")


def test_generation_prompt_is_untouched_without_corpus(tmp_path: Path) -> None:
    assert build_generation_system_prompt("原样", str(tmp_path)) == "原样"


def test_min_chunk_chars_is_a_real_floor() -> None:
    assert MIN_CHUNK_CHARS > 0 and MIN_CHUNKS >= 3, "少于 3 块无法估块间方差，阈值不得下调"


def test_judge_and_generator_share_one_fingerprint_implementation() -> None:
    """检查器与生成器必须是同一个对象——两份切句实现就会各按各的尺子说话。"""

    from app.domains.judge.style_fingerprint import _style_fingerprint
    from app.domains.judge.types import StyleFingerprint

    assert _style_fingerprint is style_fingerprint
    assert StyleFingerprint is style_fingerprint("句子。").__class__
