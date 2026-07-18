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
