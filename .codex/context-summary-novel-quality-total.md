## 项目上下文摘要（novel-quality-total）

生成时间：2026-05-30 04:05:22

### 1. 相似实现分析

- **实现1**: apps/workflow/storyforge_workflow/prompts/models.py
  - 模式：冻结 dataclass 承载 prompt 输入；字段默认值允许空数据退化。
  - 可复用：_clean()、_clean_list()、CharacterConstraint.describe()、StyleDirective.has_content()、PacingDirective.has_content()。
  - 需注意：模型层不读存储，不绑定 LLM；注释解释意图。
- **实现2**: apps/workflow/storyforge_workflow/prompts/context.py
  - 模式：GenerationState 可选注入键通过私有 _xxx_from_state() 映射成结构化 dataclass。
  - 可复用：_str()、_str_list()、Mapping/Sequence 安全退化判断。
  - 需注意：非 dict 或缺字段必须退化为空对象，不能破坏旧 state。
- **实现3**: apps/workflow/storyforge_workflow/prompts/builder.py
  - 模式：纯函数 prompt builder，使用 _section()、_join_sections()、_clean() 实现空段省略。
  - 可复用：_craft_section()、_position_section()、_continuity_section()、build_critique_prompt()、build_revision_prompt()。
  - 需注意：输出契约被测试断言绑定，修改时兼容旧“通过”语义。
- **实现4**: apps/workflow/storyforge_workflow/orchestrators/novel_loop.py
  - 模式：端口注入外部副作用，
un_single_chapter_loop() 保持 deterministic 单测。
  - 可复用：NovelLoopPorts、NovelLoopResult、_optional_int()。
  - 需注意：不能改变 BookLoop 对 NovelLoopResult.status 的判断契约。
- **实现5**: apps/api/app/domains/exports/book_markdown_exporter.py
  - 模式：从 BookRun progress 和 DB 证据链导出 book.md / audit_report.json 制品。
  - 可复用：章节进度归一、artifact 创建、审计 JSON 构造。
  - 需注意：质量摘要只能追加字段，不能覆盖原审计链。
- **实现6**: apps/web/app/book-runs/audit.tsx
  - 模式：React 服务端可渲染组件，直接读取 BookRunRead.progress 投影审计事件。
  - 可复用：空状态渲染、auditEvents() 数据归一。
  - 需注意：无质量数据时显示空态，不引入新 UI 库。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case 函数/字段与 PascalCase dataclass；TypeScript 类型使用 PascalCase，函数/变量 camelCase。
- **文件组织**: workflow prompt 模型、context、builder 分层；orchestrators 只编排端口；API domain 分 schemas/service/exporter；Web app 路由与组件就近放置。
- **导入顺序**: Python from __future__ import annotations → 标准库 → 项目内导入；TypeScript 先 React/框架，再相对模块。
- **代码风格**: Python 4 空格、显式返回类型、纯函数优先；TSX 使用只读类型和语义化标题。

### 3. 可复用组件清单

- apps/workflow/storyforge_workflow/prompts/models.py: 冻结 dataclass 与清洗函数模式。
- apps/workflow/storyforge_workflow/prompts/context.py: state 安全映射模式。
- apps/workflow/storyforge_workflow/prompts/builder.py: _section()/_join_sections() 分段渲染。
- apps/workflow/storyforge_workflow/orchestrators/novel_loop.py: 端口注入、修订预算和状态契约。
- apps/api/app/domains/exports/book_markdown_exporter.py: BookRun 审计导出结构。
- apps/web/app/book-runs/audit.tsx: BookRun 审计页面展示模式。

### 4. 测试策略

- **测试框架**: Python 使用 pytest；Web 使用 Node 内置 test + React server render；总门禁使用 pnpm 脚本。
- **测试模式**: 先红灯断言新增契约，再实现绿灯；workflow 测 prompt 字符串和 NovelLoop 分支；API 测导出 JSON；Web 测静态 HTML。
- **参考文件**: apps/workflow/tests/test_prompt_builder.py、apps/workflow/tests/test_novel_loop_single_chapter.py、apps/api/tests/test_book_exporter.py、apps/web/tests/book-run-audit.test.tsx。
- **覆盖要求**: 正常流程、空数据退化、坏样例、严重问题暂停、审计追加字段、Web 空态。

### 5. 依赖和集成点

- **外部依赖**: Python dataclass/pytest；TypeScript React server render；不新增真实 LLM 前置依赖。
- **内部依赖**: NarrativeContext -> build_draft_prompt/build_critique_prompt/build_revision_prompt -> NovelLoopPorts -> BookLoop progress -> audit_report.json -> Web 审计页。
- **集成方式**: 质量能力以独立 quality 模块和 dataclass 注入；静态检查通过 NovelLoop 可选端口接入。
- **配置来源**: workflow state prompt injection keys、BookRun progress JSON、现有 pnpm/uv 脚本。

### 6. 技术选型理由

- **为什么用这个方案**: 沿用现有纯函数和端口注入架构，保证缺少真实 LLM 时可 deterministic 测试。
- **优势**: 改动边界清晰、可空退化、可审计、对 BookLoop status 兼容。
- **劣势和风险**: 静态规则启发式可能误报；通过 fixture 和阈值控制降低误伤。

### 7. 关键风险点

- **并发问题**: 本次不引入共享可变状态；端口函数由调用方注入。
- **边界条件**: 空正文、非 dict state、缺质量数据、全对白或全旁白。
- **性能瓶颈**: 静态检查应使用线性扫描和短窗口计数，避免复杂 NLP 依赖。
- **安全考虑**: 本任务不新增认证/鉴权路径，质量数据仅作为审计附加信息。

### 8. 工具替代说明

本环境未暴露 sequential-thinking、desktop-commander、context7、github.search_code、shrimp-task-manager。已用本地 PowerShell 文件搜索/读取、pytest 基线验证、.codex 留痕和 update_plan 替代；未进行网页搜索或远程 CI 验证。
