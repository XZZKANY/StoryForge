# StoryForge 待办清单

更新时间：2026-09-05

## 当前执行入口

当前状态以 `docs/internal/current-phase.md` 为准；TODO 只保留下一步执行入口。项目总览见 `docs/internal/PROJECT_SUMMARY.md`，旧执行清单见 [待办历史](TODO-history-2026-07-26.md)。

## 下一步优先级

1. **回到真实写作验证。** 接续 n=1 连载前确认仓库外资产现状；记录固定任务的完成时间、改稿保留率、返工和人工偏好。7 月章节数与 S3 手稿保险计划任务状态本轮未复核，不作为今天事实。
2. **按版本执行发布验收。** 指定拟发布构建，运行对应门禁并复验 GUI 保存、diff 确认和权限档位；冻结 sidecar 冒烟不能替代真机 GUI 验收。Windows 原生符号链接可在具备权限的环境补跑，不把 Linux 通过描述成 Windows 原生通过。

## 已实现与待核实

- 文件工具边界与资源限制已提交为 `fd7a7fa6`；Linux 补验 56 passed / 1 skipped，普通符号链接三项及 Project Knowledge 越界链接均通过；Windows junction 与冻结 exe 实际搜索已有通过证据。
- 已修复 intent 测试遗漏 `chapter.polish`、Windows PowerShell 中文脚本解析和拆书报告 effect lint；报告加载已覆盖项目切换与旧响应回流的行为回归。
- 全文搜索、项目/页签/光标恢复已接入 Desktop，不再作为缺失能力提名。
- `chapter.write`、`chapter.polish`、结构化拆书已有代码；不代表质量或用户收益已验收。
- 旧清单的 canon/hook 提案并入、观测已处理状态持久化、改稿锚点稳定性、原生菜单，必须核对当前实现再决定是否立项，不能照抄 7 月结论。
- BookRun 的 Agent 启动工具已退役，后台兼容不是重建桌面自动整书入口的待办。
- 重跑真实 3-5 万字长程不在本轮自动排期，需要独立样本、成本和人工评审方案。

## 本地验证入口

```powershell
cd D:/StoryForge
pnpm.cmd lint
pnpm.cmd verify
pnpm.cmd check:drift
pnpm.cmd smoke:sidecar:packaged
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
```

```powershell
cd D:/StoryForge/apps/api
uv run pytest tests/test_phase9_fact_sources.py -q
uv run pytest tests/test_ide_agent_orchestrator.py tests/test_real_llm_long_evidence_validator.py -q
uv run pytest tests/test_agent_fs_tools.py tests/test_agent_fs_boundaries.py tests/test_agent_fs_budget_feedback.py -q
uv run ruff check app/domains/agent_runs app/domains/ide tests
```

真实 LLM 使用独立授权的本地配置和明确预算，不把密钥或私有小说正文写入报告。
