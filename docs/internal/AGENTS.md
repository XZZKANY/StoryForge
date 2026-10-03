# docs/internal 目录级 AGENTS 补充

> 本文件是 `docs/internal/` 目录的**目录级补充约定**。上位规范：仓库根 `AGENTS.md`、`CLAUDE.md` 与 `.trellis/workflow.md`；冲突时以根级为准。
> 2026-09-28 起本文档收敛为现状；2026-05 旧版全文留档于 `../archive/internal-history-2026-09/internal-agent-guidelines-legacy-2026-05.md`（其中破坏性更改、强制工具链、排斥人工验证等规则已失效）。

## 本目录职责

- `current-phase.md`：当前阶段唯一事实源。
- `TODO.md`：当前下一步执行入口。
- `PROJECT_SUMMARY.md`：项目总览与验证状态摘要。
- 历史材料（`dev-plan.md`、`*-history-*.md`、各旧计划与蓝图）已于 2026-09-30 迁至 `../archive/internal-history-2026-09/`；保留时点，不作为今天的事实源或操作指令。

改这三份现行入口时保留其职责互斥，不要把历史日志或旧验收流水倒回现行段。

## 仍然有效的约束（与根级一致，重申于此）

- 全部 AI 回复、文档、注释、日志、提交信息默认简体中文；代码标识符/API 名保留英文。
- 安全基线不得删弱：不删除、削弱或绕过已由代码和测试验证的认证、鉴权、限流、超时、安全响应头、配置校验与审计留痕；安全与既有测试/门禁冲突时优先保留已验证的运行时行为，并在 `.codex/verification-report.md` 记录冲突与修正。
- 不伪造数据兜底；缺数据就显式报错。
- 所有变更必须可在本地复验并把命令与结果写入 `.codex/verification-report.md`。
- 不覆盖用户未提交改动；未经明确要求不自动提交、不推送。
- 文学质量只认人工通读，自动审计/golden/模型自评不替代人读。

## 已失效，不得再引用执行

- 颠覆式破坏性更改、拒绝向后兼容。
- 一刀切删除自研实现。
- 强制 sequential-thinking → shrimp-task-manager 工具链与评分卡式质量审查。
- 在项目根目录重建 `TODO.md` / `AI_ITERATION_GUIDE.md`。
- 旧工作目录 `D:\StoryForge\1-renovel-ai-ai-rag-tavern` 与不存在的根级文件引用。
