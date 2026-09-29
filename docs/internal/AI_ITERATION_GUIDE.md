# StoryForge 持续迭代导航

> 2026-09-28 起本文收敛为**导航页**，不再是第二套工作流规范。现行规则事实源：
> 仓库根 `AGENTS.md` 与 `CLAUDE.md`（协作约定、证据链与验证要求）、`.trellis/workflow.md`（阶段流程）、
> 本目录 `AGENTS.md`（docs/internal 目录级补充）。与这些文件冲突的旧条款一律不再执行。
> 2026-05 旧版全文在 git 历史中可查，本页不再复制；原文件内的旧根路径（`D:\StoryForge\1-renovel-ai-ai-rag-tavern`）、
> 根级 `AI_ITERATION_GUIDE.md` / `TODO.md` 维护要求和 `pnpm build` 等失效指令已随本次收敛移除。

## 每次迭代开始前先读

1. 根 `AGENTS.md`、`CONTEXT.md`。
2. `docs/internal/current-phase.md`（阶段唯一事实源）。
3. `docs/internal/TODO.md`（下一步执行入口）。
4. 与改动域相关的 `docs/architecture/` 文档、目标包 `STRUCTURE.md` / `.trellis/spec/` 规范。
5. `git status`：确认既有未提交改动归属，不覆盖他人 WIP。

## 仍然有效的原则

- 小步推进：一次只解决一个明确问题，不顺手重构无关代码。
- 证据先行：结论援引代码/测试/文档，不凭感觉；写类操作前先看清调用链。
- 本地验证：改动后跑与变更相关的最小测试，再按 `AGENTS.md` 跑对应门禁；验证命令与结果写入 `.codex/verification-report.md`。
- 简体中文贯穿回复、文档、注释与提交信息；代码标识符保留英文。
- 不自动提交：用户未明确要求时只汇报 git 状态与建议，不执行 commit/push。
- 复用优先：先查项目内既有实现与约定，再考虑新增；新增依赖要有记录在案的理由。

## 任务与事实源边界

- 新增发现的问题、后续动作 → 记入 `docs/internal/TODO.md`（只保留下一步入口，不记流水）。
- 阶段状态、验收边界变化 → 记入 `docs/internal/current-phase.md`。
- 历史计划文件（`dev-plan.md`、旧规划、`*-history-*.md`）只做带日期的追加记录，不回写改历史正文。
- 一次迭代不要包揽超过 1-3 个小任务；跨模块或超 5 个子任务先拆 Trellis 任务。

## 禁止事项（自旧版保留，仍然成立）

- 不读规则和项目状态直接改代码。
- 修改后不验证、验证失败却声称完成。
- 把临时文件、缓存、私有配置、provider 密钥提交进仓库。
- 凭猜测下结论、连续三次验证失败仍硬推实现。
