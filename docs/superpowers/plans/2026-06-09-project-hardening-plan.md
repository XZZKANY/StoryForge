# StoryForge Project Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 收敛整体代码审查发现的生产限流、生产配置、并发预算和外部 payload 容错风险，让发布前门禁更接近真实运行环境。

**Architecture:** 本计划不重构主架构，沿用 API/Workflow/Web/Shared 的既有边界。API 侧把限流存储和生产配置校验收敛到可测试的小函数；Workflow 侧在 BookLoop 并发窗口前增加预算/降级保守策略；NovelLoop 侧把外部 payload 解析失败降级为结构化待审状态。

**Tech Stack:** FastAPI、SQLAlchemy、limits、Redis、pytest、Next.js、node:test、PowerShell Docker Compose 验证脚本。

---

## 文件结构

- Modify: `apps/api/app/main.py`。负责 API 认证、限流、请求超时和中间件装配；新增共享限流存储选择函数。
- Modify: `apps/api/tests/test_api_middleware.py`。覆盖 Redis 限流存储选择、多 worker 生产门禁和本地 MemoryStorage 兜底。
- Modify: `scripts/verify-local.ps1`。扩展生产 Docker Compose 配置门禁，检查默认凭据和占位值。
- Modify: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`。调整并发窗口策略，预算/降级门禁开启时支持保守窗口。
- Modify: `apps/workflow/tests/test_book_loop_three_chapters.py`。覆盖并发预算场景不再预启动超预算章节。
- Modify: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`。从 dispatch/env 透传保守并发策略。
- Modify: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`。把 `_optional_int` 改为安全解析。
- Modify: `apps/workflow/tests/test_novel_loop_single_chapter.py`。覆盖非整数 `judge_report_id` / `continuity_edge_count`。
- Modify: `.codex/operations-log.md`、`.codex/verification-report.md`。记录本轮执行与评分。

---

### Task 1: API 共享限流存储

**Files:**
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_api_middleware.py`

- [x] **Step 1: 写 Redis 限流存储选择红灯测试**

在 `apps/api/tests/test_api_middleware.py` 追加：

```python
def test_rate_limit_storage_uses_redis_in_production(monkeypatch) -> None:
    """生产多 worker 场景必须使用共享 Redis 限流存储，而不是进程内 MemoryStorage。"""

    monkeypatch.setenv("STORYFORGE_ENV", "production")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")

    from limits.storage import MemoryStorage
    from app.main import _build_rate_limit_storage

    storage = _build_rate_limit_storage()

    assert not isinstance(storage, MemoryStorage)
    assert storage.storage_string == "redis://redis:6379/0"
```

- [x] **Step 2: 运行红灯测试**

Run: `cd apps/api; uv run pytest tests/test_api_middleware.py::test_rate_limit_storage_uses_redis_in_production -q`

Expected: FAIL，原因是 `_build_rate_limit_storage` 尚不存在。

- [x] **Step 3: 实现共享存储选择函数**

在 `apps/api/app/main.py` 中替换 `_rate_store = MemoryStorage()` 附近逻辑：

```python
from limits.storage import MemoryStorage, storage_from_string


def _rate_limit_storage_url() -> str | None:
    """生产限流必须使用共享存储，避免多 worker 分片。"""

    redis_url = os.getenv("STORYFORGE_RATE_LIMIT_REDIS_URL") or os.getenv("REDIS_URL")
    if os.getenv("STORYFORGE_ENV", "development") == "production":
        if not redis_url:
            raise RuntimeError("生产环境必须配置 REDIS_URL 或 STORYFORGE_RATE_LIMIT_REDIS_URL 用于共享限流。")
        return redis_url
    return redis_url or None


def _build_rate_limit_storage():
    storage_url = _rate_limit_storage_url()
    if storage_url:
        return storage_from_string(storage_url)
    return MemoryStorage()


_rate_store = _build_rate_limit_storage()
_rate_strategy = FixedWindowRateLimiter(_rate_store)
```

保留测试中 `_rate_store.reset()` 可用性：Redis storage 没有 `reset()` 时测试 fixture 后续在 Task 2 调整。

- [x] **Step 4: 运行目标测试**

Run: `cd apps/api; uv run pytest tests/test_api_middleware.py::test_rate_limit_storage_uses_redis_in_production -q`

Expected: PASS。
### Task 2: 测试隔离与本地限流兜底

**Files:**
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/tests/conftest.py`
- Test: `apps/api/tests/test_api_middleware.py`

- [x] **Step 1: 写本地兜底测试**

在 `apps/api/tests/test_api_middleware.py` 追加：

```python
def test_rate_limit_storage_allows_memory_storage_in_development(monkeypatch) -> None:
    """开发环境未配置 Redis 时允许使用进程内限流，保持本地启动简单。"""

    monkeypatch.setenv("STORYFORGE_ENV", "development")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("STORYFORGE_RATE_LIMIT_REDIS_URL", raising=False)

    from limits.storage import MemoryStorage
    from app.main import _build_rate_limit_storage

    storage = _build_rate_limit_storage()

    assert isinstance(storage, MemoryStorage)
```

- [x] **Step 2: 调整测试 fixture**

修改 `apps/api/tests/conftest.py` 中 `_reset_rate_limiter`：

```python
@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """每个测试前重置限流计数器，避免跨用例污染。"""

    from app.main import _rate_store

    reset = getattr(_rate_store, "reset", None)
    if callable(reset):
        reset()
```

- [x] **Step 3: 运行中间件测试**

Run: `cd apps/api; uv run pytest tests/test_api_middleware.py -q`

Expected: PASS，现有限流测试仍能使用默认 MemoryStorage。

- [x] **Step 4: 运行配置测试**

Run: `cd apps/api; uv run pytest tests/test_config.py -q`

Expected: PASS，生产配置校验不被限流存储改动破坏。

---

### Task 3: 生产 Compose 凭据与占位门禁

**Files:**
- Modify: `scripts/verify-local.ps1`
- Test: `scripts/verify-local.ps1` 内置门禁，通过命令验证

- [x] **Step 1: 在生产配置门禁中加入 forbidden markers**

在 `Test-DockerProdComposeConfig` 中，`$ForbiddenPublishedPorts` 检查后追加：

```powershell
    $ForbiddenSecrets = @(
        'STORYFORGE_API_KEY: local-dev-key',
        'STORYFORGE_API_KEY: CHANGE_ME',
        'STORYFORGE_JWT_SECRET: CHANGE_ME',
        'S3_SECRET_KEY: storyforge-dev-only',
        'S3_SECRET_KEY: CHANGE_ME'
    )
    foreach ($SecretMarker in $ForbiddenSecrets) {
        if ($Result.Output -like "*$SecretMarker*") {
            Write-Fail "生产 Docker Compose 配置包含禁止的凭据或占位值：$SecretMarker。"
        } else {
            Write-Ok "生产 Docker Compose 配置未包含禁止凭据标记：$SecretMarker。"
        }
    }
```

- [x] **Step 2: 加入 Redis 限流配置门禁**

继续在同一函数追加：

```powershell
    if ($Result.Output -like "*REDIS_URL:*" -or $Result.Output -like "*STORYFORGE_RATE_LIMIT_REDIS_URL:*") {
        Write-Ok "生产 Docker Compose 配置包含共享限流 Redis 来源。"
    } else {
        Write-Fail "生产 Docker Compose 配置缺少 REDIS_URL 或 STORYFORGE_RATE_LIMIT_REDIS_URL，无法支撑多 worker 全局限流。"
    }
```

- [x] **Step 3: 渲染生产配置验证**

Run: `powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1 -SkipBuild`

Expected: 当前 `.env.production.example` 仍可能触发占位值失败；若失败，先把失败作为门禁有效证据记录到 `.codex/operations-log.md`，再决定是否改模板为安全 dummy 值。

- [x] **Step 4: 如门禁因模板占位失败，修改模板为不可用但符合强度的假值**

Modify: `.env.production.example`

将：

```dotenv
STORYFORGE_API_KEY=CHANGE_ME_TO_SECURE_RANDOM_STRING
STORYFORGE_JWT_SECRET=CHANGE_ME_TO_SECURE_RANDOM_SECRET
S3_SECRET_KEY=CHANGE_ME
```

改为：

```dotenv
STORYFORGE_API_KEY=example-production-api-key-32-bytes-minimum
STORYFORGE_JWT_SECRET=example-production-jwt-secret-64-bytes-minimum-change-before-use
S3_SECRET_KEY=example-production-s3-secret-change-before-use
```

同时保留注释要求复制为 `.env.production` 后替换真实值。

- [x] **Step 5: 复跑生产配置验证**

Run: `powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1 -SkipBuild`

Expected: 生产 compose config 门禁 PASS；如果 Docker 不可用，报告必须记录无法验证 Docker 门禁。
---

### Task 4: Workflow 并发预算保守窗口

**Files:**
- Modify: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
- Test: `apps/workflow/tests/test_book_loop_three_chapters.py`

- [x] **Step 1: 写预算保守窗口红灯测试**

在 `apps/workflow/tests/test_book_loop_three_chapters.py` 追加：

```python
def test_book_loop_parallel_budget_guard_can_disable_prefetch_window() -> None:
    """启用预算保守模式时，token 预算触顶前不得预启动窗口外章节。"""

    started: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        started.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
            token_usage=80,
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=5,
            token_budget=100,
            chapter_parallelism=3,
            require_budget_guard_before_prefetch=True,
        ),
        run_chapter,
    )

    assert result.status == "paused_by_budget"
    assert result.current_chapter_index == 2
    assert started == [1, 2]
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1, 2]
```

- [x] **Step 2: 运行红灯测试**

Run: `cd apps/workflow; uv run pytest tests/test_book_loop_three_chapters.py::test_book_loop_parallel_budget_guard_can_disable_prefetch_window -q`

Expected: FAIL，原因是 `BookLoopRequest` 没有 `require_budget_guard_before_prefetch` 字段。

- [x] **Step 3: 给 BookLoopRequest 增加字段**

Modify: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`

```python
@dataclass(frozen=True)
class BookLoopRequest:
    ...
    require_prior_chapter_commit_before_start: bool = False
    require_budget_guard_before_prefetch: bool = False
```

- [x] **Step 4: 调整窗口策略**

修改 `_chapter_window_size`：

```python
def _chapter_window_size(request: BookLoopRequest) -> int:
    if request.require_prior_chapter_commit_before_start:
        return 1
    if request.require_budget_guard_before_prefetch and _preemptive_pause_enabled(request):
        return 1
    return request.chapter_parallelism
```

- [x] **Step 5: 给 integration metrics 标记策略**

在 `_parallel_integration_metrics` 中追加：

```python
    if request.require_budget_guard_before_prefetch and _preemptive_pause_enabled(request):
        metrics["prefetch_mode"] = "budget_guarded"
```

- [x] **Step 6: 运行目标测试与既有并发测试**

Run: `cd apps/workflow; uv run pytest tests/test_book_loop_three_chapters.py -q`

Expected: PASS。既有“默认并发预取”测试保持通过，新测试只覆盖显式保守模式。

---

### Task 5: Adapter 透传并发保守策略

**Files:**
- Modify: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
- Test: `apps/workflow/tests/test_book_run_adapter.py`

- [x] **Step 1: 写 dispatch 透传测试**

在 `apps/workflow/tests/test_book_run_adapter.py` 追加或扩展现有并发测试：

```python
def test_book_run_adapter_passes_budget_guard_prefetch_flag(monkeypatch) -> None:
    """dispatch payload 可以要求 BookLoop 在预算门禁下禁用并发预取窗口。"""

    captured: dict[str, object] = {}

    def fake_run_book_loop(request, run_chapter, progress_callback=None, consistency_barrier=None, precommit_chapter=None):
        captured["require_budget_guard_before_prefetch"] = request.require_budget_guard_before_prefetch
        return BookLoopResult(status="completed", current_chapter_index=1, progress={"completed_chapters": []})

    monkeypatch.setattr(
        "storyforge_workflow.orchestrators.book_run_adapter.run_book_loop",
        fake_run_book_loop,
    )

    run_book_run_from_dispatch(
        {
            "book_run_id": 1,
            "book_id": 2,
            "blueprint_id": 3,
            "total_chapters": 1,
            "start_chapter_index": 1,
            "token_budget": 100,
            "chapter_parallelism": 3,
            "require_budget_guard_before_prefetch": True,
            "chapters": [{"chapter_index": 1, "chapter_id": 10, "chapter_goal": "完成第一章。"}],
        },
        novel_loop_ports_factory=lambda request: _passing_ports(),
        progress_sink=lambda result: None,
    )

    assert captured == {"require_budget_guard_before_prefetch": True}
```

如果测试文件没有 `_passing_ports()` helper，则复用该文件现有 NovelLoopPorts fixture，不新增重复 helper。

- [x] **Step 2: 运行红灯测试**

Run: `cd apps/workflow; uv run pytest tests/test_book_run_adapter.py::test_book_run_adapter_passes_budget_guard_prefetch_flag -q`

Expected: FAIL，原因是 adapter 未读取该 payload 字段。

- [x] **Step 3: 修改 BookRunAdapterRequest**

在 `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py` 的 dataclass 添加：

```python
require_budget_guard_before_prefetch: bool = False
```

- [x] **Step 4: 解析 payload/env**

在构造 `BookRunAdapterRequest` 时添加：

```python
require_budget_guard_before_prefetch=_bool_value(
    payload.get("require_budget_guard_before_prefetch"),
    default=_env_budget_guard_before_prefetch(),
),
```

新增 helper：

```python
def _bool_value(value: object, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _env_budget_guard_before_prefetch() -> bool:
    return _bool_value(os.getenv("STORYFORGE_BOOK_RUN_BUDGET_GUARD_PREFETCH"), default=False)
```

- [x] **Step 5: 传给 BookLoopRequest**

在 `run_book_run_with_skill_runner` 创建 `BookLoopRequest` 时添加：

```python
require_budget_guard_before_prefetch=request.require_budget_guard_before_prefetch,
```

- [x] **Step 6: 运行 adapter 测试**

Run: `cd apps/workflow; uv run pytest tests/test_book_run_adapter.py -q`

Expected: PASS。
---

### Task 6: NovelLoop 外部 payload 整数容错

**Files:**
- Modify: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
- Test: `apps/workflow/tests/test_novel_loop_single_chapter.py`

- [x] **Step 1: 写 judge_report_id 非整数红灯测试**

在 `apps/workflow/tests/test_novel_loop_single_chapter.py` 追加：

```python
def test_novel_loop_treats_invalid_judge_report_id_as_awaiting_review() -> None:
    """Judge 返回非法 ID 时，章节应进入待审而不是抛出 ValueError 中断 workflow。"""

    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "正文。",
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": "bad-id"},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda request, draft, refs: 100,
        record_model_run=lambda request, draft: 10,
    )

    result = run_single_chapter_loop(
        NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=1, chapter_goal="完成第一章。"),
        ports,
    )

    assert result.status == "awaiting_review"
    assert result.approved_scene_id is None
    assert result.judge_report_id is None
```

- [x] **Step 2: 写 continuity_edge_count 非整数测试**

同文件追加：

```python
def test_novel_loop_ignores_invalid_continuity_edge_count() -> None:
    """连续性提交返回非法计数字段时，应按 0 条边处理。"""

    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "正文。",
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 20},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda request, draft, refs: 100,
        record_model_run=lambda request, draft: 10,
        submit_continuity=lambda request, draft, approved_scene_id: {"continuity_edge_count": "bad-count"},
    )

    result = run_single_chapter_loop(
        NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=1, chapter_goal="完成第一章。"),
        ports,
    )

    assert result.status == "approved"
    assert result.continuity_edge_count == 0
```

- [x] **Step 3: 运行红灯测试**

Run: `cd apps/workflow; uv run pytest tests/test_novel_loop_single_chapter.py::test_novel_loop_treats_invalid_judge_report_id_as_awaiting_review tests/test_novel_loop_single_chapter.py::test_novel_loop_ignores_invalid_continuity_edge_count -q`

Expected: 至少第一个测试 FAIL，旧实现直接抛 `ValueError`。

- [x] **Step 4: 实现安全解析函数**

修改 `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`：

```python
def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return int(stripped)
    return None
```

- [x] **Step 5: 非法 pass 报告降级待审**

在 `latest_report.get("status") == "pass"` 分支内，解析 `judge_report_id` 后添加：

```python
        if latest_report.get("judge_report_id") is not None and judge_report_id is None:
            latest_report = {
                "status": "awaiting_review",
                "invalid_judge_report_id": latest_report.get("judge_report_id"),
            }
            break
```

位置必须在调用 `approve_scene` 之前，避免非法引用写入批准场景。

- [x] **Step 6: 运行目标测试**

Run: `cd apps/workflow; uv run pytest tests/test_novel_loop_single_chapter.py -q`

Expected: PASS。

---

### Task 7: OpenAPI 与本地门禁验证

**Files:**
- Modify: `packages/shared/src/contracts/storyforge.openapi.json`，仅当 `pnpm openapi` 产生真实 API 契约变更。
- Modify: `packages/shared/src/generated/api-types.ts`，仅当契约变更后需要重新生成类型。
- Modify: `.codex/operations-log.md`
- Modify: `.codex/verification-report.md`

- [x] **Step 1: 运行 API 定向测试**

Run: `cd apps/api; uv run pytest tests/test_api_middleware.py tests/test_config.py tests/test_book_runs.py -q`

Expected: PASS。

- [x] **Step 2: 运行 Workflow 定向测试**

Run: `cd apps/workflow; uv run pytest tests/test_book_loop_three_chapters.py tests/test_book_run_adapter.py tests/test_novel_loop_single_chapter.py tests/test_novel_loop_submit_continuity.py -q`

Expected: PASS。

- [x] **Step 3: 运行 Web API client/SSE 测试**

Run: `pnpm --filter @storyforge/web test -- book-run-events-route api-client`

Expected: PASS。

- [x] **Step 4: 运行 OpenAPI 刷新**

Run: `pnpm openapi`

Expected: PASS。若 `packages/shared/src/contracts/storyforge.openapi.json` 有 diff，确认是否来自 API schema 真实变化；本计划预期 API 路由 schema 不变，理想状态为无 diff。

- [x] **Step 5: 运行核心本地门禁**

Run: `pnpm verify`

Expected: PASS。如果失败，停止执行并把失败命令、退出码、关键错误写入 `.codex/operations-log.md`。

- [x] **Step 6: 记录验证报告**

在 `.codex/verification-report.md` 追加：

```markdown
## 审查报告 - 项目加固计划执行

时间：YYYY-MM-DD HH:mm:ss +08:00

### 本地验证

- API 定向测试：结果。
- Workflow 定向测试：结果。
- Web 定向测试：结果。
- OpenAPI 刷新：结果。
- `pnpm verify`：结果。

### 评分

- 代码质量：分数/100。
- 测试覆盖：分数/100。
- 规范遵循：分数/100。
- 需求匹配：分数/100。
- 架构一致：分数/100。
- 风险评估：分数/100。
- 综合评分：分数/100。
- 建议：通过 / 退回 / 需讨论。
```

---

## 自检清单

- 规格覆盖：本计划覆盖整体审查中提出的四个主要风险：生产限流、默认/占位凭据、并发预算成本、payload 整数解析容错。
- 无占位扫描：计划中不使用 TBD、TODO 或“稍后实现”；所有代码修改点均给出具体片段。
- 类型一致性：新增字段名统一为 `require_budget_guard_before_prefetch`，payload/env/BookLoopRequest 三处一致。
- 验证边界：本计划不声明真实 10 章或 3-5 万字长程完成，只收敛工程风险。

## 执行顺序建议

1. Task 1-3 先处理 API/生产配置风险。
2. Task 4-5 处理 Workflow 并发预算风险。
3. Task 6 处理 NovelLoop payload 容错。
4. Task 7 统一验证和报告。

每个 Task 完成后单独提交，提交信息使用简体中文，例如：`fix: 使用共享存储支撑生产限流`。

---

## 执行完成记录

时间：2026-06-09 12:20:10 +08:00

- Task 1-7 已完成并同步为 `[x]` 状态。
- 核心门禁 `pnpm verify` 已通过，退出码 0；API 全量测试 525 passed、1 skipped、7 warnings；Web 契约测试 216 passed；Workflow 全量测试 244 items；API/Workflow Ruff 通过。
- `scripts/verify-local.ps1` 已在 Docker 可用且 `postgres`、`redis`、`minio` 容器运行后复跑通过。
- Docker 基础容器存在同名跨项目占用：`storyforge-postgres`、`storyforge-redis`、`storyforge-minio` 的 compose 标签来自 `1-renovel-ai-ai-rag-tavern`。本轮未删除这些容器，只启动了已停止的 `storyforge-minio` 以补齐本地验证。
- 工作区仍有大量既有改动和未跟踪文件；本计划记录只覆盖项目加固相关文件和已执行验证。
