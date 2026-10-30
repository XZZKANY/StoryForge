## 2026-10-30 插件第 3 刀：插件面板（设置页「插件」分组 + 上下文浮窗「插件」块）

- 背景：插件分刀见 `docs/internal/TODO.md`「2026-10-30 当前入口」。第 1 刀（#530）插件库与解析、第 2 刀（#532）插件技能进对话；本刀是作者能用上插件的入口。设计在对话里给作者看过（设置页管插件库、上下文浮窗按作品勾选），作者回「继续任务」。
- 改动（全在 `apps/desktop/frontend`）：
  - 入口：`lib/api/plugins.ts` + `lib/engine/plugins.ts`（`listPlugins` / `describeStagedPlugin` / `readEnabledPlugins` / `pluginTitle`）；`lib/plugin-events.ts`（安装、移除后发 `PLUGINS_CHANGED_EVENT`）；`lib/settings-section.ts`（「管理插件」记下要滚到的设置分组）。
  - 设置页：`SettingsView.tsx` 导航在「模型服务」后加「插件」（图标 Puzzle，`shell-icons` 导出加一个）；`settings/PluginsSection.tsx` + `usePlugins.ts`：说明行、插件卡片（显示名 · 版本 · 作者、说明、技能 / 写法 / 指令计数、问题首条与「等 N 条」、「查看」展开内容、「移除」走确认后挪进回收夹）、空状态、读失败可重试、「从文件夹导入…」（选文件夹 → 暂存 → 预览，失败 toast 并丢弃暂存）、设置搜索词。
  - 预览对话框 `settings/PluginImportDialog.tsx`：显示名 · 版本 · 作者与说明，Codex 插件注「只用其中的技能」；技能 / 写法 / 指令片段三组，每项带箭头、点开看全文；跳过的文件（有才显示，默认收起）；问题列表；同名已装时列「技能 新增 a、去掉 b、改动 c；写法 …；指令 改动 / 不变」；清单缺失、插件名不合规、三类内容全无时「安装」禁用并说明；Esc / 取消丢弃暂存；安装中禁用、失败对话框不关。
  - 上下文浮窗 `chat-window/PluginsBlock.tsx`（`ContextPanel.tsx` 技能块之后挂上，`ChatWindowView.tsx` 把 `onOpenSettings` 传进来）：列已装插件，复选框按作品写 `.storyforge/plugins.json`（启用追加、取消去掉、不分大小写，本机没装的名字原样保留；写入逐个排队、每次先重读）；启用了但本机没装的灰显带「本机没装」；**启用文件读不懂（坏 JSON、版本不对、有被丢掉的不合规名字）时不覆盖**：复选框全禁用并提示「.storyforge/plugins.json 读不懂，先修好或删掉它再勾选：…」，写之前也重读把关；「管理插件」关浮窗、打开设置并滚到插件分组。
  - `useConversationSkills.ts`：收到插件变动事件、或作品 `.storyforge/plugins.json` 写盘广播时重读（技能块与 `/` 菜单跟着更新）。
- 验证：
  - 新测试 `tests/settings-plugins.test.tsx` 14 条、`tests/context-panel-plugins.test.tsx` 14 条；工作者两轮共 8 处变异（追加顺序、安装用的名字、技能刷新触发、改动计数、滚动请求、坏文件不写、坏文件禁用复选框）均被抓住，已还原。
  - 浏览器截图（不入库，`output/plugin-panel-shots/shoot.mjs`：Vite + Playwright 跑真实前端，Tauri IPC 与引擎读口用内存替身，1400×759 浅色）：设置页插件分组、导入预览（含展开全文、跳过的文件、同名替换摘要）、上下文浮窗插件块、`/` 菜单里的插件技能，共 13 张，console error 0。审查后改了两处：预览里每份内容加展开箭头、「跳过的文件（0）」不显示。
  - `pnpm verify` EXIT=0：project-core 34、引擎 14061 passed + 2 skipped、前端 2565 passed、三个浏览器回归通过。
  - 行尾：`ChatWindowView.tsx` 保持 CRLF（314 行、裸 LF 0），其余 LF；`--numstat` 与 `--ignore-all-space --numstat` 一致。
- 合并 master（#525 界面用词统一，无冲突）后：`tests/ui-terminology.test.ts` 与插件相关测试 35 passed；`pnpm verify` EXIT=0：project-core 34、引擎 14061 passed + 2 skipped、前端 2566 passed、三个浏览器回归通过。插件界面文案不含「项目 / Agent / 补丁」；「书」不在用词表禁用之列，沿用现有「这本书」的说法。
- 再次合并 master（#531 章节检查记录挪到对话头浮窗等）：`ChatWindowView.tsx` 一处冲突（CRLF 文件按字节解决），保留 #531 的 `checkHistoryToggle`、上下文按钮照旧传 `onOpenSettings`；`pnpm verify` EXIT=0：project-core 34、引擎 14073 passed + 2 skipped、前端 2574 passed、三个浏览器回归通过。
- 未覆盖：
  - 没在真宿主上点穿（作者机上开着 StoryForge，隔离宿主会冲突）：真选文件夹、真暂存目录经原生读口读出预览、真写 `.storyforge/plugins.json` 后对话里出现插件技能。
  - 截图里的插件数据是脚本编的。
