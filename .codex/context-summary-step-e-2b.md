## 项目上下文摘要（Step E-2b Studio 页面冒烟测试）

生成时间：2026-05-26 14:06:34 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/api-client.test.ts`
  - 模式：使用 `node:test`、`node:assert/strict` 和临时全局替换做函数级测试。
  - 可复用：中文测试描述、无额外测试框架、用假依赖记录调用参数。
  - 需注意：测试完成后需恢复全局状态。
- **实现2**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：发现测试文件，转译到临时目录，并用 `node --test` 执行。
  - 可复用：多文件测试发现、TypeScript/TSX 转译、临时目录清理。
  - 需注意：React 运行依赖必须能从临时目录解析到项目 `node_modules`。
- **实现3**: `apps/web/app/studio/actions.tsx`
  - 模式：Server Action 从表单读取 `scene_packet_id` 或 `repair_patch_id`，调用统一 `apiFetch()`，成功后 `revalidatePath("/studio")` 并 `redirect()`。
  - 可复用：批准写回 payload、中文错误跳转文案、成功后重新验证页面。
  - 需注意：直接导入 Next `redirect` 和 `revalidatePath` 不适合 Node 单元测试，需要提取无 Next 依赖的 core。
- **实现4**: `apps/web/app/studio/StudioFlow.tsx`
  - 模式：Client Component 负责四步流程展示和自动滚动。
  - 可复用：`StudioFlowStep` 输入契约和四步标签。
  - 需注意：`renderToStaticMarkup()` 不执行 `useEffect`，适合渲染不崩溃的烟测，不覆盖滚动交互。

### 2. 项目约定

- **命名约定**: TypeScript 类型 PascalCase，函数 camelCase，测试文件 `*.test.tsx`。
- **文件组织**: Studio 页面逻辑在 `apps/web/app/studio/`，测试在 `apps/web/tests/`。
- **导入顺序**: Node 内置模块、第三方 React 模块、项目相对模块。
- **代码风格**: 用户可见文案、测试描述、断言消息使用简体中文。

### 3. 可复用组件清单

- `apps/web/app/studio/StudioFlow.tsx`: Studio 流程渲染烟测对象。
- `apps/web/app/studio/actions.tsx`: Server Action 薄包装入口。
- `apps/web/app/studio/validators.ts`: 批准写回响应校验。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 本地测试执行器。

### 4. 测试策略

- **测试框架**: Node.js `node:test`。
- **渲染方式**: `react-dom/server` 的 `renderToStaticMarkup()`，已通过 Context7 查询 React 官方文档确认适用于非交互静态 HTML 输出。
- **测试模式**: StudioFlow 渲染烟测、批准写回空输入校验、提交 API payload 单元测试。
- **覆盖要求**: 局部 `pnpm test studio`、全量 `pnpm test`、`pnpm run lint`。

### 5. 依赖和集成点

- **外部依赖**: React、React DOM Server、Node.js 测试运行器。
- **内部依赖**: `approval-action-core.ts` 承担无 Next 依赖的表单校验、提交与跳转 URL 生成；`actions.tsx` 注入 Next 依赖。
- **集成方式**: `approveStudioWritebackAction()` 继续作为页面 `<form action={...}>` 入口，内部调用 `submitStudioApproval()`。
- **配置来源**: `apps/web/package.json` 的 `test` 与 `lint` 脚本。

### 6. 技术选型理由

- **为什么用这个方案**: 不新增 React Testing Library/Vitest/Jest，复用已有 `node:test`，把难测的 Server Action 剥离为纯依赖注入 core。
- **优势**: 覆盖计划要求，降低 Next 运行时 mock 成本，保持 Server Action 薄入口。
- **劣势和风险**: `renderToStaticMarkup()` 只覆盖静态渲染，不覆盖浏览器交互和滚动效果。

### 7. 关键风险点

- **并发问题**: 无共享可变全局状态，提交测试使用局部假依赖。
- **边界条件**: 空表单、单一 Repair Patch ID、响应格式校验。
- **性能瓶颈**: 转译文件数量少，测试运行成本低。
- **安全考虑**: 本步骤仅验证本地表单 payload 与错误流，不新增安全控制。

