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

from app.common.author_edit_policy import AuthorEditPolicy, build_author_edit_policy
from app.common.generation_sources import observe_generation_source, project_generation_source
from app.common.style_baseline import append_style_baseline_to_system_prompt

_DIRNAME = ".storyforge"
_FILENAME = "agent-instructions.md"

# 项目内相对路径（posix）。前端可见性白名单与后端 fs 工具的定点豁免都以它为准，
# 三处各自硬编码一次字符串必然漂移。
RELATIVE_PATH = f"{_DIRNAME}/{_FILENAME}"

MAX_CHARS = 4_000
MAX_SOURCE_BYTES = 512 * 1024

# 措辞刻意分两档：对话路径（循环）沿用"尽量遵循"，产字路径用"逐条遵循"。
# 生成时作者指令是硬约束（"这个人物不说某个词"必须照办），而循环在讨论 / 审读时
# 需要保留判断空间。两档共用同一份文件内容，只换注入措辞。
CONVERSATION_PREFIX = (
    "以下是作者对你的额外偏好与要求，请在不违反上述工具纪律与写回红线"
    "（后端绝不写盘，改动一律出成补丁交由编辑器写回；补丁要不要作者逐次点确认，"
    "由该项目的权限档位决定，不由你决定）的前提下尽量遵循：\n"
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
        project_generation_source("author_instructions", None, omission_reason="missing_project")
        return None
    target = None
    raw = None
    try:
        root = Path(project_path).resolve()
        if not root.is_dir():
            return None
        target = (root / _DIRNAME / _FILENAME).resolve()
        target.relative_to(root)
        if not target.is_file():
            observe_generation_source("author_instructions", target, omission_reason="missing_source")
            project_generation_source("author_instructions", None, omission_reason="missing_source")
            return None
        with target.open("rb", buffering=0) as stream:
            raw = stream.read(MAX_SOURCE_BYTES + 1)
        if len(raw) > MAX_SOURCE_BYTES or b"\x00" in raw[:1024]:
            reason = "source_byte_budget" if len(raw) > MAX_SOURCE_BYTES else "binary_source"
            observe_generation_source("author_instructions", target, raw=raw, complete=False, omission_reason=reason)
            project_generation_source("author_instructions", None, omission_reason=reason)
            return None
        text = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n").strip()
    except (OSError, ValueError, RuntimeError):
        observe_generation_source("author_instructions", target, raw=raw, omission_reason="unreadable_source")
        project_generation_source("author_instructions", None, omission_reason="unreadable_source")
        return None
    observe_generation_source("author_instructions", target, raw=raw, text=text, complete=True)
    if not text:
        project_generation_source("author_instructions", None, omission_reason="empty_source")
        return None
    original_length = len(text)
    if len(text) > MAX_CHARS:
        # 保尾截断（C13）：作者指令是追加语义——新要求总在文件尾部，头部截断会把
        # 追加的新要求吞掉（前 4000 字吃掉尾部新增）。保最近的要求，丢最早的旧条。
        marker = "…[作者指令过长已截断，保留最近部分]\n"
        budget = MAX_CHARS - len(marker)
        text = marker + text[-budget:]
    project_generation_source(
        "author_instructions",
        text,
        truncated=original_length > MAX_CHARS,
        source_span={
            "start": max(0, original_length - budget) if original_length > MAX_CHARS else 0,
            "end": original_length,
            "basis": "normalized_text",
            "unit": "chars",
        },
        transformation="author_tail_with_notice_v1",
    )
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


def edit_policy_from_generation_prompt(
    original: str, *, instruction: str, system_prompt: str,
    admitted_author_requirements: tuple[str, ...] = (),
) -> AuthorEditPolicy:
    """投影已经准备好的声音，不二次读盘，也不从通用 system 指令推导授权。"""
    before_author, marker, author = system_prompt.partition(GENERATION_PREFIX)
    baseline_marker = "\n\n文风基线（"
    baseline_start = before_author.find(baseline_marker)
    return build_author_edit_policy(
        original,
        instruction=instruction,
        author_requirements=(author,) if marker else admitted_author_requirements,
        baseline=before_author[baseline_start + 2:] if baseline_start >= 0 else "",
    )
