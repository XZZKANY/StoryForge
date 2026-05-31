from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Any

from storyforge_workflow.skills.definitions import NovelSkillDefinition, NovelSkillRegistry


@dataclass(frozen=True)
class NovelSkillRun:
    """一次技能运行的引用化审计记录，不保存完整正文或 prompt。"""

    skill_name: str
    skill_version: str
    status: str
    book_id: int
    chapter_index: int | None = None
    input_refs: dict[str, Any] = field(default_factory=dict)
    output_refs: dict[str, Any] = field(default_factory=dict)
    budget: dict[str, int | float] = field(default_factory=dict)
    error_summary: str | None = None

    def to_audit_dict(self) -> dict[str, Any]:
        """返回可写入 progress 的纯引用摘要。"""

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
    """包装 NovelLoopPorts 调用并记录技能运行引用。"""

    def __init__(self, registry: NovelSkillRegistry) -> None:
        self._registry = registry
        self.runs: list[NovelSkillRun] = []

    @classmethod
    def default(cls) -> NovelSkillRunner:
        """使用默认小说技能链创建 runner。"""

        return cls(registry=NovelSkillRegistry.default())

    def definition_for(self, name: str) -> NovelSkillDefinition:
        """读取技能定义，供运行记录使用固定版本。"""

        return self._registry.get(name)

    def run_generate(
        self,
        *,
        request: Any,
        context_id: str,
        generate_scene: Callable[[Any, str], str],
        record_model_run: Callable[[Any, str], int],
    ) -> tuple[str, int]:
        """执行 generate 端口并记录 ModelRun 与草稿哈希引用。"""

        draft = generate_scene(request, context_id)
        model_run_id = record_model_run(request, draft)
        self._append_run(
            request=request,
            skill_name="generate",
            status="generated",
            input_refs={"compiled_context_id": context_id},
            output_refs={"model_run_id": model_run_id, "draft_hash": _draft_hash(draft)},
        )
        return draft, model_run_id

    def run_judge(
        self,
        *,
        draft: str,
        attempt: int,
        judge_scene: Callable[[str, int], dict[str, Any]],
        request: Any,
        model_run_id: int | None,
    ) -> dict[str, Any]:
        """执行 judge 端口并记录评审决策引用，不吞掉端口异常。"""

        report = judge_scene(draft, attempt)
        status = str(report.get("status") or "judge_failed")
        self._append_run(
            request=request,
            skill_name="judge",
            status=status,
            input_refs={"model_run_id": model_run_id, "draft_hash": _draft_hash(draft), "attempt": attempt},
            output_refs={
                "judge_report_id": _optional_ref(report.get("judge_report_id")),
                "repair_patch_id": _optional_ref(report.get("repair_patch_id")),
                "decision": status,
            },
        )
        return report

    def record_static_gate_blocked(
        self,
        *,
        request: Any,
        draft: str,
        model_run_id: int | None,
        static_issues: Sequence[Mapping[str, Any]],
    ) -> None:
        """记录静态质量门阻断，避免误表示为模型 judge 调用。"""

        self._append_run(
            request=request,
            skill_name="judge",
            status="static_gate_blocked",
            input_refs={"model_run_id": model_run_id, "draft_hash": _draft_hash(draft)},
            output_refs={
                "issue_count": len(static_issues),
                "max_severity": _max_severity(static_issues),
                "decision": "awaiting_review",
            },
        )

    def run_repair(
        self,
        *,
        draft: str,
        report: Mapping[str, Any],
        attempt: int,
        repair_scene: Callable[[str, Mapping[str, Any], int], str],
        request: Any,
    ) -> str:
        """执行 repair 端口并记录修复尝试，不制造 NovelLoop 终态。"""

        repaired = repair_scene(draft, dict(report), attempt)
        self._append_run(
            request=request,
            skill_name="repair",
            status="repaired",
            input_refs={"source_judge_report_id": _optional_ref(report.get("judge_report_id")), "draft_hash": _draft_hash(draft)},
            output_refs={
                "source_judge_report_id": _optional_ref(report.get("judge_report_id")),
                "attempt": attempt,
                "repair_patch_id": _optional_ref(report.get("repair_patch_id")),
                "revised_draft_hash": _draft_hash(repaired),
            },
        )
        return repaired

    def run_approve(
        self,
        *,
        request: Any,
        draft: str,
        refs: Mapping[str, Any],
        approve_scene: Callable[[Any, str, dict[str, Any]], int],
    ) -> int:
        """执行 approve 端口并记录批准后的 Scene 引用。"""

        normalized_refs = dict(refs)
        approved_scene_id = approve_scene(request, draft, normalized_refs)
        self._append_run(
            request=request,
            skill_name="approve",
            status="approved",
            input_refs={"final_draft_hash": _draft_hash(draft), **normalized_refs},
            output_refs={
                "approved_scene_id": approved_scene_id,
                "source_model_run_id": _optional_ref(normalized_refs.get("source_model_run_id")),
                "judge_report_id": _optional_ref(normalized_refs.get("judge_report_id")),
                "repair_patch_id": _optional_ref(normalized_refs.get("repair_patch_id")),
            },
        )
        return approved_scene_id

    def run_memory_extract(
        self,
        *,
        request: Any,
        draft: str,
        approved_scene_id: int,
        extract_memory: Callable[[Any, str, int], list[str]],
    ) -> list[str]:
        """执行 memory_extract 端口并区分真实更新与跳过。"""

        memory_atom_ids = list(extract_memory(request, draft, approved_scene_id))
        status = "memory_updated" if memory_atom_ids else "memory_extract_skipped"
        self._append_run(
            request=request,
            skill_name="memory_extract",
            status=status,
            input_refs={"approved_scene_id": approved_scene_id, "final_draft_hash": _draft_hash(draft)},
            output_refs={"approved_scene_id": approved_scene_id, "memory_atom_ids": memory_atom_ids},
        )
        return memory_atom_ids

    def audit_runs(self) -> list[dict[str, Any]]:
        """返回当前 runner 已记录的审计字典副本。"""

        return [run.to_audit_dict() for run in self.runs]

    def _append_run(
        self,
        *,
        request: Any,
        skill_name: str,
        status: str,
        input_refs: Mapping[str, Any],
        output_refs: Mapping[str, Any],
    ) -> None:
        definition = self.definition_for(skill_name)
        self.runs.append(
            NovelSkillRun(
                skill_name=definition.name,
                skill_version=definition.version,
                status=status,
                book_id=int(request.book_id),
                chapter_index=request.chapter_index,
                input_refs=_clean_refs(input_refs),
                output_refs=_clean_refs(output_refs),
            )
        )


def _draft_hash(draft: str) -> str:
    return f"sha256:{sha256(draft.encode('utf-8')).hexdigest()}"


def _optional_ref(value: Any) -> Any:
    return value if value is not None else None


def _clean_refs(refs: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in refs.items() if value is not None}


def _max_severity(issues: Sequence[Mapping[str, Any]]) -> str | None:
    severities = [str(issue.get("severity")) for issue in issues if issue.get("severity") is not None]
    return severities[0] if severities else None
