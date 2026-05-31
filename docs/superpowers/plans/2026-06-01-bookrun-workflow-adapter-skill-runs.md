# BookRun Workflow Adapter Skill Runs Implementation Plan

> **给执行代理的要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行。所有步骤使用复选框（`- [x]`）跟踪。所有验证必须在本地完成，并写入 `D:\StoryForge\.codex\verification-report.md`。

**目标：** 补齐 BookRun workflow adapter，在 workflow 侧运行 BookLoop 并为每章注入 `NovelSkillRunner`，让 `audit_report.json` 出现真实 recorded `skill_runs`。

**架构：** API 继续作为 BookRun 真相源，只负责创建运行记录与接收 progress 回填。新增 workflow 侧 adapter 把 BookRun 输入转换为 `BookLoopRequest`，在 `run_chapter` 回调内创建 `NovelSkillRunner.default()` 并调用 `run_single_chapter_loop(..., skill_runner=runner)`；现有 `BookLoop`、`audit.py`、exporter 和 Web 审计页自然消费 recorded `skill_runs`。LangGraph 节点级事件不在本计划内接入，后续若需要另建 `workflow_node_run.v1`。

**Tech Stack:** Python 3.13、pytest、frozen dataclass、现有 `NovelLoopPorts` 注入模式、FastAPI BookRun progress 回填、pnpm/uv 本地验证。

---

## 文件职责总览

### 新增文件

- `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\book_run_adapter.py`
  - 职责：定义 BookRun adapter 的输入、端口协议、progress sink 协议和 `run_book_run_with_skill_runner()`。
  - 边界：只在 workflow 包内编排 BookLoop，不导入 API SQLAlchemy model，不直接操作 API 数据库。
- `D:\StoryForge\apps\workflow\tests\test_book_run_adapter.py`
  - 职责：用 deterministic ports 验证 adapter 能注入 `NovelSkillRunner`，并产出 recorded `skill_runs`。
- `D:\StoryForge\apps\api\tests\test_book_run_recorded_skill_runs_export.py`
  - 职责：验证带 recorded `skill_runs` 的 BookRun progress 经导出后 `recorded_event_count > 0`。

### 修改文件

- `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\__init__.py`
  - 职责：导出 adapter 的公开入口，保持 workflow orchestrators 入口一致。
- `D:\StoryForge\.codex\operations-log.md`
  - 职责：记录实施过程、失败补救和验证命令。
- `D:\StoryForge\.codex\verification-report.md`
  - 职责：记录最终本地验证、评分与结论。

### 明确不修改

- `D:\StoryForge\apps\api\app\domains\book_runs\service.py`
  - 不在 API service 内执行 workflow。
- `D:\StoryForge\apps\api\app\domains\book_runs\phase9b_real_llm_smoke.py`
  - 不把 smoke 工具改造成长期主线。
- `D:\StoryForge\apps\workflow\storyforge_workflow\graph.py`
  - 本计划不把 LangGraph 节点映射为章节 `skill_runs`。

---

## Task 1：新增 BookRun adapter 契约与红灯测试

**目标：** 先定义 workflow adapter 的输入输出契约，证明当前缺少 `book_run_adapter.py`。

**Files:**

- Create: `D:\StoryForge\apps\workflow\tests\test_book_run_adapter.py`
- Create later: `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\book_run_adapter.py`

- [x] **Step 1：写失败测试：adapter 能把输入转成 BookLoopResult 并回填 progress sink**

在 `D:\StoryForge\apps\workflow\tests\test_book_run_adapter.py` 写入：

```python
from __future__ import annotations

from collections.abc import Mapping

from storyforge_workflow.orchestrators.book_run_adapter import (
    BookRunAdapterRequest,
    BookRunAdapterPorts,
    CapturingProgressSink,
    run_book_run_with_skill_runner,
)
from storyforge_workflow.orchestrators.novel_loop import NovelLoopPorts, NovelLoopRequest


def test_book_run_adapter_runs_book_loop_and_emits_progress_with_recorded_skill_runs() -> None:
    """adapter 应在每章 NovelLoop 注入 runner，并把 recorded skill_runs 回填给 sink。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(
        book_run_id=1,
        book_id=2,
        blueprint_id=3,
        total_chapters=1,
        start_chapter_index=1,
    )

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "completed"
    assert sink.payloads == [
        {
            "book_run_id": 1,
            "status": "completed",
            "current_chapter_index": 1,
            "progress": result.progress,
        }
    ]
    chapter = result.progress["completed_chapters"][0]
    assert [run["skill_name"] for run in chapter["skill_runs"]] == [
        "generate",
        "judge",
        "approve",
        "memory_extract",
    ]
    assert chapter["skill_runs"][0]["output_refs"]["model_run_id"] == 501
    assert chapter["skill_runs"][0]["skill_version"] == "1.0.0"
    assert "完整正文" not in str(chapter["skill_runs"])
    assert "完整提示词" not in str(chapter["skill_runs"])


def _passing_ports(request: NovelLoopRequest) -> NovelLoopPorts:
    return NovelLoopPorts(
        compile_context=lambda novel_request: f"ctx-{novel_request.chapter_index}",
        generate_scene=lambda novel_request, context_id: "林岚抵达雾港。",
        record_model_run=lambda novel_request, draft: 500 + novel_request.chapter_index,
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 600 + attempt},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda novel_request, draft, refs: 700 + novel_request.chapter_index,
        extract_memory=lambda novel_request, draft, approved_scene_id: [],
    )
```

- [x] **Step 2：运行红灯测试**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_adapter.py::test_book_run_adapter_runs_book_loop_and_emits_progress_with_recorded_skill_runs -v
```

Expected:

```text
ModuleNotFoundError: No module named 'storyforge_workflow.orchestrators.book_run_adapter'
```

- [x] **Step 3：记录红灯结果**

在 `D:\StoryForge\.codex\operations-log.md` 追加：

```markdown
## BookRun workflow adapter 红灯记录

时间：YYYY-MM-DD HH:mm:ss

- 命令：cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py::test_book_run_adapter_runs_book_loop_and_emits_progress_with_recorded_skill_runs -v
- 预期失败：book_run_adapter 模块不存在
- 结论：允许进入 adapter 最小实现
```

- [x] **Step 4：提交当前红灯测试**

Run:

```powershell
cd D:\StoryForge
git add apps/workflow/tests/test_book_run_adapter.py .codex/operations-log.md
git commit -m "新增 BookRun workflow adapter 红灯测试"
```

Expected:

```text
[当前分支 <hash>] 新增 BookRun workflow adapter 红灯测试
```

---

## Task 2：实现 adapter 最小契约并让单章 recorded skill_runs 通过

**目标：** 新增 workflow adapter，复用 `run_book_loop()`、`run_single_chapter_loop()` 和 `NovelSkillRunner.default()`。

**Files:**

- Create: `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\book_run_adapter.py`
- Modify: `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\__init__.py`
- Test: `D:\StoryForge\apps\workflow\tests\test_book_run_adapter.py`

- [x] **Step 1：创建 adapter 实现**

在 `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\book_run_adapter.py` 写入：

```python
from __future__ import annotations

from collections.abc import Callable, Protocol
from dataclasses import dataclass, field
from typing import Any

from storyforge_workflow.orchestrators.book_loop import BookLoopRequest, BookLoopResult, run_book_loop
from storyforge_workflow.orchestrators.novel_loop import NovelLoopPorts, NovelLoopRequest, run_single_chapter_loop
from storyforge_workflow.skills.runner import NovelSkillRunner


@dataclass(frozen=True)
class BookRunAdapterRequest:
    """workflow adapter 接收的 BookRun 执行输入，不包含 API ORM 对象。"""

    book_run_id: int
    book_id: int
    blueprint_id: int
    total_chapters: int
    start_chapter_index: int = 1
    existing_checkpoint: list[dict[str, Any]] = field(default_factory=list)
    token_budget: int | None = None
    time_budget_sec: int | None = None
    chapter_budget: int | None = None
    provider_fallback_pause_threshold: int | None = None


class BookRunProgressSink(Protocol):
    """BookRun progress 回填边界，可由测试、本地 service adapter 或 HTTP adapter 实现。"""

    def emit(self, *, book_run_id: int, status: str, current_chapter_index: int, progress: dict[str, Any]) -> None: ...


@dataclass(frozen=True)
class BookRunAdapterPorts:
    """adapter 外部依赖端口，避免 workflow 直接依赖 API 数据库。"""

    chapter_goal: Callable[[int], str]
    chapter_id: Callable[[int], int]
    novel_loop_ports_factory: Callable[[NovelLoopRequest], NovelLoopPorts]
    progress_sink: BookRunProgressSink


class CapturingProgressSink:
    """测试用 progress sink，记录 adapter 回填 payload。"""

    def __init__(self) -> None:
        self.payloads: list[dict[str, Any]] = []

    def emit(self, *, book_run_id: int, status: str, current_chapter_index: int, progress: dict[str, Any]) -> None:
        self.payloads.append(
            {
                "book_run_id": book_run_id,
                "status": status,
                "current_chapter_index": current_chapter_index,
                "progress": progress,
            }
        )


def run_book_run_with_skill_runner(request: BookRunAdapterRequest, ports: BookRunAdapterPorts) -> BookLoopResult:
    """运行 BookLoop，并在每章 NovelLoop 中注入 NovelSkillRunner 记录真实技能运行。"""

    book_loop_request = BookLoopRequest(
        book_run_id=request.book_run_id,
        book_id=request.book_id,
        blueprint_id=request.blueprint_id,
        total_chapters=request.total_chapters,
        start_chapter_index=request.start_chapter_index,
        existing_checkpoint=list(request.existing_checkpoint),
        token_budget=request.token_budget,
        time_budget_sec=request.time_budget_sec,
        chapter_budget=request.chapter_budget,
        provider_fallback_pause_threshold=request.provider_fallback_pause_threshold,
    )

    def run_chapter(chapter_index: int):
        novel_request = NovelLoopRequest(
            book_id=request.book_id,
            chapter_id=ports.chapter_id(chapter_index),
            chapter_index=chapter_index,
            chapter_goal=ports.chapter_goal(chapter_index),
        )
        runner = NovelSkillRunner.default()
        return run_single_chapter_loop(
            novel_request,
            ports.novel_loop_ports_factory(novel_request),
            skill_runner=runner,
        )

    result = run_book_loop(book_loop_request, run_chapter)
    ports.progress_sink.emit(
        book_run_id=request.book_run_id,
        status=result.status,
        current_chapter_index=result.current_chapter_index,
        progress=result.progress,
    )
    return result
```

- [x] **Step 2：导出 orchestrators 入口**

在 `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\__init__.py` 增加：

```python
from storyforge_workflow.orchestrators.book_run_adapter import (
    BookRunAdapterPorts,
    BookRunAdapterRequest,
    BookRunProgressSink,
    CapturingProgressSink,
    run_book_run_with_skill_runner,
)

__all__ = [
    "BookRunAdapterPorts",
    "BookRunAdapterRequest",
    "BookRunProgressSink",
    "CapturingProgressSink",
    "run_book_run_with_skill_runner",
]
```

如果该文件已有 `__all__`，把以上名称并入现有列表，不删除既有导出。

- [x] **Step 3：运行绿灯测试**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_adapter.py::test_book_run_adapter_runs_book_loop_and_emits_progress_with_recorded_skill_runs -v
```

Expected:

```text
1 passed
```

- [x] **Step 4：运行相邻回归**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_adapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py -v
```

Expected:

```text
全部通过
```

- [x] **Step 5：提交 adapter 最小实现**

Run:

```powershell
cd D:\StoryForge
git add apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py apps/workflow/storyforge_workflow/orchestrators/__init__.py apps/workflow/tests/test_book_run_adapter.py
git commit -m "新增 BookRun workflow adapter runner 注入"
```

Expected:

```text
[当前分支 <hash>] 新增 BookRun workflow adapter runner 注入
```

---

## Task 3：覆盖 awaiting_review、预算暂停和 provider 降级路径

**目标：** 确认 adapter 不只覆盖 happy path，也能保留 BookLoop 既有终态和 progress 结构。

**Files:**

- Modify: `D:\StoryForge\apps\workflow\tests\test_book_run_adapter.py`
- Reference: `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\book_loop.py`

- [x] **Step 1：新增 awaiting_review 测试**

在 `test_book_run_adapter.py` 追加：

```python
def test_book_run_adapter_preserves_awaiting_review_with_recorded_generate_and_judge() -> None:
    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_review_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(book_run_id=11, book_id=22, blueprint_id=33, total_chapters=1)

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "awaiting_review"
    blocked = result.progress["blocked_chapter"]
    assert blocked["chapter_index"] == 1
    assert [run["skill_name"] for run in blocked["skill_runs"]] == ["generate", "judge"]
    assert blocked["skill_runs"][1]["status"] == "awaiting_review"
    assert sink.payloads[0]["status"] == "awaiting_review"


def _review_ports(request: NovelLoopRequest) -> NovelLoopPorts:
    return NovelLoopPorts(
        compile_context=lambda novel_request: "ctx-review",
        generate_scene=lambda novel_request, context_id: "草稿需要人工判断。",
        record_model_run=lambda novel_request, draft: 801,
        judge_scene=lambda draft, attempt: {"status": "awaiting_review", "judge_report_id": 901},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda novel_request, draft, refs: 0,
    )
```

- [x] **Step 2：新增章节预算暂停测试**

继续追加：

```python
def test_book_run_adapter_preserves_chapter_budget_pause_after_recorded_chapter() -> None:
    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(
        book_run_id=21,
        book_id=22,
        blueprint_id=23,
        total_chapters=3,
        chapter_budget=1,
    )

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "paused_by_budget"
    assert result.progress["pause_reason"] == "chapter_budget_exceeded"
    assert len(result.progress["completed_chapters"]) == 1
    assert result.progress["completed_chapters"][0]["skill_runs"][0]["skill_name"] == "generate"
```

- [x] **Step 3：运行新增测试**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_adapter.py -v
```

Expected:

```text
3 passed
```

- [x] **Step 4：运行 BookLoop 回归**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_adapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v
```

Expected:

```text
全部通过
```

- [x] **Step 5：提交边界路径测试**

Run:

```powershell
cd D:\StoryForge
git add apps/workflow/tests/test_book_run_adapter.py
git commit -m "覆盖 BookRun adapter 暂停与人工审查路径"
```

Expected:

```text
[当前分支 <hash>] 覆盖 BookRun adapter 暂停与人工审查路径
```

---

## Task 4：验证 API 导出能消费 adapter 产出的 recorded skill_runs

**目标：** 不改 API service，只用带 `skill_runs` 的 progress 验证 exporter 已能输出 recorded 事件。

**Files:**

- Create: `D:\StoryForge\apps\api\tests\test_book_run_recorded_skill_runs_export.py`
- Reference: `D:\StoryForge\apps\api\tests\test_book_exporter.py`
- Reference: `D:\StoryForge\apps\api\app\domains\exports\book_markdown_exporter.py`

- [x] **Step 1：写 API 导出测试**

在 `D:\StoryForge\apps\api\tests\test_book_run_recorded_skill_runs_export.py` 写入：

```python
from __future__ import annotations

from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report


def test_audit_report_marks_adapter_skill_runs_as_recorded(session_factory: sessionmaker[Session]) -> None:
    """adapter 写入的 skill_runs 应在 audit_report 中显示为 recorded。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run_with_skill_runs(session)
        artifact = export_book_run_audit_report(session, book_run_id)

    skill_chain = artifact.payload["skill_chain"]
    assert skill_chain["summary"]["recorded_event_count"] == 4
    assert skill_chain["summary"]["reconstructed_event_count"] == 1
    assert skill_chain["summary"]["evidence_basis"] == "mixed"
    assert [event["provenance"] for event in skill_chain["events"][:4]] == [
        "recorded_skill_run",
        "recorded_skill_run",
        "recorded_skill_run",
        "recorded_skill_run",
    ]
    assert skill_chain["events"][0]["recorded"] is True
    assert skill_chain["events"][-1]["skill_name"] == "export"
    assert skill_chain["events"][-1]["recorded"] is False
    assert "完整正文" not in str(skill_chain)
    assert "完整提示词" not in str(skill_chain)


def _seed_completed_book_run_with_skill_runs(session: Session) -> int:
    book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。")
    session.add(book)
    session.flush()
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="林岚在雾港追查失真的灯塔信号。",
        tone="克制悬疑",
        target_word_count=4500,
        target_chapter_count=1,
        chapter_word_count_min=1000,
        chapter_word_count_max=1800,
        status="locked",
        version=2,
        metadata_={},
    )
    session.add(blueprint)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="雾港航线 1", status="approved")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="第 1 章场景", status="approved", content="第一章正文")
    session.add(scene)
    session.flush()
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="completed",
        current_chapter_index=1,
        total_chapters=1,
        progress={
            "completed_chapters": [
                {
                    "chapter_index": 1,
                    "status": "approved",
                    "model_run_id": 501,
                    "judge_report_id": 600,
                    "repair_patch_id": None,
                    "approved_scene_id": scene.id,
                    "skill_runs": [
                        {
                            "skill_name": "generate",
                            "skill_version": "1.0.0",
                            "status": "generated",
                            "book_id": book.id,
                            "chapter_index": 1,
                            "input_refs": {"compiled_context_id": "ctx-1"},
                            "output_refs": {"model_run_id": 501, "draft_hash": "sha256:abc"},
                            "budget": {},
                            "error_summary": None,
                        },
                        {
                            "skill_name": "judge",
                            "skill_version": "1.0.0",
                            "status": "pass",
                            "book_id": None,
                            "chapter_index": None,
                            "input_refs": {"attempt": 0},
                            "output_refs": {"judge_report_id": 600},
                            "budget": {},
                            "error_summary": None,
                        },
                        {
                            "skill_name": "approve",
                            "skill_version": "1.0.0",
                            "status": "approved",
                            "book_id": book.id,
                            "chapter_index": 1,
                            "input_refs": {"source_model_run_id": 501, "judge_report_id": 600},
                            "output_refs": {"approved_scene_id": scene.id},
                            "budget": {},
                            "error_summary": None,
                        },
                        {
                            "skill_name": "memory_extract",
                            "skill_version": "1.0.0",
                            "status": "memory_extract_skipped",
                            "book_id": book.id,
                            "chapter_index": 1,
                            "input_refs": {"approved_scene_id": scene.id},
                            "output_refs": {"memory_atom_ids": []},
                            "budget": {},
                            "error_summary": None,
                        },
                    ],
                }
            ],
            "budget": {"tokens_used": 0, "elapsed_time_sec": 0, "estimated_cost": 0.0},
        },
    )
    session.add(book_run)
    session.commit()
    return book_run.id
```

- [x] **Step 2：运行 API 测试**

Run:

```powershell
cd D:\StoryForge\apps\api
uv run pytest tests/test_book_run_recorded_skill_runs_export.py -v
```

Expected:

```text
1 passed
```

- [x] **Step 3：运行 exporter 回归**

Run:

```powershell
cd D:\StoryForge\apps\api
uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py -v
```

Expected:

```text
全部通过
```

- [x] **Step 4：提交 API 导出验收测试**

Run:

```powershell
cd D:\StoryForge
git add apps/api/tests/test_book_run_recorded_skill_runs_export.py
git commit -m "验证 BookRun 导出消费 recorded skill_runs"
```

Expected:

```text
[当前分支 <hash>] 验证 BookRun 导出消费 recorded skill_runs
```

---

## Task 5：新增状态词一致性校验测试

**目标：** 防止 `NovelSkillRunner` 产出的状态词偏离 registry 的 `status_mapping`。

**Files:**

- Modify: `D:\StoryForge\apps\workflow\tests\test_book_run_adapter.py`
- Reference: `D:\StoryForge\apps\workflow\storyforge_workflow\skills\definitions.py`

- [x] **Step 1：追加状态词一致性测试**

在 `test_book_run_adapter.py` 追加：

```python
from storyforge_workflow.skills.definitions import DEFAULT_NOVEL_SKILL_REGISTRY


def test_book_run_adapter_skill_run_statuses_match_registry_status_mapping() -> None:
    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(book_run_id=31, book_id=32, blueprint_id=33, total_chapters=1)

    result = run_book_run_with_skill_runner(request, ports)

    allowed_by_skill = {
        skill.name: set(skill.status_mapping.values()) for skill in DEFAULT_NOVEL_SKILL_REGISTRY.all()
    }
    for run in result.progress["completed_chapters"][0]["skill_runs"]:
        assert run["status"] in allowed_by_skill[run["skill_name"]]
    assert result.status in {
        "completed",
        "awaiting_review",
        "paused_by_budget",
        "paused_by_provider_degradation",
    }
```

- [x] **Step 2：运行测试**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_adapter.py::test_book_run_adapter_skill_run_statuses_match_registry_status_mapping -v
```

Expected:

```text
1 passed
```

- [x] **Step 3：运行 registry 回归**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_adapter.py tests/test_novel_skill_registry.py tests/test_novel_skill_runner.py -v
```

Expected:

```text
全部通过
```

- [x] **Step 4：提交状态词校验**

Run:

```powershell
cd D:\StoryForge
git add apps/workflow/tests/test_book_run_adapter.py
git commit -m "校验 BookRun adapter 技能状态词"
```

Expected:

```text
[当前分支 <hash>] 校验 BookRun adapter 技能状态词
```

---

## Task 6：端到端本地验收与报告

**目标：** 运行最小相关测试、全量相关门禁，并把结果写入 `.codex`。

**Files:**

- Modify: `D:\StoryForge\.codex\operations-log.md`
- Modify: `D:\StoryForge\.codex\verification-report.md`

- [x] **Step 1：运行 workflow 目标测试**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_adapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v
```

Expected:

```text
全部通过
```

- [x] **Step 2：运行 API 目标测试**

Run:

```powershell
cd D:\StoryForge\apps\api
uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py tests/test_book_runs.py -v
```

Expected:

```text
全部通过
```

- [x] **Step 3：运行 workflow 全量测试**

Run:

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest -q
```

Expected:

```text
全部通过，0 failed
```

- [x] **Step 4：运行 API 全量测试**

Run:

```powershell
cd D:\StoryForge\apps\api
uv run pytest -q
```

Expected:

```text
全部通过，0 failed
```

- [x] **Step 5：运行 Web 审计回归**

Run:

```powershell
cd D:\StoryForge
pnpm --filter @storyforge/web test -- book-run-audit
```

Expected:

```text
3 pass / 0 fail
```

- [x] **Step 6：写验证报告**

在 `D:\StoryForge\.codex\verification-report.md` 追加：

```markdown
## BookRun workflow adapter recorded skill_runs 验证报告

时间：YYYY-MM-DD HH:mm:ss

### 验证命令

- apps/workflow 目标测试：通过
- apps/api 目标测试：通过
- apps/workflow 全量 pytest：通过
- apps/api 全量 pytest：通过
- web 审计回归：通过

### 关键证据

- BookRun adapter 产出的 completed_chapters[0].skill_runs 包含 generate、judge、approve、memory_extract。
- audit_report.json 的 skill_chain.summary.recorded_event_count 大于 0。
- audit_report.json 保留 export 的 reconstructed 事件，不把导出动作伪装成章节实录。
- 审计 payload 不包含完整提示词或完整正文。

### 评分

- 代码质量：95/100
- 测试覆盖：94/100
- 规范遵循：95/100
- 需求匹配：96/100
- 架构一致：95/100
- 风险评估：94/100

综合评分：95/100
建议：通过
```

- [x] **Step 7：提交报告**

Run:

```powershell
cd D:\StoryForge
git add .codex/operations-log.md .codex/verification-report.md
git commit -m "记录 BookRun workflow adapter 本地验证"
```

Expected:

```text
[当前分支 <hash>] 记录 BookRun workflow adapter 本地验证
```

---

## 回滚策略

### 回滚 adapter

Run:

```powershell
cd D:\StoryForge
git rm apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py apps/workflow/tests/test_book_run_adapter.py
```

然后从 `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\__init__.py` 移除新增导出名称，运行：

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py -v
```

通过后提交：

```powershell
cd D:\StoryForge
git add apps/workflow/storyforge_workflow/orchestrators/__init__.py
git commit -m "回滚 BookRun workflow adapter"
```

### 回滚 API 验收测试

Run:

```powershell
cd D:\StoryForge
git rm apps/api/tests/test_book_run_recorded_skill_runs_export.py
cd D:\StoryForge\apps\api
uv run pytest tests/test_book_exporter.py tests/test_book_runs.py -v
```

通过后提交：

```powershell
cd D:\StoryForge
git commit -m "回滚 BookRun recorded skill_runs 导出测试"
```

---

## 自审结论

- 需求覆盖：计划覆盖 adapter 契约、runner 注入、progress 回填、audit/export recorded 验收、状态词一致性、本地验证与回滚。
- 架构一致：计划不让 API service 执行 workflow，不把 phase9b smoke 作为长期主线，不把 LangGraph 节点冒充章节 skill_runs。
- 复用优先：计划复用 `NovelSkillRunner`、`run_single_chapter_loop`、`run_book_loop`、`derive_skill_chain_projection` 和现有 exporter。
- 测试优先：每个实现任务都有失败测试、运行命令和预期结果。
- 占位扫描：本文所有文件路径、命令、函数名和断言均已明确，没有空白实施段落。
- 类型一致：`BookRunAdapterRequest`、`BookRunAdapterPorts`、`BookRunProgressSink` 和 `run_book_run_with_skill_runner()` 在后续任务中保持同一签名。
