# Novel Skill Framework 借鉴 claw-code Implementation Plan

> **给执行代理的要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行。所有步骤使用复选框跟踪。所有验证必须在本地完成，并把结果写入 `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md`。

**目标：** 在当前工作区补齐 Novel Skill Framework 第一阶段能力：静态技能定义、六个技能元数据、只读注册表、BookRun 审计事件投影和诊断入口，同时只借鉴 `C:\Users\kanye\claw-code` 的 manifest、registry、hook 语义与报告契约模式，不引入动态插件执行。

**架构：** 以 `apps/workflow` 为第一阶段落点，新增 `storyforge_workflow.skills` 包。技能框架只描述并审计现有 BookRun / NovelLoop 步骤，不替换 `NovelLoopPorts`、不改变 `NovelLoopResult` 与 `BookLoopResult` 状态契约、不扫描执行外部脚本。注册表采用与 `CreativeToolRegistry` 一致的 frozen dataclass + `MappingProxyType` 静态只读模式，审计层从现有 progress/checkpoint 派生引用化事件。

**Tech Stack:** Python 3.13、pytest、frozen dataclass、`MappingProxyType`、现有 workflow 测试结构、Markdown `SKILL.md` 元数据、pnpm/uv 本地验证链路。

---

## 一、当前事实基线

本计划基于 2026-05-31 本地只读扫描：

- 当前缺失目录：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills`。
- 当前缺失测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_skill_registry.py`。
- 当前缺失测试：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_skill_audit_summary.py`。
- 已有设计源：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\docs\superpowers\specs\2026-05-31-storyforge-novel-skill-framework-design.md`。
- 可复用本地模式：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\tools\registry.py`。
- BookRun 事实源：`D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\book_loop.py`。
- claw-code 参考：`C:\Users\kanye\claw-code\rust\crates\plugins\src\lib.rs` 的 manifest/registry/hook 结构。
- claw-code 参考：`C:\Users\kanye\claw-code\docs\g004-events-reports-contract.md` 的 canonical event、projection、provenance、capability negotiation 语义。

### 禁止事项

- 禁止新增动态插件市场、外部脚本执行、目录扫描式自动加载或用户自定义代码执行。
- 禁止引入 Rust 运行时、claw-code CLI 权限系统、通用 agent tool registry。
- 禁止把完整 prompt、完整 Scene Packet、完整章节正文写入 workflow checkpoint 或技能运行记录。
- 禁止新增虚构 BookLoop / NovelLoop 终态，例如 `repair_required`、`provider_failed`、`budget_exceeded`。
- 禁止用 CI、远程流水线或人工验证替代本地命令。

---

## 二、文件职责总览

### 预计新增文件

- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\__init__.py`
  - 导出技能定义、默认注册表、审计派生函数和诊断函数。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\definitions.py`
  - 定义 `NovelSkillDefinition`、`NovelSkillReferences`、`NovelSkillRegistry`、六个默认技能和查询函数。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\audit.py`
  - 定义 `NovelSkillRunEvent`、`BookRunSkillProjection`、从 BookLoop progress 派生技能事件和审计投影的纯函数。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\diagnostics.py`
  - 定义 `validate_novel_skill_registry()`、`list_novel_skills_diagnostics()`、`explain_bookrun_skill_chain()`。
- 六个静态技能元数据文件：
  - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\generate\SKILL.md`
  - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\judge\SKILL.md`
  - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\repair\SKILL.md`
  - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\approve\SKILL.md`
  - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\memory_extract\SKILL.md`
  - `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\export\SKILL.md`
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_skill_registry.py`
  - 覆盖注册表完整性、不可变性、查询行为、重复名称拒绝、状态映射合法性。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_skill_audit_summary.py`
  - 覆盖 completed、awaiting_review、paused_by_budget、paused_by_provider_degradation 四类 BookRun progress 到技能审计投影的派生。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_skill_diagnostics.py`
  - 覆盖技能列表、注册表诊断、链路解释。

### 预计修改文件

- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md`
  - 记录计划、实施、验证和偏离原因。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md`
  - 记录最终本地测试、评分和结论。
- `D:\StoryForge\1-renovel-ai-ai-rag-tavern\docs\superpowers\specs\2026-05-31-storyforge-novel-skill-framework-design.md`
  - 若实现中发现设计与事实冲突，只追加“实施核对”小节；不复制实现细节。

---

## 三、任务清单

### Task 0：基线核验与日志准备

**Files:**
- Read: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\docs\superpowers\specs\2026-05-31-storyforge-novel-skill-framework-design.md`
- Read: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\tools\registry.py`
- Read: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\book_loop.py`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md`

- [ ] **Step 0.1：确认工作区与缺失文件事实**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
Test-Path apps\workflow\storyforge_workflow\skills
Test-Path apps\workflow\tests\test_novel_skill_registry.py
Test-Path apps\workflow\tests\test_skill_audit_summary.py
```

Expected: 当前基线为三行 `False`。如果输出已经变为 `True`，先读取现有文件并把计划调整为“增强既有实现”，不得覆盖已有实现。

- [ ] **Step 0.2：记录编码前检查**

在 `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md` 追加：

```markdown

## 编码前检查 - Novel Skill Framework 借鉴 claw-code 第一阶段

时间：2026-05-31 00:00:00 +08:00

□ 已查阅设计文件：docs/superpowers/specs/2026-05-31-storyforge-novel-skill-framework-design.md
□ 已查阅可复用组件：apps/workflow/storyforge_workflow/tools/registry.py
□ 已查阅状态事实源：apps/workflow/storyforge_workflow/orchestrators/book_loop.py
□ 将复用 frozen dataclass、MappingProxyType、静态注册表和 pytest 测试模式
□ 确认不引入动态插件执行、Rust runtime 或外部脚本 hook
```

---

### Task 1：用 TDD 建立静态 NovelSkillRegistry

**Files:**
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_skill_registry.py`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\__init__.py`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\definitions.py`

- [ ] **Step 1.1：写失败测试**

创建 `apps\workflow\tests\test_novel_skill_registry.py`，核心测试必须覆盖：

```python
from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from storyforge_workflow.skills.definitions import (
    DEFAULT_NOVEL_SKILL_REGISTRY,
    NovelSkillDefinition,
    NovelSkillReferences,
    NovelSkillRegistry,
    get_novel_skill,
    list_novel_skills,
)

REQUIRED_SKILLS = ("generate", "judge", "repair", "approve", "memory_extract", "export")


def test_default_registry_covers_required_novel_skills() -> None:
    skills = DEFAULT_NOVEL_SKILL_REGISTRY.all()
    assert tuple(skill.name for skill in skills) == REQUIRED_SKILLS
    assert tuple(skill.stage for skill in skills) == ("chapter", "chapter", "chapter", "chapter", "chapter", "book")
    assert len({skill.name for skill in skills}) == len(skills)


def test_registry_exposes_contract_capability_and_references() -> None:
    generate = DEFAULT_NOVEL_SKILL_REGISTRY.require("generate")
    judge = DEFAULT_NOVEL_SKILL_REGISTRY.require("judge")

    assert generate.version == "1.0.0"
    assert "chapter_id" in generate.input_refs
    assert "model_run_id" in generate.output_refs
    assert "compiled_context_id" in generate.gates
    assert "token_usage" in generate.audit_fields
    assert "llm" in generate.required_capabilities
    assert generate.status_mapping["success"] == "generated"
    assert "NovelLoopPorts.generate_scene" in generate.references.workflow_nodes

    assert judge.status_mapping["repair"] == "repair"
    assert "judge_report_id" in judge.output_refs


def test_registry_queries_by_stage_and_capability() -> None:
    chapter_skills = DEFAULT_NOVEL_SKILL_REGISTRY.by_stage("chapter")
    llm_skills = DEFAULT_NOVEL_SKILL_REGISTRY.by_capability("llm")

    assert tuple(skill.name for skill in chapter_skills) == ("generate", "judge", "repair", "approve", "memory_extract")
    assert {skill.name for skill in llm_skills} == {"generate", "judge", "repair"}
    assert get_novel_skill("approve") == DEFAULT_NOVEL_SKILL_REGISTRY.require("approve")
    assert list_novel_skills() == DEFAULT_NOVEL_SKILL_REGISTRY.all()


def test_registry_returns_immutable_snapshots() -> None:
    raw_mapping = {"success": "ok"}
    skill = NovelSkillDefinition(
        name="unit.example",
        version="1.0.0",
        stage="chapter",
        description="单元测试技能。",
        input_refs=("chapter_id",),
        output_refs=("model_run_id",),
        gates=("compiled_context_id",),
        audit_fields=("token_usage",),
        status_mapping=raw_mapping,
        required_capabilities=("llm",),
        references=NovelSkillReferences(workflow_nodes=("unit.node",)),
    )

    raw_mapping["success"] = "changed"

    assert skill.status_mapping["success"] == "ok"
    with pytest.raises(TypeError):
        skill.status_mapping["success"] = "changed"  # type: ignore[index]
    with pytest.raises(FrozenInstanceError):
        skill.name = "unit.changed"  # type: ignore[misc]


def test_registry_rejects_duplicate_names_and_reports_missing_skills() -> None:
    skill = NovelSkillDefinition(
        name="unit.example",
        version="1.0.0",
        stage="chapter",
        description="单元测试技能。",
        input_refs=("chapter_id",),
        output_refs=("model_run_id",),
        gates=(),
        audit_fields=(),
        status_mapping={"success": "ok"},
        required_capabilities=(),
        references=NovelSkillReferences(),
    )

    with pytest.raises(ValueError, match="小说技能名称重复"):
        NovelSkillRegistry([skill, skill])
    with pytest.raises(KeyError, match="小说技能不存在：missing"):
        DEFAULT_NOVEL_SKILL_REGISTRY.require("missing")


def test_default_status_mappings_do_not_introduce_book_loop_terminal_states() -> None:
    forbidden = {"repair_required", "repair_limit_exceeded", "provider_failed", "budget_exceeded"}
    for skill in DEFAULT_NOVEL_SKILL_REGISTRY.all():
        assert forbidden.isdisjoint(set(skill.status_mapping.values()))
```

- [ ] **Step 1.2：运行测试确认失败**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_novel_skill_registry.py -v
```

Expected: FAIL，错误包含 `ModuleNotFoundError: No module named 'storyforge_workflow.skills'`。

- [ ] **Step 1.3：实现最小注册表**

创建 `apps\workflow\storyforge_workflow\skills\definitions.py`，接口必须包含：

```python
from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType

StatusMapping = Mapping[str, str]


def _normalize_values(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(value.strip() for value in values if value.strip())


def _freeze_status_mapping(mapping: Mapping[str, str]) -> StatusMapping:
    return MappingProxyType({str(key).strip(): str(value).strip() for key, value in mapping.items() if str(key).strip()})


@dataclass(frozen=True)
class NovelSkillReferences:
    page_refs: Sequence[str] = field(default_factory=tuple)
    api_paths: Sequence[str] = field(default_factory=tuple)
    workflow_nodes: Sequence[str] = field(default_factory=tuple)
    source_refs: Sequence[str] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        object.__setattr__(self, "page_refs", _normalize_values(self.page_refs))
        object.__setattr__(self, "api_paths", _normalize_values(self.api_paths))
        object.__setattr__(self, "workflow_nodes", _normalize_values(self.workflow_nodes))
        object.__setattr__(self, "source_refs", _normalize_values(self.source_refs))


@dataclass(frozen=True)
class NovelSkillDefinition:
    name: str
    version: str
    stage: str
    description: str
    input_refs: Sequence[str]
    output_refs: Sequence[str]
    gates: Sequence[str]
    audit_fields: Sequence[str]
    status_mapping: StatusMapping
    required_capabilities: Sequence[str] = field(default_factory=tuple)
    references: NovelSkillReferences = field(default_factory=NovelSkillReferences)
```

同文件继续实现 `NovelSkillRegistry.all()`、`get()`、`require()`、`by_stage()`、`by_capability()`，行为与 `CreativeToolRegistry` 保持一致。文件末尾定义：

```python
DEFAULT_NOVEL_SKILLS = (
    GENERATE_SKILL,
    JUDGE_SKILL,
    REPAIR_SKILL,
    APPROVE_SKILL,
    MEMORY_EXTRACT_SKILL,
    EXPORT_SKILL,
)
DEFAULT_NOVEL_SKILL_REGISTRY = NovelSkillRegistry(DEFAULT_NOVEL_SKILLS)


def list_novel_skills() -> tuple[NovelSkillDefinition, ...]:
    return DEFAULT_NOVEL_SKILL_REGISTRY.all()


def get_novel_skill(name: str) -> NovelSkillDefinition | None:
    return DEFAULT_NOVEL_SKILL_REGISTRY.get(name)
```

- [ ] **Step 1.4：运行注册表测试**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_novel_skill_registry.py -v
```

Expected: PASS。

---

### Task 2：增加六个静态 `SKILL.md` 元数据文件

**Files:**
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\generate\SKILL.md`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\judge\SKILL.md`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\repair\SKILL.md`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\approve\SKILL.md`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\memory_extract\SKILL.md`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\export\SKILL.md`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_skill_registry.py`

- [ ] **Step 2.1：追加文件存在性测试**

在 `test_novel_skill_registry.py` 追加：

```python
from pathlib import Path


def test_skill_metadata_files_exist_for_default_registry() -> None:
    root = Path(__file__).parents[1] / "storyforge_workflow" / "skills"
    for skill in DEFAULT_NOVEL_SKILL_REGISTRY.all():
        skill_file = root / skill.name / "SKILL.md"
        assert skill_file.exists(), f"缺少技能元数据文件：{skill_file}"
        text = skill_file.read_text(encoding="utf-8")
        assert f"skill_name: {skill.name}" in text
        assert "dynamic_execution: false" in text
        assert "完整 prompt" not in text
        assert "完整正文" not in text
```

- [ ] **Step 2.2：运行测试确认失败**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_novel_skill_registry.py::test_skill_metadata_files_exist_for_default_registry -v
```

Expected: FAIL，错误指出缺少第一个 `SKILL.md`。

- [ ] **Step 2.3：创建六个元数据文件**

`generate/SKILL.md` 使用以下内容；其余五个文件按同一结构写入与 `definitions.py` 对应的字段：

```markdown
---
skill_name: generate
version: 1.0.0
stage: chapter
dynamic_execution: false
---

# generate 小说技能

## 意图

在章节目标、Scene Packet 与编译上下文引用齐备后生成候选章节正文，并记录模型运行引用。

## 输入引用

- book_run_id
- book_id
- chapter_id
- scene_packet_id
- compiled_context_id

## 输出引用

- model_run_id
- draft_hash

## 门禁

- chapter_goal_ready
- scene_packet_id
- compiled_context_id

## 审计字段

- skill_name
- skill_version
- model_run_id
- provider_name
- model_name
- token_usage
- elapsed_time_sec
- fallback_metadata

## 状态映射

- success: generated
- failure: awaiting_review

## 运行边界

本文件只描述静态契约，不执行外部脚本，不保存完整输入提示，不保存完整章节正文。
```

- [ ] **Step 2.4：运行元数据测试**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_novel_skill_registry.py -v
```

Expected: PASS。

---

### Task 3：实现 BookRun 技能审计事件与投影

**Files:**
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_skill_audit_summary.py`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\audit.py`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\__init__.py`

- [ ] **Step 3.1：写审计投影失败测试**

创建 `apps\workflow\tests\test_skill_audit_summary.py`，测试必须覆盖：

```python
from __future__ import annotations

from storyforge_workflow.skills.audit import derive_skill_chain_projection


def test_completed_book_run_progress_derives_chapter_and_export_events() -> None:
    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 10,
                "judge_report_id": 11,
                "repair_patch_id": None,
                "approved_scene_id": 12,
                "token_usage": 120,
                "elapsed_time_sec": 3,
                "cost_estimate": 0.02,
                "fallback_metadata": None,
            }
        ],
        "checkpoint": [{"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12}],
        "budget": {"tokens_used": 120, "elapsed_time_sec": 3, "estimated_cost": 0.02},
    }

    projection = derive_skill_chain_projection(book_run_id=7, status="completed", progress=progress)

    assert projection.book_run_id == 7
    assert projection.status == "completed"
    assert projection.schema_version == "bookrun_skill_projection.v1"
    assert [event.skill_name for event in projection.events] == ["generate", "judge", "approve", "memory_extract", "export"]
    assert projection.events[0].output_refs["model_run_id"] == 10
    assert projection.events[-1].stage == "book"
    assert projection.summary["event_count"] == 5


def test_awaiting_review_progress_derives_blocked_chapter_events_without_export() -> None:
    progress = {
        "completed_chapters": [],
        "checkpoint": [],
        "blocked_chapter": {
            "chapter_index": 2,
            "status": "awaiting_review",
            "model_run_id": 20,
            "judge_report_id": 21,
            "repair_patch_id": 22,
            "approved_scene_id": None,
            "token_usage": 200,
            "elapsed_time_sec": 5,
            "cost_estimate": 0.03,
            "fallback_metadata": None,
        },
        "budget": {"tokens_used": 200, "elapsed_time_sec": 5, "estimated_cost": 0.03},
    }

    projection = derive_skill_chain_projection(book_run_id=8, status="awaiting_review", progress=progress)

    assert [event.skill_name for event in projection.events] == ["generate", "judge", "repair"]
    assert projection.events[-1].status == "repair"
    assert projection.summary["blocked_chapter_index"] == 2
```

同文件再增加两个断言：

- provider 降级时，`fallback_metadata` 保留在 `generate` 事件 metadata 中。
- progress 中即便包含 `prompt` 或 `final_draft`，投影字符串中也不得包含完整输入提示或完整章节正文。

- [ ] **Step 3.2：运行测试确认失败**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_skill_audit_summary.py -v
```

Expected: FAIL，错误包含 `ModuleNotFoundError` 或 `ImportError`。

- [ ] **Step 3.3：实现审计投影**

创建 `apps\workflow\storyforge_workflow\skills\audit.py`，必须包含：

```python
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any


def _freeze_mapping(value: Mapping[str, object]) -> Mapping[str, object]:
    return MappingProxyType({str(key): item for key, item in value.items()})


@dataclass(frozen=True)
class NovelSkillRunEvent:
    event_name: str
    skill_name: str
    skill_version: str
    stage: str
    status: str
    provenance: str
    input_refs: Mapping[str, object] = field(default_factory=dict)
    output_refs: Mapping[str, object] = field(default_factory=dict)
    metadata: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "input_refs", _freeze_mapping(self.input_refs))
        object.__setattr__(self, "output_refs", _freeze_mapping(self.output_refs))
        object.__setattr__(self, "metadata", _freeze_mapping(self.metadata))


@dataclass(frozen=True)
class BookRunSkillProjection:
    schema_version: str
    book_run_id: int
    status: str
    events: tuple[NovelSkillRunEvent, ...]
    summary: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "summary", _freeze_mapping(self.summary))
```

同文件实现：

- `derive_skill_chain_projection(book_run_id:int, status:str, progress:Mapping[str, Any]) -> BookRunSkillProjection`
- `_approved_chapter_events(chapter)`：派生 `generate`、`judge`、`approve`、`memory_extract`
- `_blocked_chapter_events(chapter)`：派生 `generate`、`judge`，有 `repair_patch_id` 时追加 `repair`
- `_export_event(book_run_id, progress)`：派生 book 级 `export`
- `_summary(status, progress, events)`：返回 `event_count`、`completed_chapter_count`、`blocked_chapter_index`、`provider_degradation`、`budget`

所有事件必须包含：

```python
event_name="skill.post"
provenance="workflow_progress_projection"
skill_version="1.0.0"
```

- [ ] **Step 3.4：运行审计和 BookLoop 回归**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_skill_audit_summary.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v
```

Expected: PASS。

---

### Task 4：增加诊断入口，借鉴 claw-code doctor/list 思路

**Files:**
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\tests\test_novel_skill_diagnostics.py`
- Create: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\diagnostics.py`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\skills\__init__.py`

- [ ] **Step 4.1：写诊断失败测试**

```python
from __future__ import annotations

from storyforge_workflow.skills.diagnostics import (
    explain_bookrun_skill_chain,
    list_novel_skill_diagnostics,
    validate_novel_skill_registry,
)


def test_validate_registry_reports_ready_state() -> None:
    report = validate_novel_skill_registry()

    assert report["status"] == "ready"
    assert report["skill_count"] == 6
    assert report["missing_required_skills"] == ()
    assert report["dynamic_execution"] is False


def test_list_novel_skill_diagnostics_is_machine_readable() -> None:
    rows = list_novel_skill_diagnostics()

    assert rows[0]["name"] == "generate"
    assert rows[0]["version"] == "1.0.0"
    assert rows[0]["stage"] == "chapter"
    assert "llm" in rows[0]["required_capabilities"]
    assert rows[-1]["name"] == "export"
    assert rows[-1]["stage"] == "book"


def test_explain_bookrun_skill_chain_describes_fixed_order() -> None:
    explanation = explain_bookrun_skill_chain()

    assert explanation["chapter_chain"] == ("generate", "judge", "repair", "approve", "memory_extract")
    assert explanation["book_chain"] == ("export",)
    assert explanation["dynamic_plugins"] == "disabled"
    assert explanation["status_contract"] == {
        "chapter_terminal": ("approved", "awaiting_review"),
        "book_terminal": ("completed", "awaiting_review", "paused_by_budget", "paused_by_provider_degradation"),
    }
```

- [ ] **Step 4.2：运行测试确认失败**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_novel_skill_diagnostics.py -v
```

Expected: FAIL，错误包含 `ModuleNotFoundError` 或 `ImportError`。

- [ ] **Step 4.3：实现诊断函数**

创建 `apps\workflow\storyforge_workflow\skills\diagnostics.py`，必须暴露：

```python
from __future__ import annotations

from typing import Any

from storyforge_workflow.skills.definitions import DEFAULT_NOVEL_SKILL_REGISTRY

REQUIRED_SKILLS = ("generate", "judge", "repair", "approve", "memory_extract", "export")


def validate_novel_skill_registry() -> dict[str, Any]:
    skills = DEFAULT_NOVEL_SKILL_REGISTRY.all()
    names = tuple(skill.name for skill in skills)
    missing = tuple(name for name in REQUIRED_SKILLS if name not in names)
    duplicate_count = len(names) - len(set(names))
    return {
        "status": "ready" if not missing and duplicate_count == 0 else "invalid",
        "skill_count": len(skills),
        "missing_required_skills": missing,
        "duplicate_count": duplicate_count,
        "dynamic_execution": False,
    }
```

同文件继续实现 `list_novel_skill_diagnostics()` 和 `explain_bookrun_skill_chain()`，返回值必须满足 Step 4.1 的测试断言。

- [ ] **Step 4.4：运行诊断测试**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_novel_skill_diagnostics.py -v
```

Expected: PASS。

---

### Task 5：本地总验证与文档留痕

**Files:**
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\operations-log.md`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md`

- [ ] **Step 5.1：运行 workflow 相关测试**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow
uv run pytest tests/test_novel_skill_registry.py tests/test_skill_audit_summary.py tests/test_novel_skill_diagnostics.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py tests/test_provider_parity_harness.py -v
```

Expected: 全部通过。

- [ ] **Step 5.2：运行格式与仓库级验证**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
pnpm run lint
pnpm run test:workflow
```

Expected: 两条命令均通过。若 `pnpm run lint` 因既有无关文件失败，必须记录失败文件、错误摘要和本任务影响判断，不能直接宣称通过。

- [ ] **Step 5.3：检查禁止项**

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern
rg -n "dynamic_execution: true|subprocess|Command\(|plugin install|repair_required|provider_failed|budget_exceeded" apps\workflow\storyforge_workflow\skills apps\workflow\tests
```

Expected: 无匹配。若匹配出测试中的断言文本，必须确认文本用于禁止项检测，不是实现行为。

- [ ] **Step 5.4：写验证报告**

在 `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md` 追加最终验证摘要，必须包含：

- 测试命令和真实结果。
- 禁止项搜索结果。
- 技术维度评分。
- 战略维度评分。
- 综合评分。
- 通过、退回或需讨论建议。

---

## 四、执行顺序

1. Task 0：基线核验与日志准备。
2. Task 1：静态 NovelSkillRegistry。
3. Task 2：六个 `SKILL.md` 元数据文件。
4. Task 3：BookRun 技能审计事件与投影。
5. Task 4：诊断入口。
6. Task 5：本地总验证与文档留痕。

每个任务完成后都必须运行对应测试。若用户允许提交，则每个任务单独提交；若用户要求暂不提交，必须在 `.codex/operations-log.md` 记录原因。

---

## 五、自检清单

- 计划覆盖 `generate`、`judge`、`repair`、`approve`、`memory_extract`、`export` 六个技能。
- 计划复用 `CreativeToolRegistry` 的静态注册表模式。
- 计划借鉴 claw-code 的 manifest、hook 语义、report projection，但不照搬动态插件执行。
- 计划不改变 `BookLoop` 与 `NovelLoop` 终态。
- 计划包含本地 pytest、lint、workflow 测试和禁止项搜索。
- 计划不包含未定义占位实现。

---

## 六、执行选项

计划完成后有两个执行选项：

1. **Subagent-Driven（推荐）**：每个任务派发独立子代理执行，我在任务间做审查，适合减少上下文污染。
2. **Inline Execution**：在当前会话中使用 `superpowers:executing-plans` 按任务执行，适合保持上下文连续。

推荐选择 **Subagent-Driven**，因为本计划任务边界清晰，测试可独立运行。
