"""prompt 对比实验台的固定输入集。

「雾港」种子手写（林岚/雾港/灯塔信号失真/克制悬疑/左臂受伤），全部不依赖 DB。
输入覆盖 live file.create 起草与 agent 组装链单轮回话。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Task:
    """一条实验任务：固定输入 + 任务类型 + 渲染参数。kind 决定用哪张变体注册表。"""

    id: str
    kind: str
    description: str
    user_prompt: str = ""


# --- live 链（桌面 file.create）输入 ---
#
# user 消息一律经生产的 `_build_draft_prompt` 渲染，不手写：变体只改 system prompt，
# 输入侧必须与作者在桌面按「新建文件起草」时收到的逐字一致，否则量的不是同一条链。
_LIVE_FACTS = (
    "必须体现的既有设定：①林岚持有旧港灯塔密钥；②林岚左臂受伤未愈；"
    "③灯塔信号在无雾之夜也会失真；④守塔人老周知情但只说一半。"
)


def _live_user_prompt(*, file_path: str, instruction: str, previous: tuple[str, str] | None) -> str:
    from app.domains.assistant.schemas import AssistantDraftRequest
    from app.domains.assistant.service import _build_draft_prompt

    payload = AssistantDraftRequest(
        file_path=file_path,
        instruction=instruction,
        project_name="雾港",
    )
    return _build_draft_prompt(payload, None, previous)


_LIVE_PREV = (
    "第002章 修船坞",
    "老陈把缆绳放回架上，没有回头。“三个月没人动过灯塔的零件。”"
    "林岚看着他后颈渗出的汗，把通行证收进口袋。塔顶的灯又闪了一次，比昨夜早了两秒。",
)

TASKS: dict[str, Task] = {
    "agent-chat": Task(
        id="agent-chat",
        kind="agent",
        description="agent 组装链单轮回话：继续写这一章",
        user_prompt="继续写这一章，保持林岚的克制语气。约 120 字。",
    ),
    "live-opening": Task(
        id="live-opening",
        kind="live-draft",
        description="live file.create 起草开篇（约 400 字，无上一章）",
        user_prompt=_live_user_prompt(
            file_path="正文/第001章 雾港.md",
            instruction=(
                "写第一章开篇：林岚夜巡灯塔，首次核对信号节拍并发现异常间隔，锁定守塔人。"
                "克制悬疑，第三人称贴身，短句，对白短促。约 400 字。" + _LIVE_FACTS
            ),
            previous=None,
        ),
    ),
    "live-transition": Task(
        id="live-transition",
        kind="live-draft",
        description="live file.create 起草过渡章完整正文（600–1600 字，带上一章尾）",
        user_prompt=_live_user_prompt(
            file_path="正文/第003章 值班记录.md",
            instruction=(
                "写本章完整正文：林岚回灯塔找值班记录，发现缺页，守塔人老周在场但只说一半。"
                "克制悬疑，第三人称贴身。600–1600 字。" + _LIVE_FACTS
            ),
            previous=_LIVE_PREV,
        ),
    ),
    "live-climax": Task(
        id="live-climax",
        kind="live-draft",
        description="live file.create 起草高潮对峙（800–1200 字，带上一章尾）",
        user_prompt=_live_user_prompt(
            file_path="正文/第004章 塔顶.md",
            instruction=(
                "写本章完整正文：林岚登塔顶与守塔人摊牌，对白交锋为主。"
                "守塔人承认伪造记录但否认与失窃案有关，收场时林岚摔碎密钥、线索断一半。"
                "克制悬疑，第三人称贴身，张力拉满但字面冷静。800–1200 字。" + _LIVE_FACTS
            ),
            previous=_LIVE_PREV,
        ),
    ),
}
