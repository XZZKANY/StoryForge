## 项目上下文摘要（Novel Skill Framework 后续阶段）

生成时间：2026-05-31 05:13:35

### 1. 相似实现分析

- **实现1**: apps/workflow/storyforge_workflow/skills/definitions.py
  - 模式：@dataclass(frozen=True) 定义不可变契约，NovelSkillRegistry 以固定元数据注册，不做动态目录扫描。
  - 可复用：NovelSkillDefinition、NovelSkillRegistry.default 可作为 runner 查询技能版本与状态契约的来源。
  - 需注意：禁止状态值在定义层校验，新增题材技能必须沿用同一校验。
- **实现2**: apps/workflow/storyforge_workflow/skills/audit.py
  - 模式：从 BookLoop progress 只读派生摘要，不修改输入。
  - 可复用：SKILL_CHAIN_VERSION、derive_skill_chain_summary() 是 API 审计报告追加 skill_chain 的来源。
  - 需注意：缺少真实 skill_runs 时必须保留旧派生行为。
- **实现3**: apps/workflow/storyforge_workflow/orchestrators/novel_loop.py
  - 模式：NovelLoopPorts 注入外部依赖，run_single_chapter_loop() 负责分支判断和结果契约。
  - 可复用：compile/generate/record/judge/repair/approve/memory 端口链路，runner 只能包装端口调用。
  - 需注意：不得新增 NovelLoop/BookLoop 终态；skill_runner is None 时必须保持原行为。
- **实现4**: apps/api/app/domains/exports/book_markdown_exporter.py
  - 模式：导出 book.md / audit_report.json 并登记 Artifact。
  - 可复用：export_book_run_audit_report() 是实际报告生成入口。
  - 需注意：只追加 skill_chain，保留旧字段和完整性检查。
- **实现5**: apps/web/app/book-runs/audit.tsx
  - 模式：服务端可渲染 React 组件，基于 BookRunRead.progress 派生只读审计列表。
  - 可复用：EvidenceItem、formatEvidenceValue()、renderToStaticMarkup 测试方式。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case，类使用 PascalCase；TypeScript 组件使用 PascalCase，辅助函数 camelCase。
- **文件组织**: workflow 业务在 apps/workflow/storyforge_workflow，API 域服务在 apps/api/app/domains，Web 页面在 apps/web/app，测试贴近各 app 的 tests 目录。
- **导入顺序**: from __future__ import annotations，标准库，再第三方，再项目内模块。
- **代码风格**: pytest 直接 assert；Python dataclass 多用 frozen；React 测试使用 Node assert 和 renderToStaticMarkup。

### 3. 可复用组件清单

- apps/workflow/storyforge_workflow/skills/definitions.py: 技能定义、默认注册表和状态校验。
- apps/workflow/storyforge_workflow/skills/audit.py: 技能链摘要版本和只读派生。
- apps/workflow/storyforge_workflow/orchestrators/novel_loop.py: NovelLoopPorts 与 NovelLoopResult 契约。
- apps/api/app/domains/exports/book_markdown_exporter.py: BookRun 导出审计报告入口。
- apps/web/app/book-runs/audit.tsx: 审计页展示组件。

### 4. 测试策略

- **测试框架**: workflow/api 使用 pytest；web 使用 Node test + React 服务端渲染；根级使用 pnpm 脚本。
- **测试模式**: 先新增失败测试，再最小实现，再运行目标文件和回归集合。
- **参考文件**: apps/workflow/tests/test_novel_loop_single_chapter.py、apps/workflow/tests/test_skill_audit_summary.py、apps/api/tests/test_book_exporter.py、apps/web/tests/book-run-audit.test.tsx。
- **覆盖要求**: 正常 approve、repair、静态门阻断、旧 progress 兼容、API 空退化、Web 空状态、题材默认不加载。

### 5. 依赖和集成点

- **外部依赖**: Python 3.13、pytest、Pydantic/FastAPI/SQLAlchemy、React/Next.js、pnpm。
- **内部依赖**: runner 依赖 NovelSkillRegistry 与 NovelLoopRequest，NovelLoop 可选依赖 runner；API 导出依赖 workflow 的 derive_skill_chain_summary。
- **集成方式**: 端口包装，不改变端口接口；audit_report payload 追加字段；Web 只读渲染。
- **配置来源**: 各 app pyproject.toml、根 package.json、已有 pnpm 脚本。

### 6. 技术选型理由

- **为什么用这个方案**: 计划要求以 NovelLoop/BookLoop 为事实源；runner 只记录引用化 NovelSkillRun，不会形成第二套编排器。
- **优势**: 审计链可回放、checkpoint 不膨胀、题材扩展可显式选择。
- **劣势和风险**: API 需要导入 workflow 包，若路径未配置可能失败；Web 现有中文有乱码但本次仅修改必要区域。

### 7. 关键风险点

- **并发问题**: runner 持有 runs 列表，不应跨 BookRun 复用；测试中每次新建实例。
- **边界条件**: 无 skill_runs、空 memory、静态高危门、未知 genre、旧 progress。
- **性能瓶颈**: skill_runs 为小对象列表，导出时线性遍历章节，I/O 影响低。
- **安全考虑**: 本任务不新增动态代码执行、目录扫描或完整 prompt/正文持久化。

### 8. 上下文充分性检查

- 能说出至少 3 个相似实现：是，见 definitions.py、audit.py、novel_loop.py、book_markdown_exporter.py、audit.tsx。
- 理解实现模式：是，固定注册表 + 端口注入 + 只读派生 + SSR 测试。
- 知道可复用组件：是，见第 3 节。
- 理解命名和代码风格：是，见第 2 节。
- 知道如何测试：是，见第 4 节。
- 确认没有重复造轮子：是，runner 不替代 NovelLoop，只封装端口并复用 registry/audit。
- 理解依赖和集成点：是，见第 5 节。
