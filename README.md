# StoryForge

长篇小说最难的不是写一章，是写到第三十章时角色不崩、伏笔不丢、时间线不乱。

StoryForge 把这个问题拆成可检查的环节：**设定 → 章节目标 → 检索证据 → 生成 → 审稿 → 修复 → 记忆注入 → 导出**。它不是让模型一次性写完整本书，而是把每一章变成可检查、可修复、可追踪的生产单元。

---

## 当前状态

StoryForge 是**长篇小说 AI 创作流水线原型**。已完成 1 章、3 章、10 章真实 LLM 端到端验证，10 章验证已通过人工通读。尚未证明可在 3–5 万字尺度上稳定生产。欢迎开发者参与验证和改进。

## Demo

10 章真实模型验证产出的完整样例（`book.md` + `audit_report.json`）见：

[`.codex/real-llm-10ch-20260604-110831/`](.codex/real-llm-10ch-20260604-110831/)

## 能做什么

- **故事设定**：创建作品、角色、世界观
- **章节计划**：从 Blueprint 拆解章节目标与检索锚点
- **逐章生成**：Scene Architect → Draft Writer 顺序驱动
- **自动审稿**：6 维质量评分（叙事、人物、世界观、时间线、风格、系统可靠度）
- **定向修复**：根据评分触发分级修订
- **记忆注入**：提取关键信息写入 Story Memory，贯穿后续章节
- **成品导出**：Markdown、EPUB、完整审计报告（`audit_report.json`）

## 不能做什么

- 不保证商用级长篇质量（当前为原型验证阶段）
- 不提供完整多人协作
- 不提供生产级对象存储签名 URL 下载
- 不承诺外部 LLM 端到端质量稳定

## 快速开始

```bash
git clone https://github.com/XZZKANY/StoryForge.git
cd StoryForge
pnpm install
docker compose up -d postgres redis minio
pnpm dev          # 全栈启动（API + Web + 迁移）
pnpm verify       # 本地门禁
pnpm test         # 单元 / 契约测试
pnpm e2e          # OpenAPI 刷新 + 真实 HTTP 测试
```

Windows 下若 `pnpm.ps1` 被阻止，改用 `pnpm.cmd`。

## 架构

```
Web (Next.js)  → 只读工作台 + BFF，不私自计算业务结论
       │  X-StoryForge-API-Key + OpenAPI 硬契约
       ▼
API (FastAPI)  → 业务真相源，~25 个业务域
       │  JobRun / Checkpoint / ModelRun
       ▼
Workflow       → 长任务编排，真实模型调用边界
(LangGraph)
```

一条完整的 BookRun：

```
Blueprint → generate → judge → repair → approve → memory → checkpoint → 导出
```

详细架构见 [`CLAUDE.md`](CLAUDE.md)。

## 质量验证

| 验证轮次 | 章节 | Token 消耗 | 状态 | 人工通读 |
|---------|------|-----------|------|---------|
| 1 章 smoke | 1 | — | ✅ | ✅ |
| 3 章 smoke | 3 | 14,158 | ✅ | ✅ |
| 10 章 smoke | 10 | 145,668 | ✅ | ✅ |

10 章验证产出 `book.md`（~34,000 字）、完整 `audit_report.json`，已通过人工通读。

> 以上为真实 LLM 冒烟验证，3–5 万字长程仍在推进中。

## 路线图

**当前优先：**
1. 跑通 3–5 万字真实 LLM 长程
2. 长程产物人工通读 + Markdown/EPUB/审计报告验收
3. 补齐 streaming 响应与多租户认证

**持续进行：**
- Studio 全步骤交互编排
- 检索精度与 RAG 质量提升
- CI/CD 与部署自动化

## 贡献

欢迎 Issue 和 PR。

- 提交前请运行 `pnpm verify && pnpm test && pnpm e2e`
- 代码风格：Python 侧 `ruff`，TypeScript 侧 `tsc --noEmit` + ESLint
- 验证证据写入 `.codex/verification-report.md` 或在 PR 中附带命令输出
- 更多约定见 [`CLAUDE.md`](CLAUDE.md)
