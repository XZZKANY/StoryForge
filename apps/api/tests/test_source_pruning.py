from pathlib import Path

from app.main import app

API_ROOT = Path(__file__).resolve().parents[1]


def test_batch_refinement_compatibility_api_stays_pruned() -> None:
    """旧批量精修兼容 API 已下线，当前主链路应保持 batch-refinery。"""

    domain_dir = API_ROOT / "app" / "domains" / "batch_refinement"
    registered_paths = {route.path for route in app.routes}
    openapi_paths = set(app.openapi()["paths"])

    assert not domain_dir.exists(), "batch_refinement 旧兼容域不应重新出现。"
    assert not any(path.startswith("/api/batch-refinement") for path in registered_paths)
    assert not any(path.startswith("/api/batch-refinement") for path in openapi_paths)
    assert any(path.startswith("/api/batch-refinery") for path in registered_paths)
    assert any(path.startswith("/api/batch-refinery") for path in openapi_paths)


def test_legacy_top_level_health_route_stays_pruned() -> None:
    """旧顶层 /health 与新版 live/ready 重复，不应继续注册到 API 契约。"""

    registered_paths = {route.path for route in app.routes}
    openapi_paths = set(app.openapi()["paths"])
    dockerfile = API_ROOT / "Dockerfile"
    verify_local = API_ROOT.parents[1] / "scripts" / "verify-local.ps1"
    dockerfile_source = dockerfile.read_text(encoding="utf-8")
    verify_local_source = verify_local.read_text(encoding="utf-8")

    assert "/health" not in registered_paths
    assert "/health" not in openapi_paths
    assert "/health/live" in registered_paths
    assert "/health/ready" in registered_paths
    assert "/health/live" in openapi_paths
    assert "/health/ready" in openapi_paths
    assert "http://127.0.0.1:8000/health/live" in dockerfile_source
    assert "http://localhost:8000/health/live" in verify_local_source


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
    """context_compiler 包级入口不应重复转导出服务函数，统一从 service.py 读取。"""

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


def test_worldbuilding_package_does_not_reexport_service_functions() -> None:
    """worldbuilding 包级入口不应重复转导出服务函数，统一从 service.py 读取。"""

    worldbuilding_init = API_ROOT / "app" / "domains" / "worldbuilding" / "__init__.py"
    worldbuilding_init_source = worldbuilding_init.read_text(encoding="utf-8")

    for forbidden in (
        "build_worldbuilding_center",
        "from app.domains.worldbuilding.service import",
    ):
        assert forbidden not in worldbuilding_init_source


def test_batch_refinery_package_does_not_reexport_service_functions() -> None:
    """batch_refinery 包级入口不应重复转导出服务函数，统一从 service.py 读取。"""

    batch_refinery_init = API_ROOT / "app" / "domains" / "batch_refinery" / "__init__.py"
    batch_refinery_init_source = batch_refinery_init.read_text(encoding="utf-8")

    for forbidden in (
        "run_batch_refinery",
        "from app.domains.batch_refinery.service import",
    ):
        assert forbidden not in batch_refinery_init_source


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
    """JobRun runtime 读写契约应由 model_runs 与 workflow adapter 承担，不保留旧 helper。"""

    jobs_service = API_ROOT / "app" / "domains" / "jobs" / "service.py"
    jobs_model = API_ROOT / "app" / "domains" / "jobs" / "models.py"
    model_runs_service = API_ROOT / "app" / "domains" / "model_runs" / "service.py"
    workflow_checkpoints = API_ROOT.parents[1] / "apps" / "workflow" / "storyforge_workflow" / "runtime" / "checkpoints.py"

    jobs_service_source = jobs_service.read_text(encoding="utf-8") if jobs_service.exists() else ""
    jobs_model_source = jobs_model.read_text(encoding="utf-8")
    model_runs_service_source = model_runs_service.read_text(encoding="utf-8")
    workflow_checkpoints_source = workflow_checkpoints.read_text(encoding="utf-8")

    for required in (
        "class JobRun",
        "progress: Mapped[dict]",
    ):
        assert required in jobs_model_source, f"JobRun 读侧 progress 契约必须保留：{required}"

    for required in (
        "def get_runs_job_run(",
        "runtime_diagnostics",
        "def record_workflow_model_run_payload(",
    ):
        assert required in model_runs_service_source, f"model_runs 真实读写链路必须保留：{required}"

    assert "class ApiModelRunAdapter" in workflow_checkpoints_source, "workflow 到 API ModelRun 真表 adapter 必须保留。"

    for forbidden in (
        "JobRuntimeBridgeError",
        "sync_job_run_with_runtime",
    ):
        assert forbidden not in jobs_service_source, f"jobs/service.py 不应继续保留旧 runtime bridge helper：{forbidden}"
