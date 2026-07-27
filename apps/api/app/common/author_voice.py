"""作者自定义指令的读取与注入：`.storyforge/agent-instructions.md`。

放 `app/common` 的原因与 craft 相同——四条产字路径分属三个域，而 `agent_runs/loop/*.py`
不得 import `domains.book_runs`、`assistant` 不得顶层 import `agent_runs`（会成环）。
本模块保持无 domains 依赖叶子：自己做目录解析（相对路径由后端硬拼、不接受外部传入，
无遍历面），不借 fs_tools。

诊断背景（2026-07-28）：该文件此前只被 chat 循环读取，而循环自己不产字——它产字靠调
file.revise / file.create / prose.continue，那三条各用自己的 system prompt 且不带作者指令。
故作者写进这个文件的偏好在改前**影响不到任何一个生成字符**。本模块是那条触达的载体。
"""

from __future__ import annotations

from pathlib import Path

from app.common.style_baseline import append_style_baseline_to_system_prompt

_DIRNAME = ".storyforge"
_FILENAME = "agent-instructions.md"

MAX_CHARS = 4_000

# 措辞刻意分两档：对话路径（循环）沿用"尽量遵循"，产字路径用"逐条遵循"。
# 生成时作者指令是硬约束（"这个人物不说某个词"必须照办），而循环在讨论 / 审读时
# 需要保留判断空间。两档共用同一份文件内容，只换注入措辞。
CONVERSATION_PREFIX = (
    "以下是作者对你的额外偏好与要求，请在不违反上述工具纪律与写回红线"
    "（补丁必须经作者在界面确认、后端绝不写盘）的前提下尽量遵循：\n"
)

GENERATION_PREFIX = (
    "以下是作者对自己作品的写作偏好与要求。你正在为这位作者的正文落笔，"
    "请逐条遵循；与上述通用创作准则冲突时，以作者本人的要求为准：\n"
)


def read_author_instructions(project_path: str | None) -> str | None:
    """读 `.storyforge/agent-instructions.md`；不存在 / 读失败 / 空内容一律 None。

    写盘即生效（每次调用重读，不缓存）。这是加分项，绝不能拖垮聊天或生成：
    任何异常都吞掉返回 None。超长按 MAX_CHARS 截断。
    """

    if not isinstance(project_path, str) or not project_path.strip():
        return None
    try:
        root = Path(project_path).resolve()
        if not root.is_dir():
            return None
        target = root / _DIRNAME / _FILENAME
        if not target.is_file():
            return None
        text = target.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not text:
        return None
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n…[作者指令过长已截断]"
    return text


def append_author_instructions_to_system_prompt(
    system_prompt: str, project_path: str | None
) -> str:
    """把作者指令接到产字路径的 system prompt 末尾（近因位置最强）。

    无指令时原样返回，调用方无需判空——这样三条生成路径的接线各只需一行。
    """

    instructions = read_author_instructions(project_path)
    if instructions is None:
        return system_prompt
    return system_prompt + "\n\n" + GENERATION_PREFIX + instructions


def build_generation_system_prompt(base_prompt: str, project_path: str | None) -> str:
    """三条产字路径的 system prompt 唯一组装点。

    分层顺序即优先级，越靠后越强：通用创作准则（base_prompt 自带）→ 量自正文的文风基线
    → 作者声明的指令。**声明高于测量**——作者说「这段要短句」就该压过历史平均句长；
    顺序写在这一个函数里而不是散在四个调用点，是为了不让某处把层序拼反。
    """

    return append_author_instructions_to_system_prompt(
        append_style_baseline_to_system_prompt(base_prompt, project_path),
        project_path,
    )
