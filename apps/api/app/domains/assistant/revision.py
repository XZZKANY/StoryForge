"""修订能力：只消费已准备的值；生成 I/O 由调用方显式注入。

不读取项目文件/配置，不写会话、证据或原稿，不负责 Agent patch 与权限。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, Protocol

from app.common.craft import craft_prompt_clause, scene_discipline_guard_clause
from app.common.performance import current_measurement, measure_stage, measured
from app.common.punctuation import restore_incidental_punctuation
from app.domains.agent_runs.patches.polishing import PolishGateConfig, PolishGateResult, evaluate_polish_candidate


@dataclass(frozen=True)
class RevisionContextFile:
    relative_path: str
    kind: str
    excerpt: str = field(repr=False)


@dataclass(frozen=True)
class RevisionInput:
    file_path: str
    content: str = field(repr=False)
    instruction: str = field(repr=False)
    system_prompt: str = field(repr=False)
    project_name: str | None = None
    context_files: tuple[RevisionContextFile, ...] = ()
    scene_constraints: str | None = field(default=None, repr=False)
    quality_gate: Literal["polish"] | None = None


class RevisionGenerator(Protocol):
    """已绑定模型配置的完整正文生成器；生产继续使用流式聚合传输。"""

    def __call__(self, *, system_prompt: str, user_prompt: str) -> Mapping[str, object]: ...


@dataclass(frozen=True)
class RevisionResult:
    after: str = field(repr=False)
    telemetry: Mapping[str, object]
    quality_gate: PolishGateResult | None


class RevisionQualityRejected(RuntimeError):
    """只暴露拒绝依据，不把失败候选交给调用方当作可用正文。"""

    def __init__(self, gate: PolishGateResult) -> None:
        self.gate = gate
        super().__init__("润色候选未通过质量门禁：" + ", ".join(gate.reasons))


REVISION_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇创作编辑。"
    "用户会给你一份正在编辑的文件全文与一条修订指令。"
    "请严格按指令修订，保持原有结构、人物与设定的连贯性。"
    "默认只改动指令直接涉及的部分，未点名的段落、句子与标题尽量逐字保留，不要无谓改写或扩大改动范围。"
    + craft_prompt_clause()
    + "创作准则约束的是你这次落笔改写的那些句子；它不构成扩大改动范围的理由，"
    "未点名段落即便不合准则也保持原样，由作者另行提出。"
    + scene_discipline_guard_clause()
    + "只输出修订后的完整正文，不要输出解释、前后缀或代码块标记。"
)


@measured("revision.prompt")
def build_revision_prompt(request: RevisionInput) -> str:
    project_line = f"项目：{request.project_name}\n" if request.project_name else ""
    context_block = ""
    if request.context_files:
        context_entries = []
        for item in request.context_files:
            context_entries.append(
                "\n".join(
                    [
                        f"### {item.relative_path}",
                        f"- 类型：{item.kind}",
                        "<<<CONTEXT",
                        item.excerpt,
                        "CONTEXT>>>",
                    ]
                )
            )
        context_block = (
            "\n项目上下文摘录：这些文件来自同一小说项目，请用于保持大纲、人物、设定与正文连贯；"
            "如果摘录与当前文件冲突，优先保留明确的当前文件事实，并在修订中避免扩大矛盾。\n"
            + "\n\n".join(context_entries)
            + "\n"
        )
    constraint_block = f"\n{request.scene_constraints}\n" if request.scene_constraints else ""
    return (
        f"{project_line}"
        f"文件：{request.file_path}\n"
        f"修订指令：{request.instruction}\n\n"
        f"{context_block}"
        f"{constraint_block}"
        # 不说「全文」：行间 Ctrl+K 对长章节只送锚点附近的窗口，说全文会与指令里的
        # 节选说明打架，也会诱导模型给一段节选补开头结尾。
        "以下是待修订的正文，请按指令修订后整体返回，只返回你收到的这段：\n"
        "<<<FILE\n"
        f"{request.content}\n"
        "FILE>>>"
    )


_TELEMETRY_KEYS = (
    "prompt_tokens",
    "completion_tokens",
    "token_usage",
    "cost_cny_estimated",
    "cost_breakdown",
    "token_usage_source",
    "latency_ms",
    "reasoning_leak_stripped",
)

# 指令授权扩写时，解除基于整窗字数的 word_count_drift 上界：行间修订只送锚点附近窗口，
# 短窗里的局部扩写会让整窗比例远超 polish 的 1.15，但这证明不了越界。缩写下界与
# 结构/实体/人称/静态问题保护闸原样保留。
_EXPANSION_INSTRUCTION_KEYWORDS = ("扩写", "加长", "展开", "补充", "丰富", "细化")
# 行间 Ctrl+K 把锚定正文拼进 instruction（<<<ANCHOR … ANCHOR>>>）；正文里出现「展开」这类
# 中文叙事高频词不构成扩写授权，判定前必须剥离锚定块，只看作者指令本身。
_ANCHOR_BLOCK = re.compile(r"<<<ANCHOR\b.*?ANCHOR>>>", re.DOTALL)
_ANCHOR_BLOCK_OPEN = "<<<ANCHOR"
# 否定语境（「不要扩写」「别补充」）不构成授权。标记须紧贴关键词，避免「别怕，展开写」误判。
_EXPANSION_NEGATION_PREFIXES = (
    "不要",
    "别",
    "不用",
    "不必",
    "先别",
    "暂不",
    "先不",
    "无需",
    "无须",
    "切忌",
    "禁止",
    "不准",
    "不许",
    "切勿",
    "避免",
)
# 否定标记与扩写关键词之间可夹少量非动词成分（「不要立刻展开」「不必再细化了」），
# 但间隔超过该长度或含句读/空白即视为否定作用域已断开。
_NEGATION_GAP_MAX = 8
# 单字「别」会被构词误伤：「特别/分别/个别/级别/差别/性别/辨别/区别/识别」里「别」前的字
# 属于这类构词的构词前缀，出现即不算否定。
_NEGATION_LEFT_GUARD = frozenset("特分个级差性辨区识类")
EXPANSION_POLISH_GATE_CONFIG = PolishGateConfig(max_char_ratio=float("inf"))


def _strip_anchor_blocks(instruction: str) -> str:
    text = _ANCHOR_BLOCK.sub("", instruction)
    # 前端 buildInlineReviseInstruction 把整串 slice(0, 4000)，长指令 + 大选区时末尾 ANCHOR>>>
    # 会被截掉；成对正则剥离失效后锚定正文里的「展开」等词泄漏成授权。见开标记即剥到结尾。
    open_index = text.find(_ANCHOR_BLOCK_OPEN)
    return text[:open_index] if open_index != -1 else text


def _negation_reaches_keyword(text: str, index: int, negation: str, keyword_start: int) -> bool:
    gap = text[index + len(negation):keyword_start]
    if len(gap) > _NEGATION_GAP_MAX:
        return False
    if not all("一" <= char <= "鿿" for char in gap):
        return False
    # 单字「别」只在构词前缀（特别/分别/个别/级别…）里出现时不算否定。
    return not (negation == "别" and index >= 1 and text[index - 1] in _NEGATION_LEFT_GUARD)


def _negates_expansion(text: str, start: int) -> bool:
    for negation in _EXPANSION_NEGATION_PREFIXES:
        search_from = max(0, start - _NEGATION_GAP_MAX - len(negation))
        index = text.rfind(negation, search_from, start)
        while index != -1:
            if _negation_reaches_keyword(text, index, negation, start):
                return True
            index = text.rfind(negation, search_from, index)
    return False


def instruction_authorizes_expansion(instruction: str) -> bool:
    text = _strip_anchor_blocks(instruction)
    for keyword in _EXPANSION_INSTRUCTION_KEYWORDS:
        start = text.find(keyword)
        while start != -1:
            if not _negates_expansion(text, start):
                return True
            start = text.find(keyword, start + len(keyword))
    return False


@measured("revision.total")
def revise_text(request: RevisionInput, *, generate: RevisionGenerator) -> RevisionResult:
    """一次生成 → 标点还原 → 可选门禁；模型错误原样抛给应用编排层。"""
    prompt = build_revision_prompt(request)
    with measure_stage("revision.model"):
        generated = generate(system_prompt=request.system_prompt, user_prompt=prompt)
    with measure_stage("revision.punctuation"):
        after = restore_incidental_punctuation(request.content, str(generated["content"]))
    # 扩写策略只在明确请求 polish 档时生效：授权时放开整窗字数上界，其余保护闸原样保留。
    # quality_gate=None（agent 循环 file.revise / chapter 修复）完全不过门禁，与改动前一致。
    expansion_authorized = (
        request.quality_gate == "polish" and instruction_authorizes_expansion(request.instruction)
    )
    gate = None
    if request.quality_gate == "polish":
        with measure_stage("revision.quality") as quality:
            gate = evaluate_polish_candidate(
                request.content,
                after,
                config=EXPANSION_POLISH_GATE_CONFIG if expansion_authorized else None,
            )
            if not gate.passed:
                quality.outcome("rejected")
                raise RevisionQualityRejected(gate)
    elif (recorder := current_measurement()) is not None:
        recorder.mark("revision.quality", status="skipped")
    # 不带出 native body、headers、continuation 或 provider 配置；保留缺失/None/0 的区别。
    telemetry = {key: generated[key] for key in _TELEMETRY_KEYS if key in generated}
    return RevisionResult(after=after, telemetry=telemetry, quality_gate=gate)
