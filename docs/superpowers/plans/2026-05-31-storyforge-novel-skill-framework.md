# StoryForge Novel Skill Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 实施阶段一静态技能定义与审计映射，让 BookRun 审计可以按章节展示 generate/judge/repair/approve/memory_extract/export 链路，同时不改变现有 NovelLoop/BookLoop 行为。

**Architecture:** 新增 storyforge_workflow.skills 包，使用静态 NovelSkillDefinition 与 NovelSkillRegistry 描述 6 个技能；新增 derive_skill_chain_summary() 从现有 BookLoopResult.progress 只读派生审计摘要。阶段一不接入运行时、不修改 
ovel_loop.py 或 ook_loop.py。

**Tech Stack:** Python 3.11+、dataclasses、pytest、ruff、uv。

---

## 文件结构

- Create: pps/workflow/storyforge_workflow/skills/__init__.py：导出默认注册表、定义类型和审计派生函数。
- Create: pps/workflow/storyforge_workflow/skills/definitions.py：定义 NovelSkillDefinition、NovelSkillRegistry、6 个静态定义和禁止状态校验。
- Create: pps/workflow/storyforge_workflow/skills/audit.py：实现 derive_skill_chain_summary(progress) 纯函数。
- Create: pps/workflow/storyforge_workflow/skills/{generate,judge,repair,approve,memory_extract,export}/SKILL.md：文件化技能契约。
- Create: pps/workflow/tests/test_novel_skill_registry.py：注册表字段、顺序、错误和禁止状态测试。
- Create: pps/workflow/tests/test_skill_audit_summary.py：审计摘要派生、状态映射和输入不变性测试。
- Create/Update: .codex/context-summary-novel-skill-framework.md、.codex/operations-log.md、.codex/verification-report.md。

### Task 1: 注册表 TDD 与实现

**Files:**
- Create: pps/workflow/tests/test_novel_skill_registry.py
- Create: pps/workflow/storyforge_workflow/skills/__init__.py
- Create: pps/workflow/storyforge_workflow/skills/definitions.py

- [ ] **Step 1: 写失败测试**

测试必须断言：
- DEFAULT_NOVEL_SKILL_REGISTRY.names() 精确等于 ("generate", "judge", "repair", "approve", "memory_extract", "export")。
- 每个定义有 ersion == "1.0.0"、非空 	rigger_conditions、equired_inputs、produced_outputs、llowed_statuses、udit_fields。
- get("missing") 抛出 KeyError，错误信息包含缺失技能名。
- 任意定义字段不出现 epair_required、epair_limit_exceeded、provider_failed、udget_exceeded。

- [ ] **Step 2: 运行失败测试**

Run:

`powershell
cd apps/workflow
uv run pytest tests/test_novel_skill_registry.py -v
`

Expected: import storyforge_workflow.skills 失败或找不到定义。

- [ ] **Step 3: 实现 definitions 与包导出**

实现要点：
- NovelSkillDefinition 使用 @dataclass(frozen=True)。
- NovelSkillRegistry.list()、
ames() 返回稳定 tuple；get(name) 缺失时抛 KeyError(f"小说技能不存在：{name}")。
- __post_init__ 清理字符串序列，禁止空 name/version/description，禁止虚构状态。
- 6 个定义按默认链顺序注册。

- [ ] **Step 4: 运行通过测试**

Run:

`powershell
cd apps/workflow
uv run pytest tests/test_novel_skill_registry.py -v
`

Expected: 全部通过。

### Task 2: 文件化 SKILL.md 定义

**Files:**
- Create: pps/workflow/storyforge_workflow/skills/generate/SKILL.md
- Create: pps/workflow/storyforge_workflow/skills/judge/SKILL.md
- Create: pps/workflow/storyforge_workflow/skills/repair/SKILL.md
- Create: pps/workflow/storyforge_workflow/skills/approve/SKILL.md
- Create: pps/workflow/storyforge_workflow/skills/memory_extract/SKILL.md
- Create: pps/workflow/storyforge_workflow/skills/export/SKILL.md

- [ ] **Step 1: 创建统一结构**

每个文件包含 frontmatter：
ame、ersion: 1.0.0、中文 description，并包含章节：触发条件、输入契约、输出契约、硬门禁、审计字段、下一步。

- [ ] **Step 2: 检查禁止状态**

Run:

`powershell
Select-String -Path apps/workflow/storyforge_workflow/skills/**/*.md -Pattern "repair_required","repair_limit_exceeded","provider_failed","budget_exceeded"
`

Expected: 无匹配。

### Task 3: 审计摘要 TDD 与实现

**Files:**
- Create: pps/workflow/tests/test_skill_audit_summary.py
- Create: pps/workflow/storyforge_workflow/skills/audit.py

- [ ] **Step 1: 写失败测试**

测试必须覆盖：
- approved 章节输出 generate/judge/approve/memory_extract，其中 memory 空列表时为 memory_extract_skipped。
- blocked chapter 输出章节状态 waiting_review，不得输出 epair_limit_exceeded。
- pause_reason 映射到 ook_status_projection.status == "paused_by_budget"。
- provider_degradation 映射到 ook_status_projection.status == "paused_by_provider_degradation"。
- 使用 copy.deepcopy() 验证输入 progress 未被修改。

- [ ] **Step 2: 运行失败测试**

Run:

`powershell
cd apps/workflow
uv run pytest tests/test_skill_audit_summary.py -v
`

Expected: import derive_skill_chain_summary 失败。

- [ ] **Step 3: 实现 audit.py**

实现要点：
- 函数签名：derive_skill_chain_summary(progress: Mapping[str, Any]) -> dict[str, Any]。
- 只读取 mapping，不写回输入。
- approved 章从 model_run_id、judge_report_id、epair_patch_id、pproved_scene_id、memory_atom_ids 构造技能摘要。
- blocked 章只给出 generate/judge 和可选 repair 引用，章节 status 固定沿用 waiting_review。
- Book 级状态只在 ook_status_projection 表达。

- [ ] **Step 4: 运行通过测试**

Run:

`powershell
cd apps/workflow
uv run pytest tests/test_skill_audit_summary.py -v
`

Expected: 全部通过。

### Task 4: 回归验证与审查报告

**Files:**
- Create: .codex/verification-report.md
- Update: .codex/operations-log.md

- [ ] **Step 1: 运行阶段一指定 pytest**

`powershell
cd apps/workflow
uv run pytest tests/test_novel_skill_registry.py tests/test_skill_audit_summary.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v
`

Expected: 全部通过。

- [ ] **Step 2: 运行 ruff**

`powershell
cd apps/workflow
uv run ruff check storyforge_workflow/skills tests/test_novel_skill_registry.py tests/test_skill_audit_summary.py
`

Expected: All checks passed.

- [ ] **Step 3: 写验证报告**

报告包含：需求字段完整性、原始意图覆盖、交付物映射、依赖与风险评估、命令结果、技术评分、战略评分、综合评分和结论。

## 回滚方式

删除以下新增文件/目录即可回滚阶段一：

`	ext
apps/workflow/storyforge_workflow/skills/
apps/workflow/tests/test_novel_skill_registry.py
apps/workflow/tests/test_skill_audit_summary.py
docs/superpowers/plans/2026-05-31-storyforge-novel-skill-framework.md
.codex/context-summary-novel-skill-framework.md
.codex/verification-report.md
`

保留或裁剪 .codex/operations-log.md 中本次记录。回滚后运行 cd apps/workflow && uv run pytest tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v。
