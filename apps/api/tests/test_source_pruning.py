from pathlib import Path

from app.main import app

API_ROOT = Path(__file__).resolve().parents[1]


def test_batch_refinement_compatibility_api_stays_pruned() -> None:
    """旧批量精修兼容 API（batch-refinement）已下线，不应重新出现。

    注：batch-refinery（'ry'）自 W4 起作为冻结域卸载 router，其 router 卸载护栏见
    test_api_surface.py::test_frozen_domain_routers_stay_unmounted（此处只守旧 'ment' 兼容域）。"""

    domain_dir = API_ROOT / "app" / "domains" / "batch_refinement"
    openapi_paths = set(app.openapi()["paths"])

    assert not domain_dir.exists(), "batch_refinement 旧兼容域不应重新出现。"
    assert not any(path.startswith("/api/batch-refinement") for path in openapi_paths)


def test_legacy_top_level_health_route_stays_pruned() -> None:
    """旧顶层 /health 与新版 live/ready 重复，不应继续注册到 API 契约。"""

    registered_paths = {route.path for route in app.routes}
    openapi_paths = set(app.openapi()["paths"])
    dockerfile = API_ROOT / "Dockerfile"
    dockerfile_source = dockerfile.read_text(encoding="utf-8")

    assert "/health" not in registered_paths
    assert "/health" not in openapi_paths
    assert "/health/live" in registered_paths
    assert "/health/ready" in registered_paths
    assert "/health/live" in openapi_paths
    assert "/health/ready" in openapi_paths
    assert "http://127.0.0.1:8000/health/live" in dockerfile_source


def test_books_package_does_not_reexport_sqlalchemy_models() -> None:
    """books 包级入口不应重复转导出模型类，统一从 models.py 读取。"""

    books_init = API_ROOT / "app" / "domains" / "books" / "__init__.py"
    books_init_source = books_init.read_text(encoding="utf-8")

    for forbidden in (
        "Book",
        "Chapter",
        "Scene",
        "from app.domains.books.models import",
    ):
        assert forbidden not in books_init_source


def test_assets_package_does_not_reexport_sqlalchemy_models() -> None:
    """assets 包级入口不应重复转导出模型类，统一从 models.py 读取。"""

    assets_init = API_ROOT / "app" / "domains" / "assets" / "__init__.py"
    assets_init_source = assets_init.read_text(encoding="utf-8")

    for forbidden in (
        "Asset",
        "EvidenceLink",
        "from app.domains.assets.models import",
    ):
        assert forbidden not in assets_init_source


def test_continuity_package_does_not_reexport_sqlalchemy_models() -> None:
    """continuity 包级入口不应重复转导出模型类，统一从 models.py 读取。"""

    continuity_init = API_ROOT / "app" / "domains" / "continuity" / "__init__.py"
    continuity_init_source = continuity_init.read_text(encoding="utf-8")

    for forbidden in (
        "ContinuityRecord",
        "ScenePacket",
        "from app.domains.continuity.models import",
    ):
        assert forbidden not in continuity_init_source


def test_jobs_package_does_not_reexport_sqlalchemy_models() -> None:
    """jobs 包级入口不应重复转导出模型类，统一从 models.py 读取。"""

    jobs_init = API_ROOT / "app" / "domains" / "jobs" / "__init__.py"
    jobs_init_source = jobs_init.read_text(encoding="utf-8")

    for forbidden in (
        "JobRun",
        "from app.domains.jobs.models import",
    ):
        assert forbidden not in jobs_init_source


def test_series_package_does_not_reexport_sqlalchemy_models() -> None:
    """series 包级入口不应重复转导出模型类，统一从 models.py 读取。"""

    series_init = API_ROOT / "app" / "domains" / "series" / "__init__.py"
    series_init_source = series_init.read_text(encoding="utf-8")

    for forbidden in (
        "Series",
        "SeriesMemory",
        "SeriesMemoryEvidence",
        "from app.domains.series.models import",
    ):
        assert forbidden not in series_init_source


def test_context_compiler_package_does_not_reexport_service_functions() -> None:
    """context_compiler 的服务层已于 2026-10 随 scene_packets 一并删除（唯一消费方），
    只留 models.py 建表；包级入口不得把它转导出复活。"""

    context_compiler_init = API_ROOT / "app" / "domains" / "context_compiler" / "__init__.py"
    context_compiler_init_source = context_compiler_init.read_text(encoding="utf-8")

    for forbidden in (
        "compile_context",
        "from app.domains.context_compiler.service import",
    ):
        assert forbidden not in context_compiler_init_source


def test_judge_package_does_not_reexport_sqlalchemy_models() -> None:
    """judge 包级入口不应重复转导出模型类，统一从 models.py 读取。"""

    judge_init = API_ROOT / "app" / "domains" / "judge" / "__init__.py"
    judge_init_source = judge_init.read_text(encoding="utf-8")

    for forbidden in (
        "JudgeIssue",
        "RepairPatch",
        "from app.domains.judge.models import",
    ):
        assert forbidden not in judge_init_source


def test_story_memory_package_does_not_reexport_service_functions() -> None:
    """story_memory 包级入口不应重复转导出服务函数，统一从 service.py 读取。"""

    story_memory_init = API_ROOT / "app" / "domains" / "story_memory" / "__init__.py"
    story_memory_init_source = story_memory_init.read_text(encoding="utf-8")

    for forbidden in (
        "arbitrate_proposal",
        "atoms_active_at_chapter",
        "detect_memory_conflicts",
        "from app.domains.story_memory.service import",
    ):
        assert forbidden not in story_memory_init_source


def test_db_package_does_not_reexport_orm_base_symbols() -> None:
    """db 包级入口不应重复转导出 ORM 基础符号，统一从 base.py 读取。"""

    db_init = API_ROOT / "app" / "db" / "__init__.py"
    db_init_source = db_init.read_text(encoding="utf-8")

    for forbidden in (
        "Base",
        "IdMixin",
        "TimestampMixin",
        "VersionMixin",
        "from app.db.base import",
    ):
        assert forbidden not in db_init_source


def test_api_main_does_not_keep_slowapi_limiter_shell() -> None:
    """API 已使用 limits 自有分层限流，不应继续保留 SlowAPI 空壳。"""

    main_source = (API_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    pyproject_source = (API_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    uv_lock_source = (API_ROOT / "uv.lock").read_text(encoding="utf-8")

    for required in (
        "FixedWindowRateLimiter",
        "_rate_store",
        "_rate_strategy",
        "_READ_LIMIT",
        "_WRITE_LIMIT",
        "_BATCH_LIMIT",
        "enforce_tiered_rate_limit",
    ):
        assert required in main_source, f"真实分层限流路径必须保留：{required}"

    for forbidden in (
        "from slowapi",
        "limiter = Limiter",
        "app.state.limiter",
        "limiter.exempt",
    ):
        assert forbidden not in main_source

    assert '"limits' in pyproject_source, "API 真实限流直接导入 limits，必须保留直接依赖。"
    assert "slowapi" not in pyproject_source
    assert "slowapi" not in uv_lock_source


def test_jobs_runtime_bridge_helper_stays_pruned() -> None:
    """JobRun 的 runtime 读写契约不得退回 jobs 域的旧 helper。

    2026-07-26 `apps/workflow` 退役：原先对 workflow 侧 `model_run_sink` / `checkpoints`
    两个文件内容的断言随之删除（被断言的文件已不存在）。
    2026-10 `model_runs` 的读链路（`get_runs_job_run` / `runtime_diagnostics`）随其 router
    卸载一并删除，故不再断言它存在；JobRun 模型本身仍被 live `studio.service` 经
    `recovery_reads` 可达，progress 契约必须保留。"""

    jobs_service = API_ROOT / "app" / "domains" / "jobs" / "service.py"
    jobs_model = API_ROOT / "app" / "domains" / "jobs" / "models.py"

    jobs_service_source = jobs_service.read_text(encoding="utf-8") if jobs_service.exists() else ""
    jobs_model_source = jobs_model.read_text(encoding="utf-8")

    for required in (
        "class JobRun",
        "progress: Mapped[dict]",
    ):
        assert required in jobs_model_source, f"JobRun 读侧 progress 契约必须保留：{required}"

    for forbidden in (
        "JobRuntimeBridgeError",
        "sync_job_run_with_runtime",
    ):
        assert forbidden not in jobs_service_source, f"jobs/service.py 不应继续保留旧 runtime bridge helper：{forbidden}"


def test_orphaned_helpers_and_types_stay_pruned() -> None:
    """孤立 helper/type 不应因历史兼容清理重新回到生产模块。"""

    pagination_source = (API_ROOT / "app" / "common" / "pagination.py").read_text(encoding="utf-8")
    s3_source = (API_ROOT / "app" / "common" / "s3_client.py").read_text(encoding="utf-8")
    llm_env_source = (API_ROOT / "app" / "common" / "llm_env.py").read_text(encoding="utf-8")
    reranker_source = (API_ROOT / "app" / "domains" / "retrieval" / "reranker_client.py").read_text(
        encoding="utf-8"
    )

    assert "envelope_from_items" not in pagination_source
    assert "S3UploadError" not in s3_source
    assert "DisabledRerankerClient" not in reranker_source
    assert "apply_llm_config_file =" not in llm_env_source
    assert "apply_polish_config_file =" not in llm_env_source

    redis_source = (API_ROOT / "app" / "common" / "redis_cache.py").read_text(encoding="utf-8")
    assert "def cache_delete(" not in redis_source


def test_workflow_compat_dispatch_and_payload_facade_stay_pruned() -> None:
    """workflow-dispatch 兼容链与 record_workflow_model_run_payload facade 已随 apps/workflow 退役，不应重新出现。

    历史消费方 apps/workflow 已于 2026-07-26 物理退役；2026-09 全仓实证零消费方后整链删除：
    dispatch.py / gate.py / BookRunWorkflow* schema / workflow-dispatch 路由 /
    record_workflow_model_run_payload 及其孤儿 helper。恢复须走新决策，不得悄悄加回。
    """

    book_runs_root = API_ROOT / "app" / "domains" / "book_runs"
    model_runs_root = API_ROOT / "app" / "domains" / "model_runs"

    # 2026-10 自动整书链整体退役，book_runs 表与 5 个外键也已随迁移删除：整个域不应再出现。
    assert not list(book_runs_root.glob("*.py"))
    fk_holders = [
        path.relative_to(API_ROOT).as_posix()
        for path in (API_ROOT / "app" / "domains").rglob("models.py")
        if 'ForeignKey("book_runs.id"' in path.read_text(encoding="utf-8-sig")
    ]
    assert not fk_holders, f"仍有模型指向已删的 book_runs 表：{fk_holders}"

    # 2026-10：model_runs 的服务层（recording / router / runs_diagnostics / schemas / service）
    # 已随 router 卸载一并删除，只留 models.py 供 app/models.py 聚合建表。
    assert {path.name for path in model_runs_root.glob("*.py")} == {"__init__.py", "models.py"}

    registered_paths = {route.path for route in app.routes}
    assert "/api/book-runs/{book_run_id}/workflow-dispatch" not in registered_paths


def test_ide_zero_consumer_read_routes_stay_pruned() -> None:
    """没有 Desktop 调用方的 IDE 读路由不应重新暴露为 HTTP 契约。

    2026-09-28 正式退役对应实现与独占 DTO；本护栏继续保护六条旧路由不复活，
    实现层退役由下方护栏覆盖，live 命令/事件/跨章能力由行为测试保护。
    """

    pruned_paths = {
        "/api/ide/workspace-tree",
        "/api/ide/diagnostics",
        "/api/ide/scenes/{scene_id}",
        "/api/ide/context-snapshot/{compiled_context_id}",
        "/api/ide/story-memory/query",
        "/api/ide/artifacts/{artifact_id}/preview",
    }
    registered_paths = {route.path for route in app.routes}
    openapi_paths = set(app.openapi()["paths"])

    assert registered_paths.isdisjoint(pruned_paths)
    assert openapi_paths.isdisjoint(pruned_paths)


def test_ide_retired_read_implementations_and_dtos_stay_pruned() -> None:
    """旧 IDE 读投影无生产消费者，正式退役而非继续保留复用壳。"""

    from app.domains.ide import schemas, service

    ide_root = API_ROOT / "app" / "domains" / "ide"
    for module in ("workspace_reads", "artifact_preview", "context_snapshot", "story_memory_query"):
        assert not (ide_root / f"{module}.py").exists(), f"旧读模块不应复活：{module}"

    for name in (
        "get_workspace_tree",
        "list_diagnostics_for_scene",
        "read_ide_scene",
        "get_artifact_preview",
        "get_context_snapshot",
        "query_story_memory",
    ):
        assert not hasattr(service, name), f"旧读 facade 不应复活：{name}"

    retired_schemas = {
        "IdeTreeNode",
        "IdeWorkspaceTree",
        "IdeSceneRead",
        "IdeDiagnosticRange",
        "IdeQuickFix",
        "IdeDiagnostic",
        "IdeContextBudget",
        "IdeContextBlockRef",
        "IdeContextSnapshot",
        "IdeStoryMemoryQuery",
        "IdeStoryMemoryItem",
        "IdeStoryMemoryConflict",
        "IdeStoryMemoryQueryResult",
        "IdeArtifactPreviewContent",
        "IdeArtifactVersion",
        "IdeArtifactTraceLink",
        "IdeArtifactTrace",
        "IdeArtifactPreview",
    }
    for name in retired_schemas:
        assert not hasattr(schemas, name), f"旧读 DTO 不应复活：{name}"
    assert retired_schemas.isdisjoint(app.openapi()["components"]["schemas"])

    coerce_source = (ide_root / "_coerce.py").read_text(encoding="utf-8")
    assert "def _context_href(" not in coerce_source
    assert "def _string_or_none(" not in coerce_source


def test_unused_internal_helpers_and_subagent_read_dto_stay_pruned() -> None:
    from app.domains.agent_runs import knowledge_context, loop_runtime, schemas
    from app.domains.agent_runs.adapters import chapter_writing_contracts
    from app.domains.retrieval import pgvector

    for module, names in (
        (knowledge_context, ("with_project_knowledge_entries",)),
        (loop_runtime, ("_offered_schemas", "_BUDGET_EXHAUSTED_NOTICE")),
        (schemas, ("SubagentRunRead",)),
        (chapter_writing_contracts, ("_HARD_RULES",)),
        (pgvector, ("pgvector_engaged",)),
    ):
        for name in names:
            assert not hasattr(module, name), f"unused internal symbol must stay retired: {name}"
    assert "SubagentRunRead" not in app.openapi()["components"]["schemas"]
