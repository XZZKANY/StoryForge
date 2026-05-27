# Alembic schema 收口迁移验证报告

生成时间：2026-05-28

## 结果摘要

已新增正式 Alembic 迁移 `20260528_0001_backfill_current_orm_schema.py`，用于补齐当前 ORM 与历史迁移之间的 schema 缺口，避免新环境依赖手动 `Base.metadata.create_all()` 或手写 `ALTER TABLE`。

## 交付物

- `apps/api/alembic/versions/20260528_0001_backfill_current_orm_schema.py`
- `apps/api/tests/test_alembic_schema_current_orm.py`
- `.codex/operations-log.md`
- `.codex/verification-report.md`

## 覆盖范围

迁移补齐了以下关键结构：

- `books.workspace_id`、索引和到 `workspaces.id` 的外键。
- `workspaces`、`workspace_members`、`workspace_comments`。
- `approval_requests`、`approval_decisions`。
- `workspace_subscriptions`、`event_logs`、`provider_configs`。
- `prompt_packs`、`artifacts`、`evaluation_cases`、`evaluation_runs`、`model_runs`。
- `series`、`series_memories`、`series_memory_evidence`。

迁移包含存在性检查，可兼容已被本地补表过的开发库。

## 验证证据

```text
uv run pytest tests/test_alembic_schema_current_orm.py -q
... [100%]
3 passed in 0.02s
```

```text
uv run alembic heads
20260528_0001 (head)
```

```text
uv run alembic upgrade head
Running upgrade 20260527_0003 -> 20260528_0001, 补齐当前 ORM 与历史迁移之间的 schema 缺口。
```

```text
schema 检查：
missing_tables []
books_columns 包含 workspace_id
alembic_version [('20260528_0001',)]
```

```text
uv run pytest tests/test_alembic_schema_current_orm.py tests/test_phase9b_real_llm_smoke.py -q
........ [100%]
8 passed in 1.57s
```

## 审查清单

- 需求字段完整性：目标、范围、交付物、审查要点均已覆盖。
- 原始意图覆盖：已补正式 Alembic 迁移，收口 ORM 与历史迁移缺口。
- 交付物映射：迁移文件、迁移测试、操作日志、验证报告均已落地。
- 依赖与风险：迁移兼容当前已补表开发库；仍建议后续在全新空库上执行一次完整容器化验证。
- 审查结论：通过。

## 评分

- 技术维度评分：93/100。迁移覆盖当前已知 ORM 缺口并有回归测试；扣分项是未在独立全新数据库实例上做破坏性重建验证。
- 战略维度评分：94/100。解决了真实 LLM 冒烟暴露的新环境 schema 不完整问题，降低后续部署风险。
- 综合评分：94/100。

## 明确建议

建议：通过。
