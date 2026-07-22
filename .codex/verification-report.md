# 验证报告 · dogfood 波4：全局 toast / 设置增强 / 轻量更新检查

时间：2026-07-18
分支：`feat/dogfood-wave4-20260718`
前置：波1 #151、波2 #152、波3 #153 已合并。本刀是 15 条清单四波推进的收官波。

## 问题与变更

### #13 通知落右下角

- 新增 `lib/toast.ts`（事件桥 `TOAST_EVENT`，info/success/error 三音调，error 停留更久）
  + `shell/ToastHost.tsx`（右下角固定栈、自动消失、手动 ×、上限 4 条丢最旧），
  挂 AppShell 根部。与编辑器内定位型反馈（sf-inline-toast / suggestionStatus）互补。
- 首批接入点：导出当前稿成功（含落点路径）/ 失败、更新提示（见 #15）。保存失败
  维持既有 modal（数据关键路径不降级）。

### #14 设置增强（对标 VS Code 的第一步）

- 搜索框：`SettingsSearchContext` + RowShell 按「标题+描述」自过滤，空查询全显。
- 编辑器区新增：「字体模式」（与状态栏切换同源双入口）、「行号」三档
  （智能 = 正文隐藏 / 总是显示 / 总是隐藏）——`AppSettings.editorLineNumbers`
  （默认 auto，sanitize 兜坏值与旧存档缺字段），`lineNumbersFor(filePath, mode)`
  贯通 useMonacoEditor 创建与 updateOptions 两处。
- 新增「关于」区：当前版本（tauri getVersion，dev 显示「开发模式」）+ 手动检查更新。

### #15 自动更新（轻量方案，非签名 updater）

- 事实前提：仓库公开、无 Releases、有 v* tag；发行流程是本机重建 NSIS 手动装。
  故不做 tauri-plugin-updater 全套（签名 key + 制品 + feed），做「知道有新版」：
  `lib/update-check.ts` 拉 GitHub tags 取数值最大 v*，与 getVersion 比对。
- 启动自检：仅 PROD、延迟 8s、失败静默（GitHub 在本机依赖代理，不可用是常态），
  查到新版 toast 提示；设置「关于」区可手动检查并内联显示结果（含失败原因）。

## 验证

- 前端 vitest 全量 `58 files / 297 passed`（新增 toast 3 例、update-check 3 例、
  settings-view 2 例、lineNumbersFor 覆盖档 1 例）。
- typecheck 绿；`pnpm lint` 0 errors + prettier 绿（仅 Editor.tsx 既有 warning）。
- `pnpm verify` 全量门禁见 PR。

## 红线审计

- 新增唯一出网点：`api.github.com` tags 只读 GET（无鉴权、无遥测、不带本机信息），
  失败降级不重试轰炸；启动自检一次性。
- 后端零改动、OpenAPI 零漂移；设置持久化仍走既有 localStorage sanitize 通道。

## 未验证项

- 真机：toast 观感与遮挡关系、设置搜索手感、关于区版本显示、代理开关下更新
  检查两种结果——归下次真机波。
- 全套静默 updater（签名 + feed + 自动下载安装）明确不在本刀；若未来发行流程
  改为发 GitHub Releases 附 NSIS 制品，再评估 tauri-plugin-updater。

---

# 验证报告 · 发行车队独立迁移

时间：2026-07-20

## 迁移结果

- 发行车队已迁至独立 Git 仓 `D:\StoryForge-Publish`。
- StoryForge 已移除 `features/publish`、8 个发行专属前端测试、publish Tauri 命令/能力和
  `docs/internal/publish-fleet`；源码残留扫描计数为 0。
- 新增 `packages/project-core` 作为小说项目路径与文件系统契约的唯一源码；Desktop IDE 以
  `file:../../../packages/project-core` 消费，独立 Publish 仓使用对应版本的 vendor tarball。
- 新 Publish 应用首次访问数据目录时只在新目录为空的情况下复制旧
  `com.storyforge.ide/publish` 数据，不删除旧数据。

## 验证

- `D:\StoryForge-Publish`: `pnpm typecheck`、`pnpm test`（8 files / 46 tests）、
  `pnpm build`、`cargo check` 均通过。
- StoryForge: `packages/project-core` typecheck + 2 tests、Desktop frontend typecheck +
  50 files / 251 tests、`apps/desktop/src-tauri` `cargo check`、`git diff --check` 均通过。
- `pnpm verify` 全量通过：API 1075 passed / 3 skipped、workflow 323 passed、sidecar daily
  冒烟通过、OpenAPI 无 drift。Lint 仅保留既有 `Editor.tsx` Hook 依赖 warning。

## 未验证项

- 未运行真机 Tauri GUI 登录、旧 app config 数据首次复制和发布动作；这些需要实际平台账号与
  手动确认，不应由自动测试伪造通过。

---

# 验证报告 · v3 欢迎页（dogfood #8）

时间：2026-07-23

## 背景

真机 dogfood 15 条清单 #8「欢迎页」定性为「原型设计过但从未落代码」——该欢迎页只存在于
`记事本` v2/v3 壳子原型，app 一直是极简 composer 首页。本刀照 v3 原型把它做出来。#12
「资源管理器」判 WAI（文件树在活动栏「文件」图标后，开项目即显示），不改。

## 变更

- `WelcomeWorkspace` 重做为 v3 两栏欢迎页：品牌区 + 左「启动」（一句话开书 composer /
  打开项目 Ctrl O / 新建文件 / 命令面板 Ctrl P / 最近项目内联）+ 右「上手」（配置模型 /
  打开样例项目 / 快捷键速查 / 了解 StoryForge 四张引导卡）+「启动时显示欢迎页」开关。
- 欢迎页可关（页签 ×）：关了露出空起始态（`WelcomeDismissed`），命令面板「显示欢迎页」
  可重开；启动开关持久化到 `showWelcomeOnStartup`（默认开），决定下次起始态。
- 复用现成 handler（开项目 / 新建 / 命令面板 / 样例项目 / 设置 / 发送即开书），后端零改；
  新增图标 BookOpen / Keyboard / Info。
- 顺带清理 v3 替换掉的死代码：欢迎页内联 model/provider 快速切换（`AgentComposerHome` /
  `AgentWorkspace` 及 `useAppPreferences` 的 `handleQuickModelChange`/`handleQuickProviderChange`）
  —— 模型配置能力已由 SettingsView 完整承接（独立写 `llm-provider.json`，另有
  settings-view 测试覆盖），故一并删除其专属 `quick-provider-errors.test.tsx`。

## 验证

- Desktop frontend：`tsc --noEmit` 通过；`vitest run` 50 files / 252 tests 通过（新增
  `welcome-page.test.tsx` 4 例护栏，删除 `quick-provider-errors.test.tsx` 3 例）。
- `apps/desktop/src-tauri` `cargo check` 通过（发行车队移除后 Rust 侧绿）。
- 改动文件 prettier + eslint 均通过。

## 未验证项

- 真机 Tauri GUI 欢迎页观感（两栏布局 / 引导卡 / 关开欢迎页 / 启动开关持久化 / 品牌
  logo 加载）归 E2E-1 真机清单，未验。
