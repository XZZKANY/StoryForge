"""修订能力：只消费已准备的值；生成 I/O 由调用方显式注入。

不读取项目文件/配置，不写会话、证据或原稿，不负责 Agent patch 与权限。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, Protocol

from app.common.craft import craft_prompt_clause, scene_discipline_guard_clause
from app.common.performance import current_measurement, measure_stage, measured
from app.common.punctuation import restore_incidental_punctuation
from app.domains.agent_runs.patches.polishing import PolishGateResult, evaluate_polish_candidate


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


@measured("revision.total")
def revise_text(request: RevisionInput, *, generate: RevisionGenerator) -> RevisionResult:
    """一次生成 → 标点还原 → 可选门禁；模型错误原样抛给应用编排层。"""
    prompt = build_revision_prompt(request)
    with measure_stage("revision.model"):
        generated = generate(system_prompt=request.system_prompt, user_prompt=prompt)
    with measure_stage("revision.punctuation"):
        after = restore_incidental_punctuation(request.content, str(generated["content"]))
    gate = None
    if request.quality_gate == "polish":
        with measure_stage("revision.quality") as quality:
            gate = evaluate_polish_candidate(request.content, after)
            if not gate.passed:
                quality.outcome("rejected")
                raise RevisionQualityRejected(gate)
    elif (recorder := current_measurement()) is not None:
        recorder.mark("revision.quality", status="skipped")
    # 不带出 native body、headers、continuation 或 provider 配置；保留缺失/None/0 的区别。
    telemetry = {key: generated[key] for key in _TELEMETRY_KEYS if key in generated}
    return RevisionResult(after=after, telemetry=telemetry, quality_gate=gate)
