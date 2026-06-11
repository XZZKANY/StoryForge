## 项目上下文摘要（源码剪枝 web-assistant-tool-catalog）

生成时间：2026-06-05 13:48:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-tool-catalog.ts`
  - 模式：维护一套静态 Assistant 工具 metadata、内置工具列表和 catalog 查询 helper。
  - 可复用：当前生产链路无导入；属于未接入的规划式模块。
  - 需注意：该模块只由专属测试和 phase1 转译脚本引用。
- **实现2**: `apps/web/tests/assistant-tool-catalog.test.ts`
  - 模式：只覆盖 `assistant-tool-catalog.ts` 自身的规范化、内置工具补齐和领域过滤。
  - 可复用：无；目标模块删除后该专属测试也应删除。
  - 需注意：不是生产行为护栏。
- **实现3**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：将测试依赖的真实 TS/TSX 模块转译到临时目录，并重写 import 到 `.mjs`。
  - 可复用：只删除 `assistant-tool-catalog` 相关 runtimeModules 和 importRewrites 条目。
  - 需注意：该文件已有其他未提交修改，本批不触碰无关条目。
- **实现4**: `apps/web/tests/source-pruning.test.ts`
  - 模式：使用 `existsSync` 和脚本文本 forbidden 清单防止已下线 Web 模块回归。
  - 可复用：新增 `assistant-tool-catalog` 文件不存在和转译脚本引用不存在护栏。
  - 需注意：测试标题和断言消息使用简体中文。
- **实现5**: `apps/web/components/home/AssistantConversation.tsx`
  - 模式：真实 Home 对话链路使用 session store、intent parser、BookRun 读取和 tool-node mapper。
  - 可复用：作为生产链路不依赖 catalog 的对照。
  - 需注意：本批不修改生产 Home 组件。

### 2. 项目约定

- **命名约定**: Web 测试文件使用短横线命名，Node test 标题和断言消息使用简体中文。
- **文件组织**: Home 生产能力位于 `components/home` 已接入组件和 action/store/helper；未接入规划式模块应通过 source-pruning 护栏下线。
- **导入顺序**: Node 内置模块导入在前，项目模块导入在后；本批删除专属测试后不新增生产导入。
- **代码风格**: TypeScript/React 项目使用 `pnpm --filter @storyforge/web test` 和 `pnpm --filter @storyforge/web lint` 验证。

### 3. 可复用组件清单

- `apps/web/tests/source-pruning.test.ts`: 本批剪枝防回归护栏。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 本地测试 runner。
- `apps/web/components/home/AssistantConversation.tsx`: 真实 Home 对话链路。
- `apps/web/components/home/assistant-tool-node-mapper.ts`: 已接入的工具节点映射。
- `apps/web/components/home/assistant-session-store.ts`: 已接入的 Assistant 会话读写。

### 4. 测试策略

- **测试框架**: Node test，经 `apps/web/scripts/phase1-contract-test.mjs` 转译运行。
- **测试模式**: 先扩展 source-pruning 红灯测试，再删除未接入模块、专属测试和转译脚本引用。
- **参考文件**: `tests/source-pruning.test.ts`、`scripts/phase1-contract-test.mjs`。
- **覆盖要求**: `assistant-tool-catalog.ts` 不再存在；phase1 转译脚本不再引用该模块；Web 全量 test 和 lint 仍通过。

### 5. 依赖和集成点

- **外部依赖**: pnpm、Node test、TypeScript、Next.js 类型检查。
- **内部依赖**: 当前仅专属测试和 phase1 转译脚本引用 `assistant-tool-catalog`。
- **集成方式**: 删除未接入模块，不修改 Home 生产组件、BookRun action、session store、tool-node-mapper、runtime tools API、shared contracts 或 Next 路由。
- **配置来源**: `apps/web/package.json` 指定 `test` 和 `lint` 脚本。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库生产链路无 `assistant-tool-catalog` 导入，保留该模块只增加测试转译维护面；已有 source-pruning 模式适合锁定下线边界。
- **优势**: 减少未接入规划式 Home 模块，降低 phase1 转译脚本和专属测试维护面。
- **劣势和风险**: 外部未记录导入该 helper 的测试或工具会失效；当前仓库生产链路无此调用。

### 7. 关键风险点

- **并发问题**: 不涉及运行时并发。
- **边界条件**: 不修改 Home 生产组件、BookRun action、session store、tool-node-mapper、runtime tools API、shared contracts 或 Next 路由。
- **性能瓶颈**: 删除转译输入会略微减少测试维护面，无运行时性能影响。
- **安全考虑**: 不修改认证、鉴权、Provider 凭据、API 客户端或安全响应逻辑。
