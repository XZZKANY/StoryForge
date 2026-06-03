## 项目上下文摘要（首页最近记录真实化）

生成时间：2026-06-02 00:16:50 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/HomeSidebar.tsx`
  - 模式：左侧导航由 `home-data.ts` 提供静态导航配置，业务状态通过 props 输入。
  - 可复用：`homeRecentEmpty`、`HomeRecentItem` 类型。
  - 需注意：最近记录不能在组件内部构造伪业务历史。
- **实现2**: `apps/web/components/home/HomeShell.tsx`
  - 模式：首页壳层统一接收 `activeView`、`searchParams` 和可选业务数据，再分发到子组件。
  - 可复用：`HomeShell` 作为真实数据接入口。
  - 需注意：当前没有真实最近记录来源时应传空数组。
- **实现3**: `apps/web/app/page.tsx`
  - 模式：页面入口只解析查询参数并向 HomeShell 传递状态。
  - 可复用：`parseHomeView`、`HomeSearchParams`。
  - 需注意：不要在页面入口硬编码展示用历史。

### 2. 项目约定

- **命名约定**：组件使用 PascalCase，类型以业务域命名，例如 `HomeRecentItem`。
- **文件组织**：首页 UI 数据在 `components/home/home-data.ts`，视图状态在 `components/home/home-view.ts`。
- **导入顺序**：外部依赖优先，随后本地组件和类型。
- **代码风格**：TypeScript 只读 props，中文测试描述，组件显式处理空状态。

### 3. 可复用组件清单

- `apps/web/components/home/HomeSidebar.tsx`：最近记录展示与空状态渲染。
- `apps/web/components/home/HomeShell.tsx`：首页主工作台数据分发入口。
- `apps/web/components/home/home-data.ts`：保留 `HomeRecentItem` 类型与 `homeRecentEmpty` 空状态文案。
- `apps/web/components/home/home-view.ts`：首页子页 query 契约。

### 4. 测试策略

- **测试框架**：Node test，经 `apps/web/scripts/phase1-contract-test.mjs` 统一运行。
- **测试模式**：文本契约测试加浏览器运行态验证。
- **参考文件**：`apps/web/tests/home-page.test.tsx`。
- **覆盖要求**：禁止静态伪记录、验证 props 契约、验证无真实来源时显示空状态。

### 5. 依赖和集成点

- **外部依赖**：Next.js App Router、React、Playwright。
- **内部依赖**：`app/page.tsx` -> `HomeShell` -> `HomeSidebar`。
- **集成方式**：后续真实 Blueprint 或 BookRun 历史接入 `recentItems` props。
- **配置来源**：当前首页无真实最近记录查询源，因此显式传 `recentItems={[]}`。

### 6. 技术选型理由

- **为什么用这个方案**：最近记录是业务事实，不能由展示层静态伪造；props 契约能把真实数据来源留给上游。
- **优势**：避免误导用户，保留未来接入真实历史的稳定接口。
- **劣势和风险**：当前未实现真实历史读取，用户看到空状态；后续需要从真实 Blueprint/BookRun 数据补齐。

### 7. 关键风险点

- **边界条件**：无记录时必须显示清晰空状态。
- **性能瓶颈**：本次未新增运行时查询，无新增性能风险。
- **安全考虑**：不读取 `.codex` 日志或本地文件伪装业务历史，避免把内部操作记录误当用户业务数据。
