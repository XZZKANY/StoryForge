from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEV_PLAN_PATH = REPO_ROOT / "docs/internal/dev-plan.md"
PROJECT_SUMMARY_PATH = REPO_ROOT / "docs/internal/PROJECT_SUMMARY.md"
README_PATH = REPO_ROOT / "README.md"
CURRENT_PHASE_PATH = REPO_ROOT / "docs/internal/current-phase.md"
TODO_PATH = REPO_ROOT / "docs/internal/TODO.md"
OPERATIONS_README_PATH = REPO_ROOT / "docs" / "operations" / "README.md"
LOCAL_START_PATH = REPO_ROOT / "docs" / "operations" / "local-start.md"
TROUBLESHOOTING_PATH = REPO_ROOT / "docs" / "operations" / "troubleshooting.md"
ALEMBIC_VALIDATION_PATH = REPO_ROOT / "docs" / "operations" / "alembic-validation.md"
REMOTE_E2E_READINESS_PATH = REPO_ROOT / "docs/internal/codex" / "remote-e2e-rerun-readiness.md"
ONE_CHAPTER_RUN_DIR = REPO_ROOT / "docs/internal/codex" / "real-llm-1ch-20260603-142925"
ONE_CHAPTER_READTHROUGH_PATH = ONE_CHAPTER_RUN_DIR / "manual-readthrough-completion.md"
TEN_CHAPTER_RUN_DIR = REPO_ROOT / "docs/internal/codex" / "real-llm-10ch-20260604-110831"
TEN_CHAPTER_READTHROUGH_PATH = TEN_CHAPTER_RUN_DIR / "manual-readthrough-completion.md"


def test_dev_plan_records_real_llm_one_chapter_smoke_evidence() -> None:
    """Phase 9B-4a 的计划事实源必须回填已验证的 1 章 smoke 证据。"""

    dev_plan = DEV_PLAN_PATH.read_text(encoding="utf-8")

    assert "- [x] **Step 9B-4a：真实 LLM 1 章冒烟**" in dev_plan
    assert "docs/internal/codex/real-llm-1ch-20260603-142925" in dev_plan
    assert "tokens_used=3047" in dev_plan
    assert "markdown_artifact_id=1" in dev_plan
    assert "audit_artifact_id=2" in dev_plan
    assert "人工通读已完成" in dev_plan
    assert "不能据此声明 10 章或 3-5 万字长程完成" in dev_plan


def test_real_llm_one_chapter_readthrough_completion_is_standardized() -> None:
    """1 章 smoke 人工通读完成记录必须有独立文件，便于审计脚本和人工核对。"""

    completion = ONE_CHAPTER_READTHROUGH_PATH.read_text(encoding="utf-8")

    assert "真实 LLM 1 章 smoke 人工通读完成记录" in completion
    assert "结论：通过" in completion
    assert "可进入 3 章 smoke 技术门禁" in completion
    assert "不代表 10 章或 3-5 万字长程完成" in completion


def test_real_llm_ten_chapter_readthrough_completion_is_standardized() -> None:
    """10 章 smoke 人工通读完成记录必须有独立文件，便于最终门禁验收。"""

    summary = (TEN_CHAPTER_RUN_DIR / "summary.json").read_text(encoding="utf-8")
    completion = TEN_CHAPTER_READTHROUGH_PATH.read_text(encoding="utf-8")

    assert '"book_run_status": "completed"' in summary
    assert '"actual_chapter_count": 10' in summary
    assert '"tokens_used": 145668' in summary
    assert '"actual_total_chars": 33978' in summary
    assert "真实 LLM 10 章 smoke 人工通读完成记录" in completion
    assert "结论：通过" in completion
    assert "未发现明显人物、世界观或时间线矛盾" in completion
    assert "第 9 章存在两处动作段落重复" in completion
    assert "不代表 3-5 万字长程完成" in completion


def test_dev_plan_records_remote_e2e_master_success_boundary() -> None:
    """总计划必须记录历史失败、修复分支通过与 master 当前通过。"""

    dev_plan = DEV_PLAN_PATH.read_text(encoding="utf-8")

    assert "当前远端门禁状态" in dev_plan
    assert "CI` run `26857864662`" in dev_plan
    assert "E2E` run `26915457170`" in dev_plan
    assert "2026-06-03T21:55:39Z" in dev_plan
    assert "Multiple head revisions" in dev_plan
    assert "codex/phase9-e2e-alembic" in dev_plan
    assert "26941784868" in dev_plan
    assert "2026-06-04T08:59:00Z" in dev_plan
    assert "26944063055" in dev_plan
    assert "2026-06-04T09:45:05Z" in dev_plan
    assert "590333f1ccc99234f4244bc7bf4556fd7dee3f4f" in dev_plan
    assert "执行 Alembic 迁移预检" in dev_plan
    assert "执行数据库迁移" in dev_plan
    assert "运行 E2E" in dev_plan
    assert "20260604_0001" in dev_plan
    assert "tests/test_alembic_heads.py" in dev_plan
    assert "主分支远端 `E2E` 已通过" in dev_plan
    assert "docs/internal/codex/real-llm-10ch-20260604-110831" in dev_plan
    assert "gate: pass_for_real_10ch_final_acceptance" in dev_plan
    assert "真实 3-5 万字长程" in dev_plan


def test_phase9_remote_ci_e2e_boundary_records_master_success() -> None:
    """阶段事实源必须区分远端 CI 子集、历史失败与 master E2E 通过证据。"""

    current_phase = CURRENT_PHASE_PATH.read_text(encoding="utf-8")

    assert "CI` run `26857864662`" in current_phase
    assert "E2E` run `26915457170`" in current_phase
    assert "2026-06-03T21:55:39Z" in current_phase
    assert "codex/phase9-e2e-alembic" in current_phase
    assert "26941784868" in current_phase
    assert "2026-06-04T08:59:00Z" in current_phase
    assert "26944063055" in current_phase
    assert "2026-06-04T09:45:05Z" in current_phase
    assert "590333f1ccc99234f4244bc7bf4556fd7dee3f4f" in current_phase
    assert "执行 Alembic 迁移预检" in current_phase
    assert "执行数据库迁移" in current_phase
    assert "运行 E2E" in current_phase
    assert "26850336742" not in current_phase
    assert "Alembic 多 head" in current_phase
    assert "20260604_0001" in current_phase
    assert "本地 `pnpm e2e`" in current_phase
    assert "tests/test_alembic_heads.py" in current_phase
    assert "API verification" in current_phase
    assert "storyforge_phase9_e2e_submit_verify" in current_phase
    assert "`master` 远端 E2E 通过证据" in current_phase
    assert "不能宣称真实模型下已完成 3-5 万字长程" in current_phase


def test_project_summary_records_current_phase9_boundaries() -> None:
    """项目总结必须同步当前 Phase 9 事实，避免旧验证状态误导完成审计。"""

    project_summary = PROJECT_SUMMARY_PATH.read_text(encoding="utf-8")

    assert "2026-06-04" in project_summary
    assert "`pnpm verify`" in project_summary
    assert "Web 209 passed" in project_summary
    assert "API 405 passed" in project_summary
    assert "Workflow 164 passed" in project_summary
    assert "`pnpm e2e`" in project_summary
    assert "Node 29 passed" in project_summary
    assert "API verification 61 passed" in project_summary
    assert "workflow verification 37 passed" in project_summary
    assert "CI / Core verification" in project_summary
    assert "26857864662" in project_summary
    assert "26915457170" in project_summary
    assert "2026-06-03T21:55:39Z" in project_summary
    assert "codex/phase9-e2e-alembic" in project_summary
    assert "26941784868" in project_summary
    assert "26944063055" in project_summary
    assert "2026-06-04T09:45:05Z" in project_summary
    assert "590333f1ccc99234f4244bc7bf4556fd7dee3f4f" in project_summary
    assert "执行 Alembic 迁移预检" in project_summary
    assert "执行数据库迁移" in project_summary
    assert "运行 E2E" in project_summary
    assert "Multiple head revisions" in project_summary
    assert "20260604_0001" in project_summary
    assert "远端 E2E | 主分支通过" in project_summary
    assert "docs/internal/codex/real-llm-1ch-20260603-142925" in project_summary
    assert "docs/internal/codex/real-llm-3ch-20260603-173932" in project_summary
    assert "docs/internal/codex/real-llm-10ch-20260604-110831" in project_summary
    assert "gate: pass_for_real_10ch_final_acceptance" in project_summary
    assert "真实 3-5 万字长程仍未完成" in project_summary
    assert "10 章 smoke 人工通读完成" in project_summary
    assert "cd D:/StoryForge" in project_summary
    assert "`docs/internal/current-phase.md`" in project_summary

    assert "docs/internal/codex/current-phase.md" not in project_summary
    assert "Node 契约 14/14" not in project_summary
    assert "真实 API HTTP pytest 41/41" not in project_summary
    assert "workflow 8/8" not in project_summary
    assert "API 147/147" not in project_summary
    assert "API 399 passed" not in project_summary


def test_todo_records_current_phase9_next_actions() -> None:
    """TODO 必须作为当前执行入口，记录 Phase 9 剩余门禁而非旧阶段。"""

    todo = TODO_PATH.read_text(encoding="utf-8")

    assert "Phase 9 当前执行入口" in todo
    assert "远端 `CI` run `26857864662`" in todo
    assert "远端 `master` 定时 `E2E` run `26915457170`" in todo
    assert "2026-06-03T21:55:39Z" in todo
    assert "codex/phase9-e2e-alembic" in todo
    assert "26941784868" in todo
    assert "26944063055" in todo
    assert "2026-06-04T09:45:05Z" in todo
    assert "590333f1ccc99234f4244bc7bf4556fd7dee3f4f" in todo
    assert "执行 Alembic 迁移预检" in todo
    assert "执行数据库迁移" in todo
    assert "运行 E2E" in todo
    assert "Multiple head revisions" in todo
    assert "20260604_0001" in todo
    assert "tests/test_alembic_heads.py" in todo
    assert "storyforge_phase9_e2e_submit_verify" in todo
    assert "docs/internal/codex/real-llm-1ch-20260603-142925" in todo
    assert "docs/internal/codex/real-llm-3ch-20260603-173932" in todo
    assert "docs/internal/codex/real-llm-10ch-20260604-110831" in todo
    assert "gate: pass_for_real_10ch_final_acceptance" in todo
    assert "真实 3-5 万字长程仍未完成" in todo
    assert "下一步优先级" in todo
    assert "推进真实 3-5 万字短篇长程运行" in todo
    assert "`pnpm verify`" in todo
    assert "`pnpm e2e`" in todo
    assert "`docs/internal/current-phase.md`" in todo
    assert "`docs/internal/PROJECT_SUMMARY.md`" in todo

    assert "2026-05-24 Phase 7 发布治理到闭环验证" not in todo
    assert "pnpm run test:web" not in todo
    assert "pnpm run test:api" not in todo
    assert "pnpm run test:workflow" not in todo
    assert "pnpm run test" not in todo
    assert "pnpm run verify" not in todo


def test_local_start_records_current_phase9_runbook() -> None:
    """本地启动手册必须使用当前路径、验证命令和 Phase 9 门禁边界。"""

    local_start = LOCAL_START_PATH.read_text(encoding="utf-8")

    assert "更新时间：2026-06-04" in local_start
    assert "D:/StoryForge" in local_start
    assert "`pnpm verify`" in local_start
    assert "`pnpm e2e`" in local_start
    assert "`pnpm test`" in local_start
    assert "`pnpm openapi`" in local_start
    assert "API 405 passed" in local_start
    assert "远端 `E2E` run `26915457170`" in local_start
    assert "2026-06-03T21:55:39Z" in local_start
    assert "26944063055" in local_start
    assert "2026-06-04T09:45:05Z" in local_start
    assert "Multiple head revisions" in local_start
    assert "20260604_0001" in local_start
    assert "tests/test_alembic_heads.py" in local_start
    assert "API verification" in local_start
    assert "在线 PostgreSQL 迁移已在本轮复验" in local_start
    assert "不读取 `.env`" in local_start
    assert "provider token" in local_start
    assert "docs/internal/codex/real-llm-10ch-20260604-110831" in local_start
    assert "gate: pass_for_real_10ch_final_acceptance" in local_start
    assert "真实 3-5 万字长程仍未完成" in local_start
    assert "`docs/internal/current-phase.md`" in local_start
    assert "`docs/internal/TODO.md`" in local_start

    assert "D:/StoryForge/1-renovel-ai-ai-rag-tavern" not in local_start
    assert "pnpm run test:web" not in local_start
    assert "pnpm run test:api" not in local_start
    assert "pnpm run test:workflow" not in local_start
    assert "API 399 passed" not in local_start


def test_troubleshooting_records_current_phase9_failure_boundaries() -> None:
    """故障手册必须同步当前 Phase 9 远端 E2E 与 Alembic 排障边界。"""

    troubleshooting = TROUBLESHOOTING_PATH.read_text(encoding="utf-8")

    assert "更新时间：2026-06-04" in troubleshooting
    assert "D:/StoryForge" in troubleshooting
    assert "`pnpm verify`" in troubleshooting
    assert "`pnpm e2e`" in troubleshooting
    assert "远端 `E2E` run `26915457170`" in troubleshooting
    assert "2026-06-03T21:55:39Z" in troubleshooting
    assert "26944063055" in troubleshooting
    assert "2026-06-04T09:45:05Z" in troubleshooting
    assert "Multiple head revisions" in troubleshooting
    assert "20260604_0001" in troubleshooting
    assert "tests/test_alembic_heads.py" in troubleshooting
    assert "API verification" in troubleshooting
    assert "在线 PostgreSQL 迁移已在本轮复验" in troubleshooting
    assert "最新远端 `master` E2E run `26944063055`" in troubleshooting

    assert "D:/StoryForge/1-renovel-ai-ai-rag-tavern" not in troubleshooting


def test_operations_readme_records_current_phase9_runbook_index() -> None:
    """运维索引必须指向当前 Phase 9 本地验证与远端 E2E 排障入口。"""

    operations_readme = OPERATIONS_README_PATH.read_text(encoding="utf-8")

    assert "更新时间：2026-06-04" in operations_readme
    assert "D:/StoryForge" in operations_readme
    assert "`local-start.md`" in operations_readme
    assert "`troubleshooting.md`" in operations_readme
    assert "`pnpm verify`" in operations_readme
    assert "`pnpm e2e`" in operations_readme
    assert "远端 `E2E` run `26915457170`" in operations_readme
    assert "2026-06-03T21:55:39Z" in operations_readme
    assert "26944063055" in operations_readme
    assert "2026-06-04T09:45:05Z" in operations_readme
    assert "Multiple head revisions" in operations_readme
    assert "20260604_0001" in operations_readme
    assert "tests/test_alembic_heads.py" in operations_readme
    assert "API verification" in operations_readme
    assert "在线 PostgreSQL 迁移已在本轮复验" in operations_readme
    assert "最新远端 `master` E2E run `26944063055`" in operations_readme
    assert "docs/internal/codex/real-llm-10ch-20260604-110831" in operations_readme
    assert "真实 3-5 万字长程仍未完成" in operations_readme

    assert "D:/StoryForge/1-renovel-ai-ai-rag-tavern" not in operations_readme


def test_remote_e2e_rerun_readiness_records_master_success_evidence() -> None:
    """远端 E2E 记录必须保留重跑清单和 master 通过证据。"""

    readiness = REMOTE_E2E_READINESS_PATH.read_text(encoding="utf-8")

    assert "Phase 9 远端 E2E 重跑与通过记录" in readiness
    assert "26915457170" in readiness
    assert "2026-06-03T21:55:39Z" in readiness
    assert "26941784868" in readiness
    assert "26944063055" in readiness
    assert "2026-06-04T09:45:05Z" in readiness
    assert "590333f1ccc99234f4244bc7bf4556fd7dee3f4f" in readiness
    assert "Multiple head revisions" in readiness
    assert "workflow_dispatch" in readiness
    assert ".github/workflows/e2e.yml" in readiness
    assert "20260604_0001" in readiness
    assert "tests/test_alembic_heads.py" in readiness
    assert "scripts/run-e2e.mjs" in readiness
    assert "在线 PostgreSQL 迁移已在本轮复验" in readiness
    assert "storyforge_phase9_online_verify" in readiness
    assert "ALEMBIC_UPGRADE_EXIT=0" in readiness
    assert "ALEMBIC_CURRENT_EXIT=0" in readiness
    assert "TEMP_DB_DROP_EXIT=0" in readiness
    assert "pnpm e2e" in readiness
    assert "pnpm verify" in readiness
    assert "git status -sb" in readiness
    assert "git push" in readiness
    assert "gh workflow run E2E --ref master" in readiness
    assert "不得直接重跑旧远端 `master`" in readiness
    assert "远端 E2E 已通过" in readiness
    assert "docs/internal/codex/real-llm-10ch-20260604-110831" in readiness
    assert "真实 10 章 smoke 已完成最终验收" in readiness
    assert "真实 3-5 万字长程仍未完成" in readiness

    assert "真实长程已完成" not in readiness


def test_alembic_validation_records_current_phase9_migration_boundary() -> None:
    """Alembic 验证手册必须同步当前 Phase 9 迁移门禁事实。"""

    validation = ALEMBIC_VALIDATION_PATH.read_text(encoding="utf-8")

    assert "更新时间：2026-06-04" in validation
    assert "D:/StoryForge" in validation
    assert "apps/api/alembic.ini" in validation
    assert "apps/api/alembic/env.py" in validation
    assert "20260604_0001" in validation
    assert "20260514_phase2" in validation
    assert "20260602_0003" in validation
    assert "tests/test_alembic_heads.py" in validation
    assert "uv run pytest tests/test_alembic_heads.py -q" in validation
    assert "alembic upgrade head --sql" in validation
    assert "离线 SQL" in validation
    assert "Docker daemon 已启动" in validation
    assert "storyforge_phase9_online_verify" in validation
    assert "在线 PostgreSQL 迁移已在本轮复验" in validation
    assert "ALEMBIC_UPGRADE_EXIT=0" in validation
    assert "ALEMBIC_CURRENT_EXIT=0" in validation
    assert "TEMP_DB_DROP_EXIT=0" in validation
    assert "远端 `E2E` run `26915457170`" in validation
    assert "2026-06-03T21:55:39Z" in validation
    assert "26944063055" in validation
    assert "2026-06-04T09:45:05Z" in validation
    assert "Multiple head revisions" in validation
    assert "远端 `master` E2E 已通过" in validation

    assert "D:/StoryForge/1-renovel-ai-ai-rag-tavern" not in validation
    assert "20260520_0001 (head)" not in validation
    assert "在线升级到真实 PostgreSQL 已在本机通过" not in validation
    assert "在线命令输出包含" not in validation
    assert "在线 PostgreSQL 迁移未在本轮复验" not in validation


def test_phase9_document_fact_source_roles_are_converged() -> None:
    """Phase 9 活文档必须声明清晰职责，避免多个文件竞争当前事实源。"""

    current_phase = CURRENT_PHASE_PATH.read_text(encoding="utf-8")
    readme = README_PATH.read_text(encoding="utf-8")
    todo = TODO_PATH.read_text(encoding="utf-8")
    project_summary = PROJECT_SUMMARY_PATH.read_text(encoding="utf-8")
    dev_plan = DEV_PLAN_PATH.read_text(encoding="utf-8")

    assert "## 事实源职责矩阵" in current_phase
    assert "`docs/internal/current-phase.md`" in current_phase
    assert "当前阶段唯一事实源" in current_phase
    assert "`README.md`" in current_phase
    assert "面向使用者的入口摘要" in current_phase
    assert "`docs/internal/TODO.md`" in current_phase
    assert "当前下一步执行入口" in current_phase
    assert "`docs/internal/PROJECT_SUMMARY.md`" in current_phase
    assert "项目总览和验证状态摘要" in current_phase
    assert "`docs/internal/dev-plan.md`" in current_phase
    assert "历史计划和阶段 DoD" in current_phase

    assert "当前阶段状态与未完成验收项见 `docs/internal/current-phase.md`" in readme
    assert "详细架构见 `CLAUDE.md`" in readme
    assert "当前状态以 `docs/internal/current-phase.md` 为准" in todo
    assert "TODO 只保留下一步执行入口" in todo
    assert "当前阶段事实以 `docs/internal/current-phase.md` 为准" in project_summary
    assert "PROJECT_SUMMARY 只保留项目总览" in project_summary

    assert "本计划是历史阶段计划和 Definition of Done 记录" in dev_plan
    assert "当前阶段事实以 `docs/internal/current-phase.md` 为准" in dev_plan
    assert "不能把本计划中的历史验收文字单独作为最新状态来源" in dev_plan
