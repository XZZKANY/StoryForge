"""跨会话记忆护栏：作者指令文件必须被 agent 看得见、也被 agent 知道该往里写。

背景（2026-07-29 诊断）：桌面 agent 的跨会话记忆为零。上下文严格等于「本会话最后 12 条
消息」（`support.py::_history_messages` 按 assistant_session_id 单会话查），作者换个会话
说过的偏好（「别用排比句」「他一律叫老陈」）全部归零；全仓没有任何跨会话记忆机制。

唯一每轮无条件重读、与会话 id 完全无关的载体是 `.storyforge/agent-instructions.md`
（`read_author_instructions`）。但它此前：

1. 被 `fs_tools._is_skipped` 的 dot 前缀规则挡掉——agent 的 fs_list / fs_search **看不见**它，
   既无法告诉作者「你有这个文件」，也无法在缺失时说「你可以建一个」；
2. 被前端 `entry-visibility.ts` 的白名单挡掉——**作者**看不见、打不开、搜不到；
3. system prompt 里只字未提——模型不知道有个地方可以把长期偏好存下来。

三处都补上后，跨会话记忆才成立：作者说出长期偏好 → agent 提议往那个文件追加一条 →
作者在界面确认写回 → 此后每个新会话开头都读得到。走的仍是既有写回红线（后端不写盘）。

本文件钉住 1 与 3；2 由前端 `tests/resource-explorer.test.ts` 钉。
"""

from __future__ import annotations

from pathlib import Path

from app.common.author_voice import RELATIVE_PATH, read_author_instructions
from app.domains.agent_runs import fs_tools
from app.domains.agent_runs.loop.prompt_context import SYSTEM_PROMPT


def _project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第001章.md").write_text("正文。", encoding="utf-8")
    storyforge = tmp_path / ".storyforge"
    (storyforge / "canon" / "derived").mkdir(parents=True)
    (storyforge / "canon" / "derived" / "presence.json").write_text("{}", encoding="utf-8")
    (storyforge / "versions").mkdir()
    (storyforge / "versions" / "第001章.snapshot.md").write_text("旧稿。", encoding="utf-8")
    (storyforge / "agent-instructions.md").write_text(
        "- 别用排比句。\n- 他一律叫老陈。\n", encoding="utf-8"
    )
    return tmp_path


def test_agent_can_discover_the_instructions_file(tmp_path: Path) -> None:
    """agent 看不见它，就永远无法在作者说出长期偏好时提议写进去。"""

    root = _project(tmp_path)

    listed = {entry["path"] for entry in fs_tools.fs_list(str(root))["entries"]}

    assert RELATIVE_PATH in listed
    assert "正文/第001章.md" in listed
    # 放行的只有这一个文件：整个 `.storyforge/` 放开会把 derived 缓存涌满上下文预算。
    assert not any(path.startswith(".storyforge/canon/") for path in listed)
    assert not any(path.startswith(".storyforge/versions/") for path in listed)


def test_agent_can_read_and_search_the_instructions_file(tmp_path: Path) -> None:
    root = _project(tmp_path)

    read = fs_tools.fs_read(str(root), RELATIVE_PATH)
    assert "别用排比句" in read["content"]

    hits = fs_tools.fs_search(str(root), "老陈", glob="*.md")
    assert any(match["path"] == RELATIVE_PATH for match in hits["matches"])


def test_instructions_survive_across_sessions_by_construction(tmp_path: Path) -> None:
    """读取与会话 id 无关：这正是它能当跨会话记忆的原因。"""

    root = _project(tmp_path)

    assert read_author_instructions(str(root)) == "- 别用排比句。\n- 他一律叫老陈。"

    (root / ".storyforge" / "agent-instructions.md").write_text(
        "- 别用排比句。\n- 他一律叫老陈。\n- 每章不超三千字。\n", encoding="utf-8"
    )
    # 写盘即生效、不缓存——作者确认补丁后的下一轮就读得到。
    assert "每章不超三千字" in (read_author_instructions(str(root)) or "")


def test_system_prompt_tells_the_agent_where_memory_lives() -> None:
    """模型不知道有这个地方，前两条修了也没人会去写。"""

    assert RELATIVE_PATH in SYSTEM_PROMPT
    assert "跨会话" in SYSTEM_PROMPT
    # 反向红线：一次性要求不得被沉淀成长期规矩，否则文件越攒越离谱。
    assert "只是针对眼前这一段提要求时不要写它" in SYSTEM_PROMPT
