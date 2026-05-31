from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Any

from storyforge_workflow.orchestrators.novel_loop import NovelLoopRequest
from storyforge_workflow.skills.definitions import (
    DEFAULT_NOVEL_SKILL_REGISTRY,
    NovelSkillDefinition,
    NovelSkillRegistry,
)


@dataclass(frozen=True)
class NovelSkillRun:
    """一次小说技能运行的引用化审计记录，不保存完整正文或提示词。"""

    skill_name: str
    skill_version: str
    status: str
    book_id: int | None
    chapter_index: int | None = None
    input_refs: dict[str, Any] = field(default_factory=dict)
    output_refs: dict[str, Any] = field(default_factory=dict)
    budget: dict[str, int | float] = field(default_factory=dict)
    error_summary: str | None = None

    def to_audit_dict(self) -> dict[str, Any]:
        """输出适合写入审计摘要的浅拷贝 payload。"""

        return {
            "skill_name": self.skill_name,
            "skill_version": self.skill_version,
            "status": self.status,
            "book_id": self.book_id,
            "chapter_index": self.chapter_index,
            "input_refs": dict(self.input_refs),
            "output_refs": dict(self.output_refs),
            "budget": dict(self.budget),
            "error_summary": self.error_summary,
        }


class NovelSkillRunner:
    """包装小说技能定义查询与后续端口运行记录。"""

    def __init__(self, *, registry: NovelSkillRegistry = DEFAULT_NOVEL_SKILL_REGISTRY) -> None:
        self._registry = registry
        self.runs: list[NovelSkillRun] = []

    @classmethod
    def default(cls) -> NovelSkillRunner:
        """使用默认静态技能注册表创建 runner。"""

        return cls(registry=DEFAULT_NOVEL_SKILL_REGISTRY)

    def definition_for(self, skill_name: str) -> NovelSkillDefinition:
        """按名称读取技能定义，复用注册表的缺失错误语义。"""

        return self._registry.require(skill_name)

    def run_generate(
        self,
        *,
        request: NovelLoopRequest,
        context_id: str,
        generate_scene: Callable[[NovelLoopRequest, str], str],
        record_model_run: Callable[[NovelLoopRequest, str], int],
    ) -> tuple[str, int]:
        """执行 generate 端口并记录草稿 hash 与 ModelRun 引用。"""

        draft = generate_scene(request, context_id)
        model_run_id = record_model_run(request, draft)
        self._append_run(
            request=request,
            skill_name="generate",
            status="generated",
            input_refs={
                "chapter_id": request.chapter_id,
                "chapter_index": request.chapter_index,
                "compiled_context_id": context_id,
            },
            output_refs={"model_run_id": model_run_id, "draft_hash": _draft_hash(draft)},
        )
        return draft, model_run_id

    def run_judge(
        self,
        *,
        draft: str,
        attempt: int,
        judge_scene: Callable[[str, int], dict[str, Any]],
    ) -> dict[str, Any]:
        """执行 judge 端口并记录结构化判定引用。"""

        report = judge_scene(draft, attempt)
        self.runs.append(
            NovelSkillRun(
                skill_name="judge",
                skill_version=self.definition_for("judge").version,
                status=str(report.get("status", "awaiting_review")),
                book_id=None,
                input_refs={"attempt": attempt},
                output_refs={
                    "judge_report_id": report.get("judge_report_id"),
                    "repair_patch_id": report.get("repair_patch_id"),
                    "decision": report.get("decision"),
                },
            )
        )
        return report

    def run_repair(
        self,
        *,
        draft: str,
        report: Mapping[str, Any],
        attempt: int,
        repair_scene: Callable[[str, Mapping[str, Any], int], str],
    ) -> str:
        """执行 repair 端口并记录修复尝试，不决定章节终态。"""

        repaired_draft = repair_scene(draft, report, attempt)
        self.runs.append(
            NovelSkillRun(
                skill_name="repair",
                skill_version=self.definition_for("repair").version,
                status="repaired",
                book_id=None,
                input_refs={"source_judge_report_id": report.get("judge_report_id"), "attempt": attempt},
                output_refs={"repair_patch_id": report.get("repair_patch_id"), "draft_hash": _draft_hash(repaired_draft)},
            )
        )
        return repaired_draft

    def run_approve(
        self,
        *,
        request: NovelLoopRequest,
        draft: str,
        refs: Mapping[str, Any],
        approve_scene: Callable[[NovelLoopRequest, str, dict[str, Any]], int],
    ) -> int:
        """执行 approve 端口并记录批准场景引用。"""

        approved_scene_id = approve_scene(request, draft, dict(refs))
        self._append_run(
            request=request,
            skill_name="approve",
            status="approved",
            input_refs={
                "chapter_id": request.chapter_id,
                "chapter_index": request.chapter_index,
                "source_model_run_id": refs.get("source_model_run_id"),
                "judge_report_id": refs.get("judge_report_id"),
            },
            output_refs={"approved_scene_id": approved_scene_id},
        )
        return approved_scene_id

    def run_memory_extract(
        self,
        *,
        request: NovelLoopRequest,
        draft: str,
        approved_scene_id: int,
        extract_memory: Callable[[NovelLoopRequest, str, int], list[str]],
    ) -> list[str]:
        """执行 memory_extract 端口，并区分默认跳过与真实写入。"""

        memory_atom_ids = extract_memory(request, draft, approved_scene_id)
        status = "memory_updated" if memory_atom_ids else "memory_extract_skipped"
        self._append_run(
            request=request,
            skill_name="memory_extract",
            status=status,
            input_refs={
                "chapter_id": request.chapter_id,
                "chapter_index": request.chapter_index,
                "approved_scene_id": approved_scene_id,
            },
            output_refs={"memory_atom_ids": tuple(memory_atom_ids)},
        )
        return memory_atom_ids

    def _append_run(
        self,
        *,
        request: NovelLoopRequest,
        skill_name: str,
        status: str,
        input_refs: dict[str, Any],
        output_refs: dict[str, Any],
    ) -> None:
        self.runs.append(
            NovelSkillRun(
                skill_name=skill_name,
                skill_version=self.definition_for(skill_name).version,
                status=status,
                book_id=request.book_id,
                chapter_index=request.chapter_index,
                input_refs=input_refs,
                output_refs=output_refs,
            )
        )


def _draft_hash(draft: str) -> str:
    """为草稿生成稳定摘要，避免把正文写入运行记录。"""

    return f"sha256:{sha256(draft.encode('utf-8')).hexdigest()}"
