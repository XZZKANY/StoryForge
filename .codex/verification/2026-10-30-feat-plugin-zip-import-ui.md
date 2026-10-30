## 2026-10-30 插件第 5 刀后半：设置页「从压缩包导入…」入口（界面侧）

- 背景：宿主侧（`feat/plugin-zip-import`，PR #543，未合）已让 `plugin_stage_import(source)` 认文件夹或 `.zip`，返回的暂存形状与文件夹导入一样。本分支从 `origin/feat/plugin-zip-import` 开出，只动前端：设置页插件面板加一个次要按钮「从压缩包导入…」，选中的 .zip 走和文件夹同一条「暂存 → 预览 → 安装」流程。不编 Rust、不改宿主。
- 改动：
  - `apps/desktop/frontend/src/components/settings/usePlugins.ts`：`startImport(source)`，`source` 为 `'folder'`（默认，原样 `open({ directory: true, … })`）或 `'zip'`（`open({ multiple: false, directory: false, filters: [{ name: '插件压缩包', extensions: ['zip'] }], title: '选择插件压缩包（.zip）' })`）；之后同一个 `stagePluginImport` → `describeStagedPlugin` → 预览；取消选择直接返回；宿主报错照旧弹「导入插件失败：…」。`importing` 布尔照旧导出，新增 `importingFrom`（`'folder' | 'zip' | null`）让转圈只出现在点的那个按钮上。
  - `apps/desktop/frontend/src/components/settings/PluginsSection.tsx`：「从文件夹导入…」旁加「从压缩包导入…」（`variant="secondary"`、`size="sm"`，与原按钮同款，`data-testid="plugins-import-zip"`）；两个按钮放进 `flex flex-wrap gap-2`；设置搜索词加「压缩包 zip」。内置插件卡片不显示「移除」那处没动。
  - `apps/desktop/frontend/src/lib/plugin-library.ts`、`PluginImportDialog.tsx`：只改注释（「文件夹或 .zip」）。预览对话框里没有显示来源的文案，所以没加。
- Tauri 权限：`apps/desktop/src-tauri/tauri.conf.json` 的 `main-capability` 已有 `dialog:allow-open`，选文件与选文件夹是同一个 `open` 命令、同一条权限，没改 capabilities。
- 验证（只跑相关测试，没跑 `pnpm verify` 与前端全量）：
  - 依赖：`npm ci --prefix apps/desktop/frontend`；corepack shim 的 pnpm 9 `pnpm install --frozen-lockfile`（前端类型检查要 workspace 包）。
  - `npx vitest run tests/settings-plugins.test.tsx tests/ui-terminology.test.ts tests/source-standards.test.ts tests/context-panel-plugins.test.tsx`：4 files，36 passed。`settings-plugins` 18 条（新增 3 条：压缩包导入走 zip 过滤且不是选文件夹 → 把路径交给 `stagePluginImport` → 出预览；选压缩包时取消不暂存不弹预览；压缩包暂存失败照样弹宿主原因）；原有文件夹导入用例不变照过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - 改动文件 `prettier --check`、`eslint`：通过（测试文件先 `prettier --write` 了一次）。
- 变异（脚本定点替换、替换前断言目标串只出现 1 次，跑完无条件还原，还原后 `git diff --stat` 与变异前一致）：
  1. 压缩包按钮仍按文件夹方式打开（`source === 'zip'` 改成 `source === 'NOPE'`）：恰 1 条红——「从压缩包导入：选 .zip 文件（不是文件夹）→ 同一暂存 → 预览」。
  2. 压缩包选中后不调用 `stagePluginImport`（暂存前插 `if (source === 'zip') return;`）：两条压缩包用例红；另有 4 条文件夹 / 预览用例连带红——被跳过的用例留下的 `mockResolvedValueOnce` 没被消费，`vi.clearAllMocks()` 不清这些一次性返回值，漏进后面的用例。这是测试文件既有的隔离方式，本刀没改。
  - 还原后上面 4 个文件再跑：36 passed。
- 没联通 / 没验：没在真宿主上点穿（没起 `pnpm dev`、没跑 Tauri 冒烟或真宿主探针），系统文件选择框里 zip 过滤器的观感、真 .zip 选中后经宿主暂存再预览的全链路都只在替身测试里验过；宿主侧本身的验证见 `2026-10-30-feat-plugin-zip-import.md`。
