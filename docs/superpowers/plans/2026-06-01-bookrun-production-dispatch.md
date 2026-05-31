# BookRun Production Dispatch Implementation Plan

> **给执行代理的要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行。所有步骤使用复选框（`- [ ]`）跟踪。所有验证必须在本地完成，并写入 `D:\StoryForge\.codex\verification-report.md`。

**目标：** 为 BookRun workflow adapter 补齐生产调度接线契约，让 API 能生成 workflow dispatch payload，workflow 能消费该 payload 并回填 recorded `skill_runs` progress。

**架构：** API 仍是 BookRun 真相源，只创建运行记录、生成 dispatch payload、接收 progress patch，不在 API service 内直接执行 workflow。workflow 侧新增 payload 消费入口，把 API dispatch JSON 转为 `BookRunAdapterRequest` 与章节端口映射，继续复用 `run_book_run_with_skill_runner()`、`BookLoop`、`NovelLoop` 和 `NovelSkillRunner`。

**Tech Stack:** Python 3.13、FastAPI、Pydantic、SQLAlchemy、pytest、ruff、现有 ports/dataclass 模式。

---

## 文件职责总览

### 新增文件

- `D:\StoryForge\apps\api\tests\test_book_run_workflow_dispatch.py`
  - 验证 API 能为 running BookRun 生成 workflow dispatch payload，并拒绝缺少章节计划或非 running 状态。
- `D:\StoryForge\apps\workflow\tests\test_book_run_dispatch_payload.py`
  - 验证 workflow 能消费 API 形状的 dispatch payload，产出 recorded skill_runs 并回填 progress sink。

### 修改文件

- `D:\StoryForge\apps\api\app\domains\book_runs\schemas.py`
  - 增加 `BookRunWorkflowChapter` 与 `BookRunWorkflowDispatch` 响应模型。
- `D:\StoryForge\apps\api\app\domains\book_runs\service.py`
  - 增加 `build_book_run_workflow_dispatch()`，只生成 payload，不执行 workflow。
- `D:\StoryForge\apps\api\app\domains\book_runs\router.py`
  - 增加 `GET /api/book-runs/{book_run_id}/workflow-dispatch` 内部调度 payload 读取接口。
- `D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\book_run_adapter.py`
  - 增加 `CallableProgressSink` 与 `run_book_run_dispatch_payload()`。
- `D:\StoryForge\.codex\operations-log.md`
  - 记录实施和验证过程。
- `D:\StoryForge\.codex\verification-report.md`
  - 记录最终验证和结论。

### 明确不修改

- 不在 `apps/api/app/domains/book_runs/service.py` 内调用 workflow adapter。
- 不接入真实 LLM。
- 不修改 LangGraph 节点事件语义。
- 不恢复历史 stash。

---

## Task 1：API dispatch payload 契约

**目标：** API 生成可供 workflow worker 消费的稳定 JSON payload，但不执行 workflow。

- [ ] **Step 1：写失败测试**

在 `D:\StoryForge\apps\api\tests\test_book_run_workflow_dispatch.py` 写入测试：

```python
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.blueprints.service import trigger_chapter_plan
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.service import build_book_run_workflow_dispatch
from app.domains.books.models import Book


def seed_dispatchable_book_run(session_factory: sessionmaker[Session]) -> int:
    with session_factory() as session:
        book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="林岚在雾港追查失真的灯塔信号。",
            tone="克制悬疑",
            target_word_count=4500,
            target_chapter_count=2,
            chapter_word_count_min=1000,
            chapter_word_count_max=1800,
            status="locked",
            version=2,
            metadata_={},
        )
        session.add(blueprint)
        session.commit()
        trigger_chapter_plan(session, blueprint.id)
        book_run = BookRun(
            book_id=book.id,
            blueprint_id=blueprint.id,
            status="running",
            current_chapter_index=1,
            total_chapters=2,
            progress={"completed_chapters": []},
            checkpoint=[],
            token_budget=1000,
            tokens_used=0,
            time_budget_sec=300,
            elapsed_time_sec=0,
            chapter_budget=2,
            estimated_cost=0.0,
            cost_summary={"estimated_cost": 0.0},
        )
        session.add(book_run)
        session.commit()
        return book_run.id


def test_build_book_run_workflow_dispatch_payload(session_factory: sessionmaker[Session]) -> None:
    book_run_id = seed_dispatchable_book_run(session_factory)

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.book_run_id == book_run_id
    assert dispatch.start_chapter_index == 1
    assert dispatch.total_chapters == 2
    assert dispatch.token_budget == 1000
    assert dispatch.time_budget_sec == 300
    assert dispatch.chapter_budget == 2
    assert [chapter.chapter_index for chapter in dispatch.chapters] == [1, 2]
    assert all(chapter.chapter_id > 0 for chapter in dispatch.chapters)
    assert dispatch.chapters[0].chapter_goal


def test_workflow_dispatch_endpoint_returns_payload(client: TestClient, session_factory: sessionmaker[Session]) -> None:
    book_run_id = seed_dispatchable_book_run(session_factory)

    response = client.get(f"/api/book-runs/{book_run_id}/workflow-dispatch")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["book_run_id"] == book_run_id
    assert payload["chapters"][0]["chapter_index"] == 1
    assert payload["chapters"][0]["chapter_goal"]


def test_workflow_dispatch_requires_chapter_plan(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        book = Book(title="未规划作品", status="draft", premise="缺少章节计划。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="缺少章节计划。",
            tone="克制",
            target_word_count=3000,
            target_chapter_count=1,
            chapter_word_count_min=800,
            chapter_word_count_max=1200,
            status="locked",
            version=1,
            metadata_={},
        )
        session.add(blueprint)
        session.flush()
        book_run = BookRun(
            book_id=book.id,
            blueprint_id=blueprint.id,
            status="running",
            current_chapter_index=1,
            total_chapters=1,
            progress={"completed_chapters": []},
            checkpoint=[],
            cost_summary={"estimated_cost": 0.0},
        )
        session.add(book_run)
        session.commit()
        book_run_id = book_run.id

        try:
            build_book_run_workflow_dispatch(session, book_run_id)
        except Exception as exc:
            assert "章节计划" in str(exc)
        else:
            raise AssertionError("缺少章节计划时必须拒绝生成 dispatch。")
```

- [ ] **Step 2：运行红灯测试**

```powershell
cd D:\StoryForge\apps\api
uv run pytest tests/test_book_run_workflow_dispatch.py -v
```

Expected: import 或 attribute 失败，证明契约尚未实现。

- [ ] **Step 3：实现 API schema/service/router**

新增 Pydantic 模型、`build_book_run_workflow_dispatch()` 和 `GET /workflow-dispatch`。

- [ ] **Step 4：运行 API 目标测试**

```powershell
cd D:\StoryForge\apps\api
uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_book_runs.py -v
```

Expected: 全部通过。

- [ ] **Step 5：提交 API dispatch 契约**

```powershell
cd D:\StoryForge
git add apps/api/app/domains/book_runs/schemas.py apps/api/app/domains/book_runs/service.py apps/api/app/domains/book_runs/router.py apps/api/tests/test_book_run_workflow_dispatch.py .codex/operations-log.md
git diff --cached --check
git commit -m "新增 BookRun workflow dispatch payload 契约"
```

---

## Task 2：workflow 消费 dispatch payload

**目标：** workflow 包消费 API 形状 payload，产出 recorded skill_runs 并通过 progress sink 回填。

- [ ] **Step 1：写失败测试**

在 `D:\StoryForge\apps\workflow\tests\test_book_run_dispatch_payload.py` 写入测试，构造 API dispatch payload，调用 `run_book_run_dispatch_payload()`，断言 sink 收到 completed progress 和 recorded skill_runs。

- [ ] **Step 2：运行红灯测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_dispatch_payload.py -v
```

Expected: `run_book_run_dispatch_payload` 不存在。

- [ ] **Step 3：实现 workflow payload 消费入口**

在 `book_run_adapter.py` 中新增：

- `CallableProgressSink`
- `run_book_run_dispatch_payload(payload, novel_loop_ports_factory, progress_sink)`
- 章节映射完整性校验

- [ ] **Step 4：运行 workflow 目标测试**

```powershell
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_dispatch_payload.py tests/test_book_run_adapter.py -v
```

Expected: 全部通过。

- [ ] **Step 5：提交 workflow dispatch 消费入口**

```powershell
cd D:\StoryForge
git add apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py apps/workflow/tests/test_book_run_dispatch_payload.py .codex/operations-log.md
git diff --cached --check
git commit -m "支持 workflow 消费 BookRun dispatch payload"
```

---

## Task 3：本地端到端验收与报告

**目标：** 证明 API dispatch payload 与 workflow adapter 契约能组合成完整本地链路。

- [ ] **Step 1：运行目标回归**

```powershell
cd D:\StoryForge\apps\api
uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_book_runs.py tests/test_book_exporter.py tests/test_book_run_recorded_skill_runs_export.py -v
cd D:\StoryForge\apps\workflow
uv run pytest tests/test_book_run_dispatch_payload.py tests/test_book_run_adapter.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v
```

- [ ] **Step 2：运行 lint 和全量测试**

```powershell
cd D:\StoryForge\apps\api
uv run ruff check .
uv run pytest -q
cd D:\StoryForge\apps\workflow
uv run ruff check .
uv run pytest -q
cd D:\StoryForge
pnpm --filter @storyforge/web test -- book-run-audit
```

- [ ] **Step 3：写验证报告**

追加 `.codex/verification-report.md`，记录命令、结果、recorded skill_runs 证据和未解决风险。

- [ ] **Step 4：提交验证报告**

```powershell
cd D:\StoryForge
git add .codex/verification-report.md .codex/operations-log.md
git diff --cached --check
git commit -m "验证 BookRun workflow dispatch 生产接线契约"
```
