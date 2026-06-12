# StoryForge Narrative Contract Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next StoryForge narrative-control slice: critic contract verification, narrative fact extraction, fact-based collapse judging, prompt injection parity, commit-safe memory side effects, and ledger persistence.

**Architecture:** Keep the current prompt and gate architecture, but add a reusable `narrative.extract` layer that converts prose into structured `NarrativeSceneFact` objects. Draft prompts continue to receive ChapterBeat contracts; critic prompts and gates will verify contract fulfillment against extracted facts. Memory and continuity side effects move behind an explicit commit boundary so generated-but-uncommitted chapters cannot pollute long-run state.

**Tech Stack:** Python 3.11+, dataclasses, pytest, existing StoryForge workflow modules, existing FastAPI BookRun smoke sidecars, existing `uv` and `pnpm.cmd` commands.

---

## File Structure

- Modify `apps/workflow/storyforge_workflow/prompts/builder.py`: inject ChapterBeat into critique prompts and add critic output contract fields.
- Modify `apps/workflow/storyforge_workflow/state.py`: allow `scene_quality_plan` and `current_chapter_beat` to enter initial prompt injection while keeping checkpoints reference-only.
- Create `apps/workflow/storyforge_workflow/narrative/extract/__init__.py`: public exports for narrative fact extraction.
- Create `apps/workflow/storyforge_workflow/narrative/extract/facts.py`: `NarrativeSceneFact` dataclass plus normalization helpers.
- Create `apps/workflow/storyforge_workflow/narrative/extract/parser.py`: fail-soft JSON parser for LLM extraction output.
- Create `apps/workflow/storyforge_workflow/narrative/extract/prompt.py`: JSON-only prompt builder for prose-to-fact extraction.
- Modify `apps/workflow/storyforge_workflow/narrative/collapse_judge.py`: add `judge_fact()` while preserving existing `judge()` behavior.
- Modify `apps/workflow/storyforge_workflow/narrative/gate_harness.py`: accept extracted narrative facts and run fact-based collapse checks.
- Modify `apps/api/app/domains/book_runs/phase9c_narrative_smoke.py`: reuse workflow extraction heuristics for Phase9C prose scanning and expose contract-fulfillment sidecar fields.
- Modify `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`: add a compatibility flag to defer memory and continuity side effects.
- Modify `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: add commit-time side-effect hook and keep blocked/generated-but-uncommitted chapters side-effect-free.
- Modify `apps/workflow/storyforge_workflow/narrative/plan.py`: add repetition tracking config fields.
- Modify `apps/workflow/storyforge_workflow/narrative/repetition_ledger.py`: initialize thresholds from plan config and serialize/restore counts.
- Test `apps/workflow/tests/test_prompt_builder.py`: critic ChapterBeat contract assertions.
- Test `apps/workflow/tests/test_generation_state_references.py`: prompt injection key parity.
- Test `apps/workflow/tests/test_runtime_runner.py`: checkpoint excludes injected narrative fields.
- Test `apps/workflow/tests/test_narrative_extract.py`: fact dataclass, parser, prompt, and heuristic classification.
- Test `apps/workflow/tests/test_narrative_collapse_and_beat_sheet.py`: `judge_fact()` collapse behavior.
- Test `apps/workflow/tests/test_book_loop_three_chapters.py`: commit-time side effects and generated-but-uncommitted safety.
- Test `apps/workflow/tests/test_narrative_registries.py`: repetition ledger parameterization and persistence.
- Test `apps/api/tests/test_phase9c_narrative_smoke.py`: Phase9C sidecar/progress projection carries narrative contract evidence.

## Execution Notes

- Work in a dedicated branch or worktree. The current repository may already contain unrelated user changes; do not revert them.
- Use TDD for each task: write failing tests first, run the focused test, implement, rerun focused tests, then run the batch verification command for the task.
- Keep production behavior backward compatible until the commit-side-effect task. Existing tests must pass after every task.
- Do not run real 6/15/30 chapter smoke until all P0 tasks pass locally.

---

### Task 1: Critic Contract Prompt and Injection Parity

**Files:**
- Modify: `apps/workflow/storyforge_workflow/prompts/builder.py`
- Modify: `apps/workflow/storyforge_workflow/state.py`
- Test: `apps/workflow/tests/test_prompt_builder.py`
- Test: `apps/workflow/tests/test_generation_state_references.py`
- Test: `apps/workflow/tests/test_runtime_runner.py`

- [ ] **Step 1: Add failing prompt tests**

Append these tests to `apps/workflow/tests/test_prompt_builder.py`:

```python
def test_critique_prompt_injects_chapter_beat_contract() -> None:
    ctx = NarrativeContext(
        chapter_title="第八章：裂痕",
        scene_goal="林岚在对峙中为误判付出代价。",
        chapter_beat=ChapterBeatDirective(
            primary_scene_mode="character_conflict",
            forbidden_action_pattern="到新地点-问询-取得小物证-收入口袋-转向下一处",
            required_conflict_type="人物冲突",
            required_turning_point="周砚拒绝交出旧记录",
            protagonist_mistake="林岚误信灯塔账本",
            irreversible_consequence="证人保护资格被撤销",
            relationship_shift="林岚与周砚信任破裂",
            clue_usage_mode="reinterpret_existing",
            new_evidence_allowed=False,
        ),
    )

    prompt = build_critique_prompt(ctx, "林岚走进档案室，问完话后把记录收进口袋。")

    assert "【ChapterBeat 结构门槛】" in prompt
    assert "primary_scene_mode：character_conflict" in prompt
    assert "protagonist_mistake：林岚误信灯塔账本" in prompt
    assert "beat_fulfillment" in prompt
    assert "narrative_collapse" in prompt
    assert "BEAT_FULFILLMENT: yes|partial|no" in prompt
    assert "NARRATIVE_COLLAPSE: none|warning|soft_fail|hard_fail" in prompt
    assert "structure_repair" in prompt
    assert "convert_process_to_scene" in prompt
    assert "reinterpret_existing_clue" in prompt
```

Append this test to `apps/workflow/tests/test_generation_state_references.py` or the closest existing state test file:

```python
from storyforge_workflow.state import checkpoint_reference_state, initial_generation_state


def test_prompt_injection_accepts_narrative_contract_fields_without_checkpointing() -> None:
    state = initial_generation_state(
        thread_id="thread-narrative-contract",
        job_run_id="job-narrative-contract",
        premise="雾港旧案。",
        user_intent="验证叙事合同注入。",
        prompt_injection={
            "scene_quality_plan": {"conflict_turn": "周砚拒绝交出旧记录。"},
            "current_chapter_beat": {
                "primary_scene_mode": "character_conflict",
                "protagonist_mistake": "林岚误信灯塔账本",
                "irreversible_consequence": "证人保护资格被撤销",
            },
        },
    )

    assert state["scene_quality_plan"]["conflict_turn"] == "周砚拒绝交出旧记录。"
    assert state["current_chapter_beat"]["primary_scene_mode"] == "character_conflict"

    checkpoint = checkpoint_reference_state(dict(state))

    assert "scene_quality_plan" not in checkpoint
    assert "current_chapter_beat" not in checkpoint
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_prompt_builder.py::test_critique_prompt_injects_chapter_beat_contract -q
uv run pytest tests/test_generation_state_references.py::test_prompt_injection_accepts_narrative_contract_fields_without_checkpointing -q
```

Expected:

```text
FAILED ... assert '【ChapterBeat 结构门槛】' in prompt
FAILED ... KeyError or assertion failure for scene_quality_plan/current_chapter_beat
```

- [ ] **Step 3: Implement critic prompt contract**

In `apps/workflow/storyforge_workflow/prompts/builder.py`, update `build_critique_prompt()`:

```python
    score_dimensions = (
        "prose_quality",
        "show_dont_tell",
        "character_consistency",
        "continuity_consistency",
        "scene_progression",
        "pacing_control",
        "hook_strength",
        "beat_fulfillment",
        "narrative_collapse",
        "ai_artifact_penalty",
    )
```

Add `_chapter_beat_section(ctx)` between `_scene_quality_section(ctx)` and `_continuity_section(ctx)` in the `sections` list:

```python
        _position_section(ctx),
        _scene_quality_section(ctx),
        _chapter_beat_section(ctx),
        _continuity_section(ctx),
        _section("待审正文", [_clean(draft) or "（空）"]),
```

Add these lines to the `"评分维度"` section:

```python
                "beat_fulfillment：正文是否兑现 ChapterBeat 中的冲突、误判、代价、关系变化、旧线索解释与不可逆后果。",
                "narrative_collapse：是否落入到新地点、问询、取得物证、收好、转向下一处的默认调查模板，或删掉本章也不影响主线。",
```

Update the `"输出要求"` section:

```python
                "BEAT_FULFILLMENT: yes|partial|no",
                "NARRATIVE_COLLAPSE: none|warning|soft_fail|hard_fail",
                "ISSUE: 维度｜严重级别｜命中片段｜原因｜修订策略｜必须保留｜必须删除｜目标效果",
                "修订策略只能是 line_edit、scene_patch、regenerate、structure_repair、convert_process_to_scene、reinterpret_existing_clue；严重连续性或角色问题使用 awaiting_review。",
```

- [ ] **Step 4: Implement injection key parity**

In `apps/workflow/storyforge_workflow/state.py`, add fields to `_PROMPT_INJECTION_KEYS`:

```python
    "scene_quality_plan",
    "current_chapter_beat",
    "chapter_beat_directive",
```

Add the corresponding `GenerationState` optional fields:

```python
    scene_quality_plan: dict[str, Any]
    current_chapter_beat: dict[str, Any]
    chapter_beat_directive: dict[str, Any]
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_prompt_builder.py::test_critique_prompt_injects_chapter_beat_contract tests/test_generation_state_references.py::test_prompt_injection_accepts_narrative_contract_fields_without_checkpointing -q
```

Expected:

```text
2 passed
```

- [ ] **Step 6: Run prompt/state regression**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_prompt_builder.py tests/test_generation_state_references.py tests/test_runtime_runner.py -q
```

Expected:

```text
passed
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/workflow/storyforge_workflow/prompts/builder.py apps/workflow/storyforge_workflow/state.py apps/workflow/tests/test_prompt_builder.py apps/workflow/tests/test_generation_state_references.py apps/workflow/tests/test_runtime_runner.py
git commit -m "feat(workflow): verify narrative contracts in critique prompts"
```

---

### Task 2: Narrative Fact Extraction Package

**Files:**
- Create: `apps/workflow/storyforge_workflow/narrative/extract/__init__.py`
- Create: `apps/workflow/storyforge_workflow/narrative/extract/facts.py`
- Create: `apps/workflow/storyforge_workflow/narrative/extract/parser.py`
- Create: `apps/workflow/storyforge_workflow/narrative/extract/prompt.py`
- Test: `apps/workflow/tests/test_narrative_extract.py`

- [ ] **Step 1: Write failing extraction tests**

Create `apps/workflow/tests/test_narrative_extract.py`:

```python
from __future__ import annotations

from storyforge_workflow.narrative.extract import (
    NarrativeSceneFact,
    build_narrative_fact_extract_prompt,
    parse_narrative_scene_fact,
)
from storyforge_workflow.prompts.models import NarrativeContext


def test_parse_narrative_scene_fact_normalizes_single_object() -> None:
    payload = """
    {
      "chapter": 8,
      "primary_scene_mode": "character_conflict",
      "action_sequence": ["对峙", "误判", "失去证人保护资格"],
      "conflict_type": "人物冲突",
      "protagonist_mistake": "林岚误信灯塔账本",
      "cost": "证人保护资格被撤销",
      "relationship_delta": "林岚与周砚信任破裂",
      "irreversible_consequence": "证人保护资格被撤销",
      "clue_usage_mode": "reinterpret_existing",
      "new_evidence": [],
      "existing_clues_reinterpreted": ["黑盒"],
      "deletable": false
    }
    """

    fact = parse_narrative_scene_fact(payload, default_chapter=8)

    assert fact == NarrativeSceneFact(
        chapter=8,
        primary_scene_mode="character_conflict",
        action_sequence=("对峙", "误判", "失去证人保护资格"),
        conflict_type="人物冲突",
        protagonist_mistake="林岚误信灯塔账本",
        cost="证人保护资格被撤销",
        relationship_delta="林岚与周砚信任破裂",
        irreversible_consequence="证人保护资格被撤销",
        clue_usage_mode="reinterpret_existing",
        new_evidence=(),
        existing_clues_reinterpreted=("黑盒",),
        deletable=False,
        extraction_failed=False,
    )


def test_parse_narrative_scene_fact_fail_soft_on_bad_json() -> None:
    fact = parse_narrative_scene_fact("not json", default_chapter=12)

    assert fact.chapter == 12
    assert fact.extraction_failed is True
    assert fact.extraction_error == "invalid_json"


def test_build_narrative_fact_extract_prompt_requests_json_only() -> None:
    ctx = NarrativeContext(chapter_title="第八章", scene_goal="用旧线索制造关系破裂。")
    prompt = build_narrative_fact_extract_prompt(ctx, "林岚没有去新地点，她把黑盒旧记录重新解释。", chapter=8)

    assert "Return only a valid JSON object" in prompt
    assert "primary_scene_mode" in prompt
    assert "relationship_delta" in prompt
    assert "existing_clues_reinterpreted" in prompt
    assert "待抽取正文" in prompt
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_narrative_extract.py -q
```

Expected:

```text
ModuleNotFoundError: No module named 'storyforge_workflow.narrative.extract'
```

- [ ] **Step 3: Create fact dataclass**

Create `apps/workflow/storyforge_workflow/narrative/extract/facts.py`:

```python
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


def clean_text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ("" if value is None else str(value).strip())


def clean_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        item = value.strip()
        return (item,) if item else ()
    if isinstance(value, Sequence) and not isinstance(value, bytes):
        return tuple(clean_text(item) for item in value if clean_text(item))
    return ()


@dataclass(frozen=True)
class NarrativeSceneFact:
    chapter: int
    primary_scene_mode: str = ""
    action_sequence: tuple[str, ...] = ()
    conflict_type: str = ""
    protagonist_mistake: str = ""
    cost: str = ""
    relationship_delta: str = ""
    irreversible_consequence: str = ""
    clue_usage_mode: str = ""
    new_evidence: tuple[str, ...] = ()
    existing_clues_reinterpreted: tuple[str, ...] = ()
    deletable: bool = False
    extraction_failed: bool = False
    extraction_error: str = ""

    @classmethod
    def failed(cls, *, chapter: int, error: str) -> "NarrativeSceneFact":
        return cls(chapter=chapter, extraction_failed=True, extraction_error=error)
```

- [ ] **Step 4: Create parser**

Create `apps/workflow/storyforge_workflow/narrative/extract/parser.py`:

```python
from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from storyforge_workflow.narrative.extract.facts import NarrativeSceneFact, clean_text, clean_tuple


def parse_narrative_scene_fact(raw: str, *, default_chapter: int) -> NarrativeSceneFact:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return NarrativeSceneFact.failed(chapter=default_chapter, error="invalid_json")
    if isinstance(payload, list):
        payload = payload[0] if payload and isinstance(payload[0], Mapping) else {}
    if not isinstance(payload, Mapping):
        return NarrativeSceneFact.failed(chapter=default_chapter, error="invalid_shape")
    return _fact_from_mapping(payload, default_chapter=default_chapter)


def _fact_from_mapping(payload: Mapping[str, Any], *, default_chapter: int) -> NarrativeSceneFact:
    chapter = payload.get("chapter", default_chapter)
    if isinstance(chapter, bool) or not isinstance(chapter, int) or chapter <= 0:
        chapter = default_chapter
    return NarrativeSceneFact(
        chapter=chapter,
        primary_scene_mode=clean_text(payload.get("primary_scene_mode")),
        action_sequence=clean_tuple(payload.get("action_sequence")),
        conflict_type=clean_text(payload.get("conflict_type")),
        protagonist_mistake=clean_text(payload.get("protagonist_mistake")),
        cost=clean_text(payload.get("cost")),
        relationship_delta=clean_text(payload.get("relationship_delta")),
        irreversible_consequence=clean_text(payload.get("irreversible_consequence")),
        clue_usage_mode=clean_text(payload.get("clue_usage_mode")),
        new_evidence=clean_tuple(payload.get("new_evidence")),
        existing_clues_reinterpreted=clean_tuple(payload.get("existing_clues_reinterpreted")),
        deletable=bool(payload.get("deletable", False)),
    )
```

- [ ] **Step 5: Create prompt builder and exports**

Create `apps/workflow/storyforge_workflow/narrative/extract/prompt.py`:

```python
from __future__ import annotations

from storyforge_workflow.prompts.models import NarrativeContext


def _clean(value: str | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _section(title: str, lines: list[str]) -> str:
    body = [line.strip() for line in lines if line.strip()]
    return "" if not body else "【" + title + "】\n" + "\n".join(body)


def build_narrative_fact_extract_prompt(ctx: NarrativeContext, draft: str, *, chapter: int) -> str:
    sections = [
        (
            "Task: Extract narrative contract facts from a Chinese novel chapter. "
            "Return only a valid JSON object. No markdown fences, no commentary."
        ),
        _section(
            "任务",
            [
                "只根据正文抽取叙事事实，不要复述计划，不要脑补正文没有写出的内容。",
                "缺失字段用空字符串、空数组或 false。",
            ],
        ),
        _section(
            "章节位置",
            [
                f"chapter: {chapter}",
                f"chapter_title: {_clean(ctx.chapter_title)}",
                f"scene_goal: {_clean(ctx.scene_goal)}",
            ],
        ),
        _section("待抽取正文", [_clean(draft) or "（空）"]),
        _section(
            "输出 JSON 字段",
            [
                '"chapter": 整数',
                '"primary_scene_mode": "character_conflict|misjudgment_cost|relationship_shift|clue_reinterpretation|investigation_fetch_loop|closing|unknown"',
                '"action_sequence": ["按正文顺序列出 3-8 个动作或转折"]',
                '"conflict_type": "人物冲突/误判代价/旧线索反转/新增取证/收束/未知"',
                '"protagonist_mistake": "主角误判；没有则空字符串"',
                '"cost": "主角付出的具体代价；没有则空字符串"',
                '"relationship_delta": "关系变化；没有则空字符串"',
                '"irreversible_consequence": "不可逆后果；没有则空字符串"',
                '"clue_usage_mode": "reinterpret_existing|contradict_existing|pay_off_existing|introduce_new|none"',
                '"new_evidence": ["正文新增的核心物证；没有则空数组"]',
                '"existing_clues_reinterpreted": ["被重新解释的旧线索；没有则空数组"]',
                '"deletable": true 或 false，表示删掉本章是否基本不影响主线',
            ],
        ),
    ]
    return "\n\n".join(section for section in sections if section)
```

Create `apps/workflow/storyforge_workflow/narrative/extract/__init__.py`:

```python
from storyforge_workflow.narrative.extract.facts import NarrativeSceneFact
from storyforge_workflow.narrative.extract.parser import parse_narrative_scene_fact
from storyforge_workflow.narrative.extract.prompt import build_narrative_fact_extract_prompt

__all__ = [
    "NarrativeSceneFact",
    "build_narrative_fact_extract_prompt",
    "parse_narrative_scene_fact",
]
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_narrative_extract.py -q
```

Expected:

```text
3 passed
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/workflow/storyforge_workflow/narrative/extract apps/workflow/tests/test_narrative_extract.py
git commit -m "feat(workflow): add narrative scene fact extraction"
```

---

### Task 3: Fact-Based Collapse Judge

**Files:**
- Modify: `apps/workflow/storyforge_workflow/narrative/collapse_judge.py`
- Modify: `apps/workflow/storyforge_workflow/narrative/gate_harness.py`
- Test: `apps/workflow/tests/test_narrative_collapse_and_beat_sheet.py`

- [ ] **Step 1: Add failing fact collapse tests**

Append to `apps/workflow/tests/test_narrative_collapse_and_beat_sheet.py`:

```python
from storyforge_workflow.narrative.extract import NarrativeSceneFact


def test_collapse_judge_fact_warns_on_weighted_fetch_loop_without_cost() -> None:
    fact = NarrativeSceneFact(
        chapter=8,
        primary_scene_mode="investigation_fetch_loop",
        action_sequence=("来到档案室", "询问管理员", "查看记录", "收进口袋"),
        conflict_type="新增取证",
        clue_usage_mode="introduce_new",
        new_evidence=("登记表",),
    )

    verdict = NarrativeCollapseJudge().judge_fact(fact)

    assert verdict.status == "warn"
    assert any("正文调查模板" in issue["message"] for issue in verdict.issues)
    assert any(issue["revision_strategy"] == "convert_process_to_scene" for issue in verdict.issues)


def test_collapse_judge_fact_passes_fetch_actions_with_real_cost_and_relationship_delta() -> None:
    fact = NarrativeSceneFact(
        chapter=9,
        primary_scene_mode="misjudgment_cost",
        action_sequence=("查看旧账本", "误信记录", "与周砚争执", "失去通行口令"),
        conflict_type="主角误判造成实际代价",
        protagonist_mistake="林岚误信灯塔账本",
        cost="通行口令被撤销",
        relationship_delta="林岚与周砚信任破裂",
        irreversible_consequence="通行口令被撤销",
        clue_usage_mode="reinterpret_existing",
        existing_clues_reinterpreted=("旧账本",),
    )

    verdict = NarrativeCollapseJudge().judge_fact(fact)

    assert verdict.status == "pass"
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_narrative_collapse_and_beat_sheet.py::test_collapse_judge_fact_warns_on_weighted_fetch_loop_without_cost tests/test_narrative_collapse_and_beat_sheet.py::test_collapse_judge_fact_passes_fetch_actions_with_real_cost_and_relationship_delta -q
```

Expected:

```text
AttributeError: 'NarrativeCollapseJudge' object has no attribute 'judge_fact'
```

- [ ] **Step 3: Implement `judge_fact()`**

In `apps/workflow/storyforge_workflow/narrative/collapse_judge.py`, add import:

```python
from storyforge_workflow.narrative.extract import NarrativeSceneFact
```

Add method to `NarrativeCollapseJudge`:

```python
    def judge_fact(
        self,
        fact: NarrativeSceneFact,
        *,
        phase_policy: NarrativePhasePolicy | None = None,
        new_core_entities: Mapping[str, Sequence[str]] | None = None,
    ) -> GateVerdict:
        if fact.extraction_failed:
            return GateVerdict(
                status="warn",
                issues=[
                    issue(
                        "叙事塌缩",
                        f"narrative extract failed: {fact.extraction_error}",
                        severity="低",
                        revision_strategy="manual_review",
                    )
                ],
            )
        soft_issues: list[dict[str, str]] = []
        hard_issues: list[dict[str, str]] = []
        score = _investigation_template_score(fact)
        has_advancement = bool(fact.cost or fact.relationship_delta or fact.irreversible_consequence)
        if fact.deletable:
            soft_issues.append(
                issue(
                    "叙事塌缩",
                    f"deletable chapter: chapter {fact.chapter}",
                    severity="中",
                    revision_strategy="delete_or_merge_recommendation",
                )
            )
        if score >= 3 and not has_advancement:
            self._investigation_template_chapters.append(fact.chapter)
            soft_issues.append(
                issue(
                    "叙事塌缩",
                    "正文调查模板：到场/问询/查看/取证/收好/转场命中>=3，且缺少代价、关系变化或不可逆后果",
                    severity="中",
                    snippet=" / ".join(fact.action_sequence),
                    suggestion="改成误判、代价、关系转折或既有物证的新解释。",
                    revision_strategy="convert_process_to_scene",
                )
            )
        else:
            self._investigation_template_chapters.append(-fact.chapter)
            self._investigation_template_chapters = [
                item for item in self._investigation_template_chapters if item > fact.chapter - 4
            ]
        if not fact.irreversible_consequence:
            soft_issues.append(issue("叙事塌缩", "no irreversible consequence", severity="中"))
        if (
            phase_policy
            and phase_policy.phase == "收束"
            and not phase_policy.allowed_expansion
            and any(values for values in (new_core_entities or {}).values())
        ):
            hard_issues.append(issue("叙事塌缩", "phase says收束 but chapter expands"))
        if hard_issues:
            return verdict_from_issues([*hard_issues, *soft_issues])
        return verdict_from_issues(soft_issues, warn_only=True)
```

Add helper function:

```python
def _investigation_template_score(fact: NarrativeSceneFact) -> int:
    joined = " ".join([fact.primary_scene_mode, fact.conflict_type, fact.clue_usage_mode, *fact.action_sequence])
    buckets = (
        ("到新地点", "到场", "抵达", "来到", "转入", "进入", "走进", "回到"),
        ("问询", "询问", "问话", "盘问", "问", "递过去"),
        ("取物证", "取证", "取得物证", "拿到物证", "查看记录", "查看", "翻", "比对", "查"),
        ("收入口袋", "保存", "收好", "收进内袋", "装进口袋", "归档", "加密", "同步", "合上"),
        ("转下个地点", "转场", "离开", "前往", "转去下一处", "转身", "朝", "往"),
    )
    score = sum(1 for terms in buckets if any(term in joined for term in terms))
    if fact.primary_scene_mode == "investigation_fetch_loop":
        score = max(score, 3)
    if fact.clue_usage_mode == "introduce_new" and fact.new_evidence:
        score = max(score, 3)
    return score
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_narrative_collapse_and_beat_sheet.py::test_collapse_judge_fact_warns_on_weighted_fetch_loop_without_cost tests/test_narrative_collapse_and_beat_sheet.py::test_collapse_judge_fact_passes_fetch_actions_with_real_cost_and_relationship_delta -q
```

Expected:

```text
2 passed
```

- [ ] **Step 5: Wire fact input into gate harness**

In `apps/workflow/storyforge_workflow/narrative/gate_harness.py`, import:

```python
from storyforge_workflow.narrative.extract import NarrativeSceneFact
```

Add field to `NarrativeGateInput`:

```python
    narrative_fact: NarrativeSceneFact | None = None
```

Inside `NarrativeGateHarness.evaluate()`, before the existing `collapse_beats` branch, add:

```python
        if gate_input.narrative_fact is not None:
            verdict = self.collapse_judge.judge_fact(
                gate_input.narrative_fact,
                phase_policy=self.plan.phase_policy,
                new_core_entities=gate_input.narrative_fact.new_evidence and {"evidence": gate_input.narrative_fact.new_evidence},
            )
            if verdict.status != "pass":
                issues.extend(verdict.issues)
                if verdict.status == "fail":
                    hard_reasons.extend(_issue_messages(verdict))
                else:
                    soft_reasons.extend(_issue_messages(verdict))
```

- [ ] **Step 6: Run narrative regression**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_narrative_collapse_and_beat_sheet.py tests/test_narrative_30ch_regression_fixtures.py -q
```

Expected:

```text
passed
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/workflow/storyforge_workflow/narrative/collapse_judge.py apps/workflow/storyforge_workflow/narrative/gate_harness.py apps/workflow/tests/test_narrative_collapse_and_beat_sheet.py
git commit -m "feat(workflow): judge narrative collapse from extracted facts"
```

---

### Task 4: Phase9C Uses Shared Narrative Fact Heuristics

**Files:**
- Modify: `apps/api/app/domains/book_runs/phase9c_narrative_smoke.py`
- Test: `apps/api/tests/test_phase9c_narrative_smoke.py`

- [ ] **Step 1: Add failing API smoke projection test**

Append to `apps/api/tests/test_phase9c_narrative_smoke.py`:

```python
from app.domains.book_runs.phase9c_narrative_smoke import _auto_gate_results_from_book_export


def test_phase9c_auto_gate_results_include_contract_evidence_fields() -> None:
    book_export = """
## 第 1 章
林岚来到档案室，询问管理员，查看记录，把登记表收进口袋，转身前往旧港。
## 第 2 章
林岚走进冷库，询问守门人，翻看册子，收好金属片，离开冷库。
## 第 3 章
林岚回到灯塔，问完话，查看日志，把纸页收进内袋，朝码头走去。
"""

    results = _auto_gate_results_from_book_export(book_export)

    collapse = next(item for item in results if item["gate"] == "collapse_judge")
    assert collapse["revision_type"] == "structure_revision"
    assert collapse["contract_evidence"]["template_chapters"] == [1, 2, 3]
    assert collapse["contract_evidence"]["source"] == "narrative_fact_heuristic"
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
cd apps/api
uv run pytest tests/test_phase9c_narrative_smoke.py::test_phase9c_auto_gate_results_include_contract_evidence_fields -q
```

Expected:

```text
KeyError: 'contract_evidence'
```

- [ ] **Step 3: Add contract evidence payload**

In `apps/api/app/domains/book_runs/phase9c_narrative_smoke.py`, update the collapse result built by `_auto_gate_results_from_book_export()`:

```python
                "contract_evidence": {
                    "source": "narrative_fact_heuristic",
                    "template_chapters": template_chapters,
                    "required_fields": [
                        "cost",
                        "relationship_delta",
                        "irreversible_consequence",
                        "existing_clues_reinterpreted",
                    ],
                },
```

- [ ] **Step 4: Run API focused tests**

Run:

```powershell
cd apps/api
uv run pytest tests/test_phase9c_narrative_smoke.py -q
```

Expected:

```text
passed
```

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/api/app/domains/book_runs/phase9c_narrative_smoke.py apps/api/tests/test_phase9c_narrative_smoke.py
git commit -m "feat(api): expose narrative contract evidence in phase9c smoke"
```

---

### Task 5: Commit-Time Memory and Continuity Side Effects

**Files:**
- Modify: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
- Modify: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
- Modify: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
- Test: `apps/workflow/tests/test_novel_loop_single_chapter.py`
- Test: `apps/workflow/tests/test_book_loop_three_chapters.py`
- Test: `apps/workflow/tests/test_book_run_adapter.py`

- [ ] **Step 1: Add failing NovelLoop deferral test**

Append to `apps/workflow/tests/test_novel_loop_single_chapter.py`:

```python
def test_single_chapter_loop_can_defer_memory_and_continuity_side_effects() -> None:
    memory_calls: list[int] = []
    continuity_calls: list[int] = []

    ports = _ports(
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 20},
        approve_scene=lambda request, draft, refs: 30,
        extract_memory=lambda request, draft, approved_scene_id: memory_calls.append(approved_scene_id) or ["m1"],
        submit_continuity=lambda request, draft, approved_scene_id: continuity_calls.append(approved_scene_id)
        or {"continuity_edge_count": 2},
    )

    result = run_single_chapter_loop(_request(), ports, defer_commit_side_effects=True)

    assert result.status == "approved"
    assert result.approved_scene_id == 30
    assert result.memory_atom_ids == []
    assert result.continuity_edge_count == 0
    assert memory_calls == []
    assert continuity_calls == []
```

Use the existing helper names in `test_novel_loop_single_chapter.py`; if helpers differ, keep the assertions and map to the local helper names already present in that file.

- [ ] **Step 2: Add failing BookLoop commit hook test**

Append to `apps/workflow/tests/test_book_loop_three_chapters.py`:

```python
def test_book_loop_runs_commit_side_effects_only_for_committed_chapters() -> None:
    committed_side_effects: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
        )

    def consistency_barrier(chapter_index, chapter_result, committed_chapters):
        if chapter_index == 2:
            return ChapterConsistencyReport(conflicts=[{"kind": "gate_block"}])
        return ChapterConsistencyReport(conflicts=[])

    def commit_side_effects(chapter_index, chapter_result, committed_chapters):
        committed_side_effects.append(chapter_index)
        return NovelLoopResult(
            status=chapter_result.status,
            final_draft=chapter_result.final_draft,
            source_model_run_id=chapter_result.source_model_run_id,
            judge_report_id=chapter_result.judge_report_id,
            repair_patch_id=chapter_result.repair_patch_id,
            approved_scene_id=chapter_result.approved_scene_id,
            token_usage=chapter_result.token_usage,
            elapsed_time_sec=chapter_result.elapsed_time_sec,
            cost_estimate=chapter_result.cost_estimate,
            fallback_metadata=chapter_result.fallback_metadata,
            memory_atom_ids=[f"m{chapter_index}"],
            continuity_edge_count=chapter_index,
            skill_runs=chapter_result.skill_runs,
        )

    result = run_book_loop(
        BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3, chapter_parallelism=3),
        run_chapter,
        consistency_barrier=consistency_barrier,
        commit_chapter_side_effects=commit_side_effects,
    )

    assert result.status == "awaiting_review"
    assert committed_side_effects == [1]
    assert result.progress["checkpoint"][0]["memory_atom_ids"] == ["m1"]
    assert result.progress["generated_but_uncommitted"] == [{"chapter_index": 3, "status": "generated"}]
```

- [ ] **Step 3: Run failing tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_novel_loop_single_chapter.py::test_single_chapter_loop_can_defer_memory_and_continuity_side_effects tests/test_book_loop_three_chapters.py::test_book_loop_runs_commit_side_effects_only_for_committed_chapters -q
```

Expected:

```text
TypeError: run_single_chapter_loop() got an unexpected keyword argument 'defer_commit_side_effects'
TypeError: run_book_loop() got an unexpected keyword argument 'commit_chapter_side_effects'
```

- [ ] **Step 4: Add NovelLoop deferral flag**

In `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`, update the function signature:

```python
def run_single_chapter_loop(
    request: NovelLoopRequest,
    ports: NovelLoopPorts,
    *,
    max_repairs: int = 1,
    skill_runner: NovelSkillRunnerPort | None = None,
    defer_commit_side_effects: bool = False,
) -> NovelLoopResult:
```

Inside the pass branch, after `approved_scene_id` is known, replace immediate memory/continuity calls with:

```python
            if defer_commit_side_effects:
                memory_atom_ids: list[str] = []
                continuity_result: dict[str, Any] = {}
            elif skill_runner is None:
                memory_atom_ids = ports.extract_memory(request, draft, approved_scene_id)
                continuity_result = ports.submit_continuity(request, draft, approved_scene_id)
            else:
                memory_atom_ids = skill_runner.run_memory_extract(
                    request=request,
                    draft=draft,
                    approved_scene_id=approved_scene_id,
                    extract_memory=ports.extract_memory,
                )
                continuity_result = skill_runner.run_submit_continuity(
                    request=request,
                    draft=draft,
                    approved_scene_id=approved_scene_id,
                    submit_continuity=ports.submit_continuity,
                )
```

Keep `approve_scene()` before this block so approval IDs are still available.

- [ ] **Step 5: Add BookLoop commit hook**

In `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`, add type alias:

```python
CommitChapterSideEffects = Callable[[int, NovelLoopResult, list[dict[str, Any]]], NovelLoopResult]
```

Update `run_book_loop()` and `_run_book_loop_parallel()` signatures:

```python
    commit_chapter_side_effects: CommitChapterSideEffects | None = None,
```

After consistency barrier passes and before `_chapter_progress()`, run:

```python
        chapter_result = _run_commit_chapter_side_effects(
            commit_chapter_side_effects,
            chapter_index,
            chapter_result,
            completed,
        )
```

In parallel path, use `next_commit_index` in the same place after the consistency barrier passes:

```python
                chapter_result = _run_commit_chapter_side_effects(
                    commit_chapter_side_effects,
                    next_commit_index,
                    chapter_result,
                    completed,
                )
```

Add helper:

```python
def _run_commit_chapter_side_effects(
    commit_chapter_side_effects: CommitChapterSideEffects | None,
    chapter_index: int,
    chapter_result: NovelLoopResult,
    committed_chapters: list[dict[str, Any]],
) -> NovelLoopResult:
    if commit_chapter_side_effects is None:
        return chapter_result
    return commit_chapter_side_effects(chapter_index, chapter_result, list(committed_chapters))
```

- [ ] **Step 6: Wire adapter to use deferral only when supported**

In `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`, locate the call to `run_single_chapter_loop()`. Add `defer_commit_side_effects=True` only if the adapter also passes a `commit_chapter_side_effects` callback to `run_book_loop()`. The callback must call the existing memory and continuity ports with `chapter_result.final_draft` and `chapter_result.approved_scene_id`, then return a copied `NovelLoopResult` with `memory_atom_ids`, `continuity_edge_count`, and merged `skill_runs`.

Use this shape:

```python
def _commit_side_effects(
    chapter_index: int,
    chapter_result: NovelLoopResult,
    committed_chapters: list[dict[str, Any]],
) -> NovelLoopResult:
    if chapter_result.approved_scene_id is None:
        return chapter_result
    memory_atom_ids = ports.extract_memory(request_for_chapter(chapter_index), chapter_result.final_draft, chapter_result.approved_scene_id)
    continuity_result = ports.submit_continuity(request_for_chapter(chapter_index), chapter_result.final_draft, chapter_result.approved_scene_id)
    return NovelLoopResult(
        status=chapter_result.status,
        final_draft=chapter_result.final_draft,
        source_model_run_id=chapter_result.source_model_run_id,
        judge_report_id=chapter_result.judge_report_id,
        repair_patch_id=chapter_result.repair_patch_id,
        approved_scene_id=chapter_result.approved_scene_id,
        token_usage=chapter_result.token_usage,
        elapsed_time_sec=chapter_result.elapsed_time_sec,
        cost_estimate=chapter_result.cost_estimate,
        fallback_metadata=chapter_result.fallback_metadata,
        memory_atom_ids=list(memory_atom_ids),
        continuity_edge_count=_optional_int(continuity_result.get("continuity_edge_count")) or 0,
        skill_runs=chapter_result.skill_runs,
    )
```

If the adapter currently lacks a clean `request_for_chapter()` helper, create one in the adapter from the same data used to call `run_single_chapter_loop()`.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_book_run_adapter.py -q
```

Expected:

```text
passed
```

- [ ] **Step 8: Commit**

Run:

```powershell
git add apps/workflow/storyforge_workflow/orchestrators/novel_loop.py apps/workflow/storyforge_workflow/orchestrators/book_loop.py apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py apps/workflow/tests/test_novel_loop_single_chapter.py apps/workflow/tests/test_book_loop_three_chapters.py apps/workflow/tests/test_book_run_adapter.py
git commit -m "feat(workflow): defer chapter side effects until book commit"
```

---

### Task 6: Repetition Ledger Parameterization and Persistence

**Files:**
- Modify: `apps/workflow/storyforge_workflow/narrative/plan.py`
- Modify: `apps/workflow/storyforge_workflow/narrative/repetition_ledger.py`
- Modify: `apps/workflow/storyforge_workflow/narrative/gate_harness.py`
- Test: `apps/workflow/tests/test_narrative_plan.py`
- Test: `apps/workflow/tests/test_narrative_registries.py`

- [ ] **Step 1: Add failing plan and ledger tests**

Append to `apps/workflow/tests/test_narrative_plan.py`:

```python
def test_narrative_plan_parses_repetition_policy() -> None:
    plan = NarrativePlan.from_dict(
        {
            "premise": "x",
            "truth": "y",
            "protagonist_arc": "z",
            "antagonist_motive": "m",
            "repetition_policy": {
                "tracked_motifs": [{"key": "old_wound", "terms": ["旧伤"], "threshold": 2}],
                "tracked_action_patterns": [{"key": "archive_loop", "terms": ["归档", "同步"], "threshold": 1}],
            },
        }
    )

    assert plan.repetition_policy.tracked_motifs[0].key == "old_wound"
    assert plan.repetition_policy.tracked_motifs[0].terms == ("旧伤",)
    assert plan.repetition_policy.tracked_action_patterns[0].threshold == 1
```

Append to `apps/workflow/tests/test_narrative_registries.py`:

```python
from storyforge_workflow.narrative.plan import RepetitionPattern, RepetitionPolicy
from storyforge_workflow.narrative.repetition_ledger import RepetitionLedger


def test_repetition_ledger_uses_plan_thresholds_and_restores_state() -> None:
    policy = RepetitionPolicy(
        tracked_motifs=(RepetitionPattern(key="old_wound", terms=("旧伤",), threshold=2),),
        tracked_action_patterns=(RepetitionPattern(key="archive_loop", terms=("归档", "同步"), threshold=1),),
    )
    ledger = RepetitionLedger(policy=policy)

    assert ledger.record_motif(chapter=1, motif="旧伤发作", changes_action=False).status == "pass"
    assert ledger.record_motif(chapter=2, motif="旧伤发作", changes_action=False).status == "pass"
    assert ledger.record_motif(chapter=3, motif="旧伤发作", changes_action=False).status == "fail"

    restored = RepetitionLedger.from_dict(ledger.to_dict(), policy=policy)

    assert restored.record_action_pattern(chapter=4, pattern="归档并同步").status == "pass"
    assert restored.record_action_pattern(chapter=5, pattern="归档并同步").status == "fail"
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_narrative_plan.py::test_narrative_plan_parses_repetition_policy tests/test_narrative_registries.py::test_repetition_ledger_uses_plan_thresholds_and_restores_state -q
```

Expected:

```text
ImportError or AttributeError for RepetitionPolicy/RepetitionPattern
```

- [ ] **Step 3: Add repetition policy schema**

In `apps/workflow/storyforge_workflow/narrative/plan.py`, add:

```python
@dataclass(frozen=True)
class RepetitionPattern:
    key: str
    terms: tuple[str, ...] = ()
    threshold: int = 3

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "RepetitionPattern":
        return cls(
            key=str(data.get("key") or "").strip(),
            terms=_string_tuple(data.get("terms")),
            threshold=max(1, int(data.get("threshold", 3))),
        )


@dataclass(frozen=True)
class RepetitionPolicy:
    tracked_motifs: tuple[RepetitionPattern, ...] = ()
    tracked_action_patterns: tuple[RepetitionPattern, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> "RepetitionPolicy":
        if not data:
            return cls()
        return cls(
            tracked_motifs=tuple(
                RepetitionPattern.from_dict(item) for item in _mapping_sequence(data.get("tracked_motifs"))
            ),
            tracked_action_patterns=tuple(
                RepetitionPattern.from_dict(item) for item in _mapping_sequence(data.get("tracked_action_patterns"))
            ),
        )
```

Add field to `NarrativePlan`:

```python
    repetition_policy: RepetitionPolicy = field(default_factory=RepetitionPolicy)
```

Parse in `from_dict()`:

```python
            repetition_policy=RepetitionPolicy.from_dict(_maybe_mapping(data.get("repetition_policy"))),
```

Add to `compact_summary()`:

```python
            "repetition_policy": {
                "tracked_motif_count": len(self.repetition_policy.tracked_motifs),
                "tracked_action_pattern_count": len(self.repetition_policy.tracked_action_patterns),
            },
```

- [ ] **Step 4: Parameterize and serialize ledger**

In `apps/workflow/storyforge_workflow/narrative/repetition_ledger.py`, update imports and class:

```python
from storyforge_workflow.narrative.plan import RepetitionPattern, RepetitionPolicy
```

Add constructor helpers:

```python
    def __init__(self, *, policy: RepetitionPolicy | None = None) -> None:
        self.policy = policy or RepetitionPolicy()
        self._static_motif_counts: defaultdict[str, int] = defaultdict(int)
        self._action_counts: defaultdict[str, int] = defaultdict(int)

    @classmethod
    def from_dict(cls, data: dict[str, object], *, policy: RepetitionPolicy | None = None) -> "RepetitionLedger":
        ledger = cls(policy=policy)
        for key, value in _count_mapping(data.get("static_motif_counts")).items():
            ledger._static_motif_counts[key] = value
        for key, value in _count_mapping(data.get("action_counts")).items():
            ledger._action_counts[key] = value
        return ledger

    def to_dict(self) -> dict[str, dict[str, int]]:
        return {
            "static_motif_counts": dict(self._static_motif_counts),
            "action_counts": dict(self._action_counts),
        }
```

Replace hard-coded checks with policy-aware checks while retaining fallback:

```python
        pattern = _matching_pattern(motif, self.policy.tracked_motifs)
        if pattern is not None and self._static_motif_counts[motif] > pattern.threshold:
            return GateVerdict(
                status="fail",
                issues=[issue("重复账本", f"{pattern.key} motif repeated >{pattern.threshold}", snippet=motif)],
            )
        if pattern is None and _is_left_arm_old_injury(motif) and self._static_motif_counts[motif] > 5:
            ...
```

For actions:

```python
        pattern = _matching_pattern(pattern, self.policy.tracked_action_patterns)
        threshold_key = pattern.key if pattern is not None else key
        if pattern is not None and self._action_counts[threshold_key] > pattern.threshold:
            return GateVerdict(
                status="fail",
                issues=[issue("重复账本", f"{pattern.key} action repeated >{pattern.threshold}", snippet=pattern_text)],
            )
```

Add helpers:

```python
def _matching_pattern(text: str, patterns: tuple[RepetitionPattern, ...]) -> RepetitionPattern | None:
    normalized = text.lower()
    for pattern in patterns:
        if pattern.terms and all(term.lower() in normalized or term in text for term in pattern.terms):
            return pattern
    return None


def _count_mapping(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {str(key): int(count) for key, count in value.items() if isinstance(count, int) and count >= 0}
```

- [ ] **Step 5: Wire policy into gate harness**

In `apps/workflow/storyforge_workflow/narrative/gate_harness.py`, initialize:

```python
        self.repetition_ledger = RepetitionLedger(policy=plan.repetition_policy)
```

- [ ] **Step 6: Run focused and regression tests**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_narrative_plan.py tests/test_narrative_registries.py tests/test_narrative_collapse_and_beat_sheet.py -q
```

Expected:

```text
passed
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/workflow/storyforge_workflow/narrative/plan.py apps/workflow/storyforge_workflow/narrative/repetition_ledger.py apps/workflow/storyforge_workflow/narrative/gate_harness.py apps/workflow/tests/test_narrative_plan.py apps/workflow/tests/test_narrative_registries.py
git commit -m "feat(workflow): parameterize narrative repetition ledger"
```

---

### Task 7: Verification and Smoke Readiness

**Files:**
- Modify: `.codex/verification-report.md`
- No production code changes unless focused tests reveal defects.

- [ ] **Step 1: Run workflow P0/P1 regression**

Run:

```powershell
cd apps/workflow
uv run pytest tests/test_prompt_builder.py tests/test_generation_state_references.py tests/test_narrative_extract.py tests/test_narrative_collapse_and_beat_sheet.py tests/test_narrative_30ch_regression_fixtures.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_book_run_adapter.py tests/test_narrative_registries.py -q
```

Expected:

```text
passed
```

- [ ] **Step 2: Run API Phase9C regression**

Run:

```powershell
cd apps/api
uv run pytest tests/test_phase9c_narrative_smoke.py tests/test_phase9b_real_llm_smoke.py tests/test_book_runs.py -q
```

Expected:

```text
passed
```

- [ ] **Step 3: Run lint on touched Python modules**

Run:

```powershell
cd apps/workflow
uv run ruff check storyforge_workflow/prompts storyforge_workflow/state.py storyforge_workflow/narrative storyforge_workflow/orchestrators tests/test_prompt_builder.py tests/test_narrative_extract.py tests/test_narrative_collapse_and_beat_sheet.py tests/test_book_loop_three_chapters.py tests/test_narrative_registries.py
cd ..\api
uv run ruff check app/domains/book_runs/phase9c_narrative_smoke.py tests/test_phase9c_narrative_smoke.py
```

Expected:

```text
All checks passed
All checks passed
```

- [ ] **Step 4: Record verification**

Append this section to `.codex/verification-report.md` with actual command output counts:

```markdown
---

## 13. Narrative Contract Closure Implementation（2026-06-12）

- **目标**：实现 StoryForge 总计划改造 P0/P1 第一批：critic 合同核验、prompt 注入键统一、正文级 narrative extract、fact-based collapse judge、Phase9C contract evidence、commit-time memory/continuity side effects、repetition ledger 参数化。
- **本地验证**：
  - `cd apps/workflow && uv run pytest ... -q`：填写实际 passed / warning 数。
  - `cd apps/api && uv run pytest ... -q`：填写实际 passed / warning 数。
  - `cd apps/workflow && uv run ruff check ...`：填写实际结果。
  - `cd apps/api && uv run ruff check ...`：填写实际结果。
- **未联通能力**：未重跑真实 6/15/30 章 narrative smoke；满足本批单元/契约门槛后再执行真实 smoke。
- **下一步**：先跑 6 章 Phase9C narrative smoke，模板章 <=1 且人工抽读通过后进入 15 章。

记录时间戳：2026-06-12 HH:MM:SS +08:00。
```

- [ ] **Step 5: Commit verification record**

Run:

```powershell
git add .codex/verification-report.md
git commit -m "docs: record narrative contract closure verification"
```

---

## Self-Review

Spec coverage:

- P0-A critic contract prompt is covered by Task 1.
- P0-B narrative extract layer is covered by Task 2.
- P0-C fact-based collapse judge is covered by Task 3.
- P0-D prompt injection parity is covered by Task 1.
- Phase9C sidecar contract evidence is covered by Task 4.
- P1-A commit-time memory/continuity boundary is covered by Task 5.
- P1-B/P1-C first ledger parameterization and persistence foundation is covered by Task 6.
- Final verification and `.codex` evidence are covered by Task 7.

Out-of-scope for this implementation slice:

- Full PhasePlan unification across scheduler/entity/beat gates.
- Full structure repair package and writer-friendly UI.
- Real 6/15/30 chapter smoke execution.

These are intentionally deferred because the first slice must make the contract verifiable and side-effect-safe before expanding repair/UI behavior.

Placeholder scan:

- No `TBD`, `TODO`, or `implement later` placeholders are used.
- Every task includes exact files, failing tests, implementation shape, focused commands, expected results, and commit command.

Type consistency:

- `NarrativeSceneFact`, `parse_narrative_scene_fact()`, `build_narrative_fact_extract_prompt()`, and `judge_fact()` names are consistent across tests and implementation steps.
- `defer_commit_side_effects` and `commit_chapter_side_effects` are consistently named across NovelLoop, BookLoop, and tests.
- `RepetitionPattern` / `RepetitionPolicy` fields match the plan parser and ledger tests.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-12-storyforge-narrative-contract-closure.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
