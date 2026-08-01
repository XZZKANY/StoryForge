"""标点漂移闸：模型顺手美化的标点不得写进正文，也不得污染越界警告。

背景见 app/common/punctuation.py 的模块 docstring——三处 prompt 都写了「不得调整
标点」，但那是提示词，管不住；这里是确定性兜底。
"""

from __future__ import annotations

from app.common.punctuation import canonical_punctuation, restore_incidental_punctuation
from app.domains.agent_runs.revise_scope import _revise_drift_ratio

# 一段带足中文排版特征的正文：弯引号、破折号、省略号、全角空格段首缩进。
ORIGINAL = "\n".join(
    [
        "　　林岚推开舱门，海风灌进来。",
        "",
        "“你确定是这里？”她问。",
        "",
        "老陈没有回答——他盯着仪表盘上跳动的读数，很久很久……",
        "",
        "　　十二台发射器同时亮起。",
    ]
)

# 模型「顺手美化」的结果：一个字没改，只把标点换成了 ASCII 形态。
PUNCTUATION_ONLY_DRIFT = "\n".join(
    [
        "  林岚推开舱门，海风灌进来。",
        "",
        '"你确定是这里？"她问。',
        "",
        "老陈没有回答—他盯着仪表盘上跳动的读数，很久很久...",
        "",
        "  十二台发射器同时亮起。",
    ]
)


def _with_real_edit(text: str) -> str:
    """在漂移文本上再叠一处真实改动，模拟「改了一句 + 顺手美化全篇」。"""

    return text.replace("她问。", "她压低声音问。")


class TestCanonicalPunctuation:
    def test_folds_drifted_forms_to_same_shape(self) -> None:
        assert canonical_punctuation(ORIGINAL) == canonical_punctuation(PUNCTUATION_ONLY_DRIFT)

    def test_keeps_cjk_punctuation_distinct_from_ascii(self) -> None:
        """刻意不折叠中英文标点互换——那是该被作者看见的质量问题，不是排版漂移。"""

        assert canonical_punctuation("你好，世界。") != canonical_punctuation("你好, 世界.")

    def test_folds_repeat_runs_of_different_length(self) -> None:
        """模型极少逐字符替换：…… 通常写成 ...（三个点）而不是 ......。"""

        assert canonical_punctuation("很久很久……") == canonical_punctuation("很久很久...")
        assert canonical_punctuation("他说——很久") == canonical_punctuation("他说—很久")
        assert canonical_punctuation("他说——很久") == canonical_punctuation("他说--很久")

    def test_does_not_touch_content_characters(self) -> None:
        assert canonical_punctuation("林岚") == "林岚"


class TestRestoreIncidentalPunctuation:
    def test_real_edit_survives_and_drift_is_reverted(self) -> None:
        """核心不变量：真实改动一字不动，顺手漂移全部还原。"""

        restored = restore_incidental_punctuation(ORIGINAL, _with_real_edit(PUNCTUATION_ONLY_DRIFT))

        assert "她压低声音问。" in restored, "真实改动被闸吃掉了"
        original_lines = ORIGINAL.split("\n")
        restored_lines = restored.split("\n")
        assert len(restored_lines) == len(original_lines)
        changed = [
            i
            for i, (a, b) in enumerate(zip(original_lines, restored_lines, strict=True))
            if a != b
        ]
        assert changed == [2], f"除真实改动行外还有残留漂移：{changed}"
        # 未点名处的中文排版必须逐字回到原样。
        assert restored_lines[0] == "　　林岚推开舱门，海风灌进来。"
        assert restored_lines[4].endswith("很久很久……")

    def test_pure_punctuation_change_is_left_alone(self) -> None:
        """全文除标点外无改动时不干预——那多半正是作者要的（例如统一引号形态）。"""

        assert (
            restore_incidental_punctuation(ORIGINAL, PUNCTUATION_ONLY_DRIFT)
            == PUNCTUATION_ONLY_DRIFT
        )

    def test_identical_input_is_returned_unchanged(self) -> None:
        assert restore_incidental_punctuation(ORIGINAL, ORIGINAL) == ORIGINAL

    def test_added_lines_keep_their_own_punctuation(self) -> None:
        """新增段落里模型自己用的标点属于本次改动，不该被还原成别处的形态。"""

        after = ORIGINAL + "\n\n“走吧。”老陈说。"
        restored = restore_incidental_punctuation(ORIGINAL, after)

        assert restored.endswith("“走吧。”老陈说。")

    def test_deletion_is_preserved(self) -> None:
        after = "\n".join(line for line in ORIGINAL.split("\n") if "十二台" not in line)
        restored = restore_incidental_punctuation(ORIGINAL, after)

        assert "十二台" not in restored

    def test_blank_line_heavy_text_stays_aligned(self) -> None:
        """中文正文空行极多；对齐若被 autojunk 干扰会整体错位。"""

        before = "\n".join(["第一段。", "", "", "第二段——收尾。", "", ""])
        after = "\n".join(["第一段。", "", "", "第二段--改写后的收尾。", "", ""])
        restored = restore_incidental_punctuation(before, after)

        assert restored.split("\n") == ["第一段。", "", "", "第二段--改写后的收尾。", "", ""]


class TestDriftRatioIgnoresPunctuation:
    def test_pure_punctuation_drift_scores_zero(self) -> None:
        """实测过的回归：零真实改动的纯标点漂移曾被判成 97% 越界。"""

        changed, _total, ratio = _revise_drift_ratio(ORIGINAL, PUNCTUATION_ONLY_DRIFT)

        assert changed == 0
        assert ratio == 0.0

    def test_real_edit_still_counted(self) -> None:
        changed, _total, ratio = _revise_drift_ratio(
            ORIGINAL, _with_real_edit(PUNCTUATION_ONLY_DRIFT)
        )

        assert changed == 1
        assert ratio > 0

    def test_wholesale_rewrite_still_trips_threshold(self) -> None:
        """越界重写必须照旧报警——折叠标点不能把这个信号一起抹掉。"""

        rewritten = "\n".join(f"彻底改写的第 {index} 行。" for index in range(7))
        _changed, _total, ratio = _revise_drift_ratio(ORIGINAL, rewritten)

        assert ratio > 0.5
