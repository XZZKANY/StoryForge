"""canon 触达护栏：整章级产字路径必须拿得到作者声明的硬约束。

背景（2026-07-29 诊断）：canon 硬约束 + 活跃伏笔 + 本章伏笔计划由
`canon_context.build_scene_constraint_block` 确定性拼出，但全仓只有**两个**调用点——
`prose.continue`（300 字续写）和不产字的 chat 循环。真正整章级的三条产字路径
`file.revise` / `project.trim_prose` / `file.create` 一个都没接：

    300 字续写知道「「玄铁令」唯一持有者 = 陈默」「「老陈的旧伤」第 12 章前必须回收」，
    而让 agent 起草整整一章时，这些约束一个字都不在 prompt 里。

结构性根因：canon 住在 `domains/agent_runs`，`app/common` 不得 import domains、
assistant 也不得顶层 import agent_runs（`file.create` 反向依赖 assistant 会成环），
所以 canon 进不了 `build_generation_system_prompt` 那个统一组装点，只能每条路径各自
延迟导入一次——此前只有 continue 那条做了。

本文件的红线：把任意一条产字路径的 `scene_constraints` 参数删掉即红。
"""

from __future__ import annotations

import json
from pathlib import Path

from app.domains.assistant.schemas import (
    AssistantDraftRequest,
    AssistantReviseRequest,
)
from app.domains.assistant.service import (
    _build_draft_prompt,
    _build_revise_prompt,
    _scene_constraints,
)

_CONSTRAINT_MARK = "[canon 硬约束 · 确定性 · 勿违背]"


def _project_with_canon(tmp_path: Path) -> Path:
    manuscript = tmp_path / "正文"
    manuscript.mkdir()
    (manuscript / "第001章.md").write_text("第一章。" * 50, encoding="utf-8")
    (manuscript / "第002章.md").write_text("第二章。" * 50, encoding="utf-8")

    canon_dir = tmp_path / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True)
    (canon_dir / "canon.json").write_text(
        json.dumps(
            {
                "entities": [{"id": "chen-mo", "canonical_name": "陈默", "aliases": ["老陈"]}],
                "invariants": {
                    "single_holder": [{"item": "玄铁令", "holder": "chen-mo"}],
                    "lifespan": [{"entity": "chen-mo", "exits_after_chapter": 1}],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return manuscript


def test_scene_constraints_are_resolvable_for_a_manuscript_file(tmp_path: Path) -> None:
    manuscript = _project_with_canon(tmp_path)

    block = _scene_constraints(str(tmp_path), str(manuscript / "第002章.md"))

    assert block is not None
    assert _CONSTRAINT_MARK in block
    assert "玄铁令" in block
    assert "陈默" in block, "硬约束头必须显示人名而不是裸 entity id"


def test_revise_prompt_carries_canon(tmp_path: Path) -> None:
    """`file.revise`（Ctrl+K 直连 + 循环工具）与 `project.trim_prose` 共用这条 prompt。"""

    manuscript = _project_with_canon(tmp_path)
    payload = AssistantReviseRequest(
        file_path=str(manuscript / "第002章.md"),
        content="陈默把玄铁令交了出去。",
        instruction="把这段写得更紧。",
        project_root=str(tmp_path),
    )
    block = _scene_constraints(payload.project_root, payload.file_path)

    prompt = _build_revise_prompt(payload, block)

    assert _CONSTRAINT_MARK in prompt
    assert "玄铁令" in prompt
    # 没有 canon 时不得凭空多出空块。
    assert _CONSTRAINT_MARK not in _build_revise_prompt(payload, None)


def test_draft_prompt_carries_canon_and_the_previous_chapter(tmp_path: Path) -> None:
    """整章起草最需要设定约束与前情，此前两样都没有。"""

    manuscript = _project_with_canon(tmp_path)
    payload = AssistantDraftRequest(
        file_path=str(manuscript / "第003章.md"),
        instruction="写第三章。",
        project_root=str(tmp_path),
    )
    block = _scene_constraints(payload.project_root, payload.file_path)

    prompt = _build_draft_prompt(payload, block, ("正文/第002章.md", "他转身走进雨里。"))

    assert _CONSTRAINT_MARK in prompt
    assert "玄铁令" in prompt
    assert "他转身走进雨里。" in prompt
    assert "正文/第002章.md" in prompt
    # canon 与前情必须排在写作指令之前——指令占近因最强位。
    assert prompt.index(_CONSTRAINT_MARK) < prompt.index("写作指令：")

    bare = _build_draft_prompt(payload, None, None)
    assert _CONSTRAINT_MARK not in bare
    assert "PREVIOUS" not in bare


def test_missing_project_root_degrades_silently(tmp_path: Path) -> None:
    """缺项目根 / canon 损坏一律静默跳过：拿不到约束绝不能挡住作者继续写。"""

    manuscript = _project_with_canon(tmp_path)

    assert _scene_constraints(None, str(manuscript / "第002章.md")) is None
    assert _scene_constraints(str(tmp_path / "不存在"), str(manuscript / "第002章.md")) is None

    (tmp_path / ".storyforge" / "canon" / "canon.json").write_text("{ 坏 json", encoding="utf-8")
    assert _scene_constraints(str(tmp_path), str(manuscript / "第002章.md")) is None
