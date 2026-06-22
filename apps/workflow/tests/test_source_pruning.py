from pathlib import Path

WORKFLOW_ROOT = Path(__file__).resolve().parents[1]


def test_workflow_longform_experimental_cli_stays_pruned() -> None:
    """独立长文实验 CLI 已下线，后续长文能力应接入正式 workflow 链路。"""

    longform_module = WORKFLOW_ROOT / "storyforge_workflow" / "longform.py"
    dockerfile = WORKFLOW_ROOT / "Dockerfile"
    dockerfile_content = dockerfile.read_text(encoding="utf-8")

    assert not longform_module.exists(), "storyforge_workflow.longform 独立 CLI 不应重新出现。"
    assert "storyforge_workflow.longform" not in dockerfile_content
    assert "python -m storyforge_workflow.longform" not in dockerfile_content


def test_runtime_does_not_reexport_provider_generate_text() -> None:
    """runtime 只暴露 adapter/execution 边界，不转导出底层 provider client。"""

    provider_execution = WORKFLOW_ROOT / "storyforge_workflow" / "runtime" / "provider_execution.py"
    runtime_init = WORKFLOW_ROOT / "storyforge_workflow" / "runtime" / "__init__.py"
    provider_execution_source = provider_execution.read_text(encoding="utf-8")
    runtime_init_source = runtime_init.read_text(encoding="utf-8")

    assert "from storyforge_workflow.provider_client import generate_text" not in provider_execution_source
    assert '"generate_text"' not in provider_execution_source
    assert "from storyforge_workflow.runtime.provider_execution import ProviderExecutionResult, execute_provider_text, generate_text" not in runtime_init_source
    assert '"generate_text"' not in runtime_init_source


def test_provider_gateway_registry_points_to_settings_instead_of_static_page() -> None:
    """Provider Gateway 运行时工具应指向桌面端设置页，而不是已退场 Web 页。"""

    registry = WORKFLOW_ROOT / "storyforge_workflow" / "tools" / "registry.py"
    registry_source = registry.read_text(encoding="utf-8")

    assert "apps/web/" not in registry_source
    assert "apps/desktop/frontend/src/components/SettingsView.tsx" in registry_source


def test_tools_package_does_not_reexport_creative_tool_registry() -> None:
    """tools 包级入口不应重复转导出 CreativeToolRegistry，统一从 registry.py 读取。"""

    tools_init = WORKFLOW_ROOT / "storyforge_workflow" / "tools" / "__init__.py"
    tools_init_source = tools_init.read_text(encoding="utf-8")

    for forbidden in (
        "DEFAULT_CREATIVE_TOOL_REGISTRY",
        "CreativeToolReferences",
        "CreativeToolRegistry",
        "CreativeToolSpec",
        "get_creative_tool",
        "list_creative_tools",
        "from storyforge_workflow.tools.registry import",
    ):
        assert forbidden not in tools_init_source


def test_orchestrators_package_does_not_reexport_book_run_adapter() -> None:
    """orchestrators 包级入口不应重复转导出 BookRun adapter，统一从具体模块读取。"""

    orchestrators_init = WORKFLOW_ROOT / "storyforge_workflow" / "orchestrators" / "__init__.py"
    orchestrators_init_source = orchestrators_init.read_text(encoding="utf-8")

    for forbidden in (
        "BookRunAdapterPorts",
        "BookRunAdapterRequest",
        "BookRunProgressSink",
        "CallableProgressSink",
        "CapturingProgressSink",
        "run_book_run_dispatch_payload",
        "run_book_run_with_skill_runner",
        "from storyforge_workflow.orchestrators.book_run_adapter import",
    ):
        assert forbidden not in orchestrators_init_source


def test_skills_package_does_not_reexport_novel_skill_symbols() -> None:
    """skills 包级入口不应重复转导出 Novel skill 符号，统一从具体模块读取。"""

    skills_init = WORKFLOW_ROOT / "storyforge_workflow" / "skills" / "__init__.py"
    skills_init_source = skills_init.read_text(encoding="utf-8")

    for forbidden in (
        "BookRunSkillProjection",
        "NovelSkillRunEvent",
        "derive_skill_chain_projection",
        "validate_novel_skill_registry",
        "list_novel_skill_diagnostics",
        "explain_bookrun_skill_chain",
        "DEFAULT_NOVEL_SKILL_REGISTRY",
        "NovelSkillDefinition",
        "NovelSkillReferences",
        "NovelSkillRegistry",
        "get_novel_skill",
        "list_novel_skills",
        "from storyforge_workflow.skills.audit import",
        "from storyforge_workflow.skills.definitions import",
        "from storyforge_workflow.skills.diagnostics import",
    ):
        assert forbidden not in skills_init_source


def test_nodes_package_does_not_reexport_generation_nodes() -> None:
    """nodes 包级入口不应重复转导出生成节点，统一从具体模块读取。"""

    nodes_init = WORKFLOW_ROOT / "storyforge_workflow" / "nodes" / "__init__.py"
    nodes_init_source = nodes_init.read_text(encoding="utf-8")

    for forbidden in (
        "create_book_strategy",
        "create_draft_excerpt",
        "create_chapter_plan",
        "create_scene_beats",
        "from storyforge_workflow.nodes.director import",
        "from storyforge_workflow.nodes.draft_writer import",
        "from storyforge_workflow.nodes.scene_architect import",
    ):
        assert forbidden not in nodes_init_source


def test_deterministic_chapter_planner_package_stays_pruned() -> None:
    """未接入主图的 deterministic chapter planner 不应作为独立包继续保留。"""

    stale_planner_module = WORKFLOW_ROOT / "storyforge_workflow" / "planners" / "chapter_planner.py"
    stale_planners_init = WORKFLOW_ROOT / "storyforge_workflow" / "planners" / "__init__.py"
    stale_planner_test = WORKFLOW_ROOT / "tests" / "test_chapter_planner.py"

    assert not stale_planner_module.exists(), "planners/chapter_planner.py 未接入主图运行链路，应删除。"
    assert not stale_planners_init.exists(), "planners 包仅服务已下线 chapter_planner，应删除。"
    assert not stale_planner_test.exists(), "test_chapter_planner.py 只覆盖已下线 planner，应删除。"

    for source_path in [*WORKFLOW_ROOT.rglob("storyforge_workflow/**/*.py"), *WORKFLOW_ROOT.rglob("tests/**/*.py")]:
        if source_path == Path(__file__).resolve():
            continue
        source = source_path.read_text(encoding="utf-8")
        assert "storyforge_workflow.planners" not in source, f"{source_path} 不应继续导入已下线 planners 包。"


def test_genre_novel_skill_preview_pack_stays_pruned() -> None:
    """题材 NovelSkill 预留包未接入默认运行链路，不应继续保留静态合同。"""

    definitions = WORKFLOW_ROOT / "storyforge_workflow" / "skills" / "definitions.py"
    skills_root = WORKFLOW_ROOT / "storyforge_workflow" / "skills"
    definitions_source = definitions.read_text(encoding="utf-8")

    for stale_symbol in (
        "with_genre_pack",
        "GENRE_NOVEL_SKILL_PACKS",
        "CLUE_FAIRNESS_JUDGE_SKILL",
        "POWER_SCALE_GUARD_SKILL",
        "RELATIONSHIP_ARC_JUDGE_SKILL",
    ):
        assert stale_symbol not in definitions_source, f"definitions.py 不应继续保留题材技能预留符号：{stale_symbol}"

    for stale_dir in (
        skills_root / "genre_mystery",
        skills_root / "genre_xuanhuan",
        skills_root / "genre_romance",
    ):
        assert not stale_dir.exists(), f"题材静态技能目录未接入默认链路，应删除：{stale_dir}"

    stale_test = WORKFLOW_ROOT / "tests" / "test_genre_skill_registry.py"
    assert not stale_test.exists(), "test_genre_skill_registry.py 只覆盖已下线题材技能预留包，应删除。"

    forbidden_markers = (
        "clue_fairness_judge",
        "power_scale_guard",
        "relationship_arc_judge",
    )
    for source_path in [*WORKFLOW_ROOT.rglob("storyforge_workflow/**/*.py"), *WORKFLOW_ROOT.rglob("tests/**/*.py")]:
        if source_path == Path(__file__).resolve():
            continue
        source = source_path.read_text(encoding="utf-8")
        for marker in forbidden_markers:
            assert marker not in source, f"{source_path} 不应继续引用已下线题材技能：{marker}"


def test_novel_skill_diagnostics_static_projection_stays_pruned() -> None:
    """NovelSkill 静态诊断投影职责重复，应由 registry 测试和 skills.audit 覆盖。"""

    diagnostics_module = WORKFLOW_ROOT / "storyforge_workflow" / "skills" / "diagnostics.py"
    diagnostics_test = WORKFLOW_ROOT / "tests" / "test_novel_skill_diagnostics.py"

    assert not diagnostics_module.exists(), "skills/diagnostics.py 只投影默认 registry 静态信息，应删除。"
    assert not diagnostics_test.exists(), "test_novel_skill_diagnostics.py 只覆盖已下线静态投影，应删除。"

    forbidden_markers = (
        "storyforge_workflow.skills.diagnostics",
        "validate_novel_skill_registry",
        "list_novel_skill_diagnostics",
        "explain_bookrun_skill_chain",
    )
    for source_path in [*WORKFLOW_ROOT.rglob("storyforge_workflow/**/*.py"), *WORKFLOW_ROOT.rglob("tests/**/*.py")]:
        if source_path == Path(__file__).resolve():
            continue
        source = source_path.read_text(encoding="utf-8")
        for marker in forbidden_markers:
            assert marker not in source, f"{source_path} 不应继续引用已下线 NovelSkill 静态诊断投影：{marker}"


def test_quality_package_does_not_reexport_static_prose_check() -> None:
    """quality 包级入口不应重复转导出静态质量检查，统一从具体模块读取。"""

    quality_init = WORKFLOW_ROOT / "storyforge_workflow" / "quality" / "__init__.py"
    quality_init_source = quality_init.read_text(encoding="utf-8")

    for forbidden in (
        "StaticProseIssue",
        "check_prose_static_quality",
        "from storyforge_workflow.quality.prose_static_check import",
        '"StaticProseIssue"',
        '"check_prose_static_quality"',
    ):
        assert forbidden not in quality_init_source


def test_provider_adapter_does_not_keep_unused_token_usage_helper() -> None:
    """Provider adapter 应保留真实 token/cost 路径，不保留未调用的粗粒度 helper。"""

    provider_adapter = WORKFLOW_ROOT / "storyforge_workflow" / "runtime" / "provider_adapter.py"
    provider_adapter_source = provider_adapter.read_text(encoding="utf-8")

    assert "def _estimate_token_count(" in provider_adapter_source
    assert "def _estimate_cost(" in provider_adapter_source
    assert "def _estimate_token_usage(" not in provider_adapter_source


def test_runtime_package_does_not_reexport_provider_parity_harness() -> None:
    """runtime 包级入口不应把 provider parity 验收工具伪装成公共运行时 API。"""

    runtime_init = WORKFLOW_ROOT / "storyforge_workflow" / "runtime" / "__init__.py"
    provider_adapter = WORKFLOW_ROOT / "storyforge_workflow" / "runtime" / "provider_adapter.py"
    runtime_init_source = runtime_init.read_text(encoding="utf-8")
    provider_adapter_source = provider_adapter.read_text(encoding="utf-8")

    for required in (
        "class ProviderParityCase",
        "class ProviderParityResult",
        "class ProviderParityHarness",
    ):
        assert required in provider_adapter_source, f"provider parity 本体必须保留在具体模块：{required}"

    for forbidden in (
        "ProviderParityCase",
        "ProviderParityResult",
        "ProviderParityHarness",
    ):
        assert forbidden not in runtime_init_source, f"runtime 包级入口不应转导出 provider parity 符号：{forbidden}"


def test_prompt_quality_struct_models_stay_pruned() -> None:
    """Prompt 质量评审链路使用字符串契约，不保留未接入结构模型。"""

    models = WORKFLOW_ROOT / "storyforge_workflow" / "prompts" / "models.py"
    prompts_init = WORKFLOW_ROOT / "storyforge_workflow" / "prompts" / "__init__.py"
    builder = WORKFLOW_ROOT / "storyforge_workflow" / "prompts" / "builder.py"
    draft_writer = WORKFLOW_ROOT / "storyforge_workflow" / "nodes" / "draft_writer.py"
    state = WORKFLOW_ROOT / "storyforge_workflow" / "state.py"

    models_source = models.read_text(encoding="utf-8")
    prompts_init_source = prompts_init.read_text(encoding="utf-8")
    builder_source = builder.read_text(encoding="utf-8")
    draft_writer_source = draft_writer.read_text(encoding="utf-8")
    state_source = state.read_text(encoding="utf-8")

    for forbidden in (
        "class QualityScore",
        "class RevisionStrategy",
        "class QualityIssue",
        "class QualityReport",
        "def to_contract_line(",
    ):
        assert forbidden not in models_source, f"prompts.models 不应保留未接入质量结构模型：{forbidden}"

    for forbidden in (
        "QualityScore",
        "RevisionStrategy",
        "QualityIssue",
        "QualityReport",
    ):
        assert forbidden not in prompts_init_source, f"prompts 包级入口不应转导出未接入质量结构模型：{forbidden}"

    for required in (
        "class SceneQualityPlan",
        "scene_quality_plan: SceneQualityPlan",
    ):
        assert required in models_source, f"活跃场景质量计划模型必须保留：{required}"

    for required in (
        "def build_critique_prompt(",
        "DECISION: pass|repair|regenerate|awaiting_review",
        "ISSUE: 维度｜严重级别｜命中片段｜原因｜修订策略｜必须保留｜必须删除｜目标效果",
        "def build_revision_prompt(",
        "问题字段含义：维度｜严重级别｜命中片段｜原因｜修订策略｜必须保留｜必须删除｜目标效果。",
    ):
        assert required in builder_source, f"Prompt 评审/修订字符串契约必须保留：{required}"

    for required in (
        "def _parse_issues(",
        '"draft_issues": issues',
        "issues = list(state.get(\"draft_issues\", []))",
        "build_revision_prompt(narrative_context_from_state(state), draft, issues)",
    ):
        assert required in draft_writer_source, f"critic→reviser 字符串问题链路必须保留：{required}"

    assert "draft_issues: list[str]" in state_source


def test_prompts_package_does_not_reexport_prompt_models() -> None:
    """prompts 包级入口只暴露构建器，模型统一从 models.py 读取。"""

    prompts_init = WORKFLOW_ROOT / "storyforge_workflow" / "prompts" / "__init__.py"
    prompts_init_source = prompts_init.read_text(encoding="utf-8")

    for forbidden in (
        "from storyforge_workflow.prompts.models import",
        "CharacterConstraint",
        "ContinuityFact",
        "NarrativeContext",
        "PacingDirective",
        "SceneQualityPlan",
        "StyleDirective",
    ):
        assert forbidden not in prompts_init_source, f"prompts 包级入口不应转导出 prompt 模型：{forbidden}"

    for required in (
        "build_strategy_prompt",
        "build_chapter_plan_prompt",
        "build_scene_beats_prompt",
        "build_draft_prompt",
        "build_longform_segment_prompt",
        "build_critique_prompt",
        "build_revision_prompt",
    ):
        assert required in prompts_init_source, f"prompts 包级入口必须继续转导出构建器：{required}"


def test_workflow_root_package_does_not_reexport_runtime_objects() -> None:
    """workflow 根包不应充当 graph、persistence、state 的 barrel 出口。"""

    root_init = WORKFLOW_ROOT / "storyforge_workflow" / "__init__.py"
    graph = WORKFLOW_ROOT / "storyforge_workflow" / "graph.py"
    persistence = WORKFLOW_ROOT / "storyforge_workflow" / "persistence.py"
    state = WORKFLOW_ROOT / "storyforge_workflow" / "state.py"

    root_source = root_init.read_text(encoding="utf-8")
    graph_source = graph.read_text(encoding="utf-8")
    persistence_source = persistence.read_text(encoding="utf-8")
    state_source = state.read_text(encoding="utf-8")

    for forbidden in (
        "from storyforge_workflow.graph import",
        "from storyforge_workflow.persistence import",
        "from storyforge_workflow.state import",
        "create_generation_graph",
        "InMemoryWorkflowStore",
        "WorkflowCheckpoint",
        "GenerationState",
        "initial_generation_state",
    ):
        assert forbidden not in root_source, f"workflow 根包不应转导出运行对象：{forbidden}"

    assert "def create_generation_graph(" in graph_source, "生成图入口必须保留在 graph.py"
    assert "class InMemoryWorkflowStore" in persistence_source, "内存 checkpoint store 必须保留在 persistence.py"
    assert "class WorkflowCheckpoint" in persistence_source, "checkpoint 记录类型必须保留在 persistence.py"
    assert "class GenerationState" in state_source, "状态类型必须保留在 state.py"
    assert "def initial_generation_state(" in state_source, "初始状态构造器必须保留在 state.py"
