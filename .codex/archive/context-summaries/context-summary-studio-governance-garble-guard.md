## 项目上下文摘要（Studio 治理事实源乱码回归测试）

生成时间：2026-05-21 03:25:00 +08:00

### 1. 相似实现分析

- **实现1**：`apps/web/tests/phase1-navigation.test.tsx` 的 `assertCleanChineseContract()`
  - 模式：读取文本后断言没有连续问号占位、没有替换字符，并且包含真实中文。
  - 可复用：直接用于项目级治理文档清洁检查。
  - 需注意：该 helper 默认按 `apps/web` 工作目录读取相对路径。
- **实现2**：同文件的 `Phase 6 工作台契约文档进入索引并区分交付状态` 测试
  - 模式：在测试内部定义 `readProject()`，通过 `..` 路径读取项目根文档。
  - 可复用：读取 `docs/architecture/phase6-workbench-contract.md`、`TODO.md` 和 `.codex/*`。
  - 需注意：断言应聚焦事实源关键文本，避免覆盖过长历史日志。
- **实现3**：同文件的 `Studio Server Action 批准写回执行入口` 断言
  - 模式：用 `assertIncludesAll()` 校验页面源代码中存在 Server Action、表单字段和结果提示。
  - 可复用：治理文档测试也使用关键事实字符串断言。
  - 需注意：本轮只增强测试，不改业务页面。

### 2. 项目约定

- **命名约定**：测试名使用中文描述；helper 使用现有 `assert*` 命名。
- **文件组织**：Web 静态契约测试集中在 `apps/web/tests/phase1-navigation.test.tsx`。
- **导入顺序**：不新增导入。
- **代码风格**：使用 `node:test`、`assertIncludesAll()` 和短数组列出契约文本。

### 3. 可复用组件清单

- `assertCleanChineseContract(path)`：校验文件无乱码占位且包含中文。
- `assertIncludesAll(content, values, label)`：批量断言关键文本。
- `readProject(path)` 模式：读取项目根路径下的治理文档。
### 4. 测试策略

- **测试框架**：Node.js 内置 `node:test`。
- **测试模式**：静态契约测试，读取文档源文件并断言关键中文事实。
- **参考文件**：`apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**：Phase 6 契约、当前阶段、TODO 和 Studio 上下文摘要均不得回退为旧执行入口表述或连续问号占位。

### 5. 依赖和集成点

- **外部依赖**：无新增依赖。
- **内部依赖**：Web 测试读取项目级 Markdown 文件。
- **集成方式**：加入现有 `pnpm --filter @storyforge/web test` 契约链。
- **配置来源**：`process.cwd()` 为 `apps/web`。

### 6. 技术选型理由

- **为什么用这个方案**：上一轮真实出现 `.codex` 连续问号乱码，静态契约测试可以本地快速阻断回归。
- **优势**：零依赖、低成本、与现有 Web 契约测试一致。
- **劣势和风险**：文档文本变动会影响测试，因此断言只选择稳定的核心事实。

### 7. 关键风险点

- **测试脆弱性**：不扫描全部长历史日志，只覆盖本轮上下文摘要和主事实源。
- **路径风险**：项目级文件需通过 `..` 相对路径读取。
- **范围风险**：不把最小批准写回闭环夸大为完整 Studio 编排器。
