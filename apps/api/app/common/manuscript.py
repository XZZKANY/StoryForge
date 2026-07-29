"""正文与非正文的单一判据：哪些文件算「章」。

诊断（2026-07-28）：后端此前对「哪些 .md 是正文」**没有任何概念**。章序直接由
`fs_tools.iter_project_files` 的路径序给出，`大纲/总纲.md`、`人物/主角.md`、`设定/*.md`
一律占一个章号。产品自带的示例项目（`initialize.ts`）建出来就有三个 .md，按码点序是
人物 < 大纲 < 正文，于是作者的 `正文/第01章.md` **从第一天起就被算成第 3 章**——
canon 的退场闸、伏笔到期判定与实体预算阈值全部按虚高的章号跑，`promise_check` 报的
「当前进度」也跟着虚高两章。

目录约定不是本模块发明的：前端 `lib/project/semantics.ts` 的 `DIR_KIND` 早就声明了同一套
（正文 / draft / manuscript / chapters → 正文；大纲 / 人物 / 设定 / 时间线 / 伏笔 / 质量 /
导出 → 非正文）。此前只有前端认，后端不认；本模块把后端接上同一套约定。

**取黑名单而非白名单**（不是「只认 正文/」）：把章节直接放项目根的布局仍然可用，作者不必
先重组目录才能让 canon 算对章号。代价是根目录下的杂项 .md 仍会占章号——那由作者的目录
习惯兜住，不是本模块要解决的。

本模块必须保持无依赖叶子：`app/common` 不得 import domains（`style_baseline` 与
`agent_runs/*` 都要用它，后者在 domains 内）。
"""

from __future__ import annotations

from pathlib import Path

# 与前端 semantics.ts 的 DIR_KIND 同源，取其中**非** draft 的那些首段目录名。
# 两处若要改，须同改——判据分裂会让「作者看到的第几章」与「canon 算的第几章」再次错开。
NON_MANUSCRIPT_DIRS = frozenset(
    {
        # outline
        "大纲",
        "outline",
        "outlines",
        # character
        "人物",
        "角色",
        "character",
        "characters",
        # setting
        "设定",
        "世界观",
        "setting",
        "settings",
        "world",
        "worldbuilding",
        # timeline
        "时间线",
        "timeline",
        "timelines",
        "chronology",
        # foreshadowing
        "伏笔",
        "foreshadowing",
        "foreshadows",
        "seeds",
        # quality
        "质量",
        "quality",
        "reports",
        # export
        "导出",
        "export",
        "exports",
    }
)


def is_manuscript_path(relative_path: str) -> bool:
    """该相对路径是否算正文（据此编章序）。

    只看第一段目录名，与前端 `classifyRelativePath` 同语义。项目根下的文件按正文算：
    没有目录声明它的用途时，宁可计入也不要让「章节直接放根目录」的项目算出零章。
    """

    parts = [part for part in relative_path.replace("\\", "/").split("/") if part]
    if len(parts) < 2:
        return bool(parts)
    return parts[0].lower() not in NON_MANUSCRIPT_DIRS


# 上一章尾巴的取窗上限。比当前文件的 TAIL_MAX_CHARS(3000) 小：接笔只需要上一章怎么收的
# 场，给多了会把预算从「当前章上文」那头挤掉，而那头才是近因最强的位置。
PREVIOUS_TAIL_MAX_CHARS = 1200


def iter_manuscript_files(root: Path) -> list[Path]:
    """非 dot 目录下的正文 `*.md`，按路径序（= 阅读序）返回。

    路径序即阅读序是全仓统一口径（`canon_rebuild.chapter_ordinals` 同款），依赖作者按
    `第NNN章.md` 补零命名；`style_baseline` 与本模块的「上一章」都建在这个口径上。
    """

    files = [
        path
        for path in root.rglob("*.md")
        if path.is_file()
        and not any(part.startswith(".") for part in path.relative_to(root).parts)
        and is_manuscript_path(path.relative_to(root).as_posix())
    ]
    files.sort(key=lambda path: path.relative_to(root).as_posix())
    return files


def _tail_of(text: str, max_chars: int) -> str:
    """取尾部 max_chars，并从段落边界起头——上文以半句开头会误导模型的语感判断。"""

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if len(normalized) <= max_chars:
        return normalized.strip()
    window = normalized[-max_chars:]
    boundary = window.find("\n\n")
    if boundary != -1 and boundary < max_chars // 2:
        window = window[boundary + 2 :]
    return window.strip()


def previous_chapter_tail(
    project_root: str,
    current_file: str | None,
    *,
    max_chars: int = PREVIOUS_TAIL_MAX_CHARS,
) -> tuple[str, str] | None:
    """阅读序上一章的结尾正文，返回 `(相对路径, 尾巴)`；无上一章或读不到则 None。

    作者新建 `第005章.md` 说「接着往下写」时，第 004 章一个字都进不了模型上下文——续写
    因此接不上笔。本函数是后端补这一口的单一入口：sidecar 与项目文件同机，直接读盘比让
    前端把上一章塞进 bundle 更短更准（前端 bundle 还隔着一层 30 秒缓存）。

    任何异常一律吞掉返回 None：拿不到上一章是「少一块加分上下文」，绝不能挡住作者继续写。
    """

    if not current_file:
        return None
    try:
        root = Path(project_root).resolve()
        current = Path(current_file).resolve()
        rel = current.relative_to(root).as_posix()
        if not is_manuscript_path(rel):
            return None
        ordered = iter_manuscript_files(root)
        index = next(
            (i for i, path in enumerate(ordered) if path.relative_to(root).as_posix() == rel),
            None,
        )
        if index is None or index == 0:
            return None
        previous = ordered[index - 1]
        tail = _tail_of(previous.read_text(encoding="utf-8", errors="replace"), max_chars)
        if not tail:
            return None
        return previous.relative_to(root).as_posix(), tail
    except (OSError, ValueError):
        return None
