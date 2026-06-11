# 项目上下文摘要（Phase 3 subagent 模式）

生成时间：2026-06-06 21:08:11 +08:00

## 1. 相似实现分析

- **实现1**: `.codex/context-summary-performance-quality.md`
  - 模式：编码前先记录上下文、复用组件、命名约定和验证入口。
  - 可复用：上下文摘要结构与“编码前检查”证据链。
  - 需注意：业务实现前必须先证明未重复造轮子。
- **实现2**: `.codex/operations-log.md`
  - 模式：按任务追加目标、编码前检查、编码后声明、本地验证和风险边界。
  - 可复用：Phase 3 后续 worker 的操作记录格式。
  - 需注意：全量测试若存在历史失败，必须记录失败边界和定向验证补偿。
- **实现3**: `.codex/phase2-memory-recall-fix-report.md`
  - 模式：以根因、解决方案、测试结果和剩余风险归档阶段成果。
  - 可复用：Phase 3 完成后的阶段报告结构。
  - 需注意：必须用本地可重复测试支撑收益声明。

## 2. 项目约定

- **命名约定**: Python 使用 `snake_case`，pytest 用 `test_` 前缀；TypeScript 使用既有组件与类型命名。
- **文件组织**: API 位于 `apps/api`，Workflow 位于 `apps/workflow`，Web 位于 `apps/web`，共享契约位于 `packages/shared`。
- **导入顺序**: Python 由 ruff 管理，TypeScript 由 ESLint 与 Prettier 管理。
- **代码风格**: 文档、注释、测试描述和日志统一使用简体中文；不新增未评估依赖。

## 3. 可复用组件清单

- `package.json`: 根验证入口，包含 `pnpm run verify`、`pnpm run test`、`pnpm run lint`。
- `apps/api/pyproject.toml`: API 测试入口 `uv run pytest` 与 ruff 配置。
- `apps/workflow/pyproject.toml`: Workflow 测试入口 `uv run pytest` 与 ruff 配置。
- `.codex/operations-log.md`: 后续任务操作留痕主文件。
- `.codex/verification-report.md`: 后续质量审查与评分主文件。

## 4. 测试策略

- **测试框架**: Python 使用 pytest，前端与共享包通过 pnpm workspace 脚本运行。
- **测试模式**: Phase 3 每个 worker 先跑定向测试，再由主线程决定是否跑模块级或全量验证。
- **参考文件**: `package.json`、`apps/api/pyproject.toml`、`apps/workflow/pyproject.toml`。
- **覆盖要求**: Planning 持久化至少覆盖正常流程、缺失规划、恢复/重入、数据库写入边界和端到端集成。

## 5. 依赖和集成点

- **外部依赖**: 当前仅确认 FastAPI、SQLAlchemy、Pydantic、LangGraph、pytest、ruff 等既有依赖。
- **内部依赖**: Phase 3 预计涉及 Workflow planning 节点、API 持久化模型或服务、BookRun/Chapter timeline 集成。
- **集成方式**: 先由 explorer 子代理确认真实模块与调用链，再拆分 worker 写入范围。
- **配置来源**: 暂未新增配置；如 Phase 3 需要配置，必须沿用项目既有 `STORYFORGE_*` 约定。

## 6. 技术选型理由

- **为什么用 subagent 模式**: Phase 3 可能跨 API、Workflow、测试和文档，适合主线程调度、子代理分工和双层审查。
- **优势**: 降低单上下文污染，明确写入边界，并让规格符合性与代码质量分开审查。
- **劣势和风险**: 子代理可能缺少上下文；主线程必须提供完整任务文本、文件责任、验证命令和禁止回退他人变更的约束。

## 7. 关键风险点

- **并发问题**: 不并行派发写入范围重叠的 worker；同一文件同一阶段只归一个 worker。
- **边界条件**: 当前 `master` 本地领先 `origin/master` 3 个提交，后续不得擅自重置或回退。
- **性能瓶颈**: Phase 3 Planning 持久化可能增加数据库读写，需在任务设计中评估调用频率和缓存边界。
- **安全考虑**: 不绕过现有认证、配置校验、审计留痕和本地验证门禁。

## 8. 当前调度状态

- 已创建隔离工作区：`D:\StoryForge\.worktrees\phase3-planning-persistence`。
- 已创建分支：`codex/phase3-planning-persistence`。
- 基线提交：`05cd519 Phase 2: Memory 召回修复 - 消除 PK/ordinal 混淆`。
- 已启动两个只读 explorer 子代理：
  - Planning 模块与集成点探查。
  - 测试、构建、格式化和验证入口探查。
- 当前任务仅开启 subagent 模式，不修改业务代码。

