# README 与 GitHub About 同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**目标：** 让 README 和 GitHub About 同步远端 master 已合并能力，同时反映主工作区中进行中的最新方向，但明确区分已合并与进行中。

**架构：** 只改文档和仓库元数据，不改应用代码。README 作为面向使用者的事实摘要，GitHub About 作为仓库外层摘要；进行中内容只写成路线图/进行中，不宣称已发布。

**Tech Stack：** Markdown、GitHub CLI、PowerShell、本地 git worktree。

---

### Task 1：同步事实源

**Files:**
- Read: README.md
- Read: current-phase.md
- Read: docs/superpowers/specs/2026-05-31-storyforge-novel-skill-framework-design.md（主工作区进行中文档）
- Read: pps/web/app/settings/*、pps/web/components/home/*（主工作区进行中代码）

- [x] **Step 1.1：读取远端 master 状态**
  - 确认当前 worktree 基于 origin/master 的 c24be5e。

- [x] **Step 1.2：读取主工作区未提交进度**
  - 识别进行中方向：模型设置页/API Key 检测、首页 Claude-like 改版、Novel Skill Framework 设计、小说质量总控计划。

### Task 2：更新 README

**Files:**
- Modify: README.md

- [ ] **Step 2.1：保留能力边界**
  - 将已合并内容更新为 Phase 9B 真实 LLM 冒烟调用链已修复、远端 CI 已通过。
  - 不宣称 3 章真实 LLM BookRun 已 completed。

- [ ] **Step 2.2：增加进行中路线图**
  - 以“进行中/未合并”描述设置页、首页改版、Novel Skill Framework、小说质量总控。

- [ ] **Step 2.3：更新验证命令**
  - 保留 pnpm verify/test/e2e/openapi。
  - 补充 Phase 9B 冒烟和 CI 修复验证口径。

### Task 3：更新 GitHub About

**Files:**
- GitHub repository metadata

- [ ] **Step 3.1：设置 description**
  - 使用简短描述：可验证中文长篇小说创作流水线：BookRun、Judge/Repair、Story Memory、导出审计与真实 LLM 冒烟门禁。

- [ ] **Step 3.2：设置 homepage 与 topics**
  - Homepage 指向 README。
  - Topics 覆盖 i-writing、
ovel-writing、
ag、workflow、
extjs、astapi、langgraph、storyforge、llm-evaluation、ook-generation。

### Task 4：验证与发布

**Files:**
- Verify: README.md

- [ ] **Step 4.1：Markdown 内容检查**
  - 运行本地脚本检查 README 无 TBD/TODO、关键章节存在。

- [ ] **Step 4.2：提交并推送**
  - 提交 README 和计划文档。
  - 推送分支并创建 PR。

- [ ] **Step 4.3：更新 GitHub About**
  - 使用 gh repo edit 写入仓库元数据。
