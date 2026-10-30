## 2026-10-30 插件第 2 刀：作品启用的插件技能接进对话

- 背景：插件分刀见 `docs/internal/TODO.md`「2026-10-30 当前入口」。第 1 刀（#530）做了插件库与解析；本刀让作品启用的插件里的技能进对话：技能目录、`/` 点名、只读工具 `skill.read`、续跑指纹、界面显示。作品启用插件的入口（插件面板）是下一刀，眼下只能手写 `.storyforge/plugins.json`。
- 引擎：
  - 依赖：可选 `pluginLibraryRoot`（缺省 null = 没有插件）沿 `AgentRuntimeDeps` → `runChatLoop` → `storyforgeMessages` / `SourceDeps` / `ToolDeps` 传下；前端 `lib/engine/agent.ts` 用 `pluginLibraryDir().catch(() => null)` 取，取不到对话照常。
  - `kernel/conversationSkills.ts`：`loadAvailableSkills` = 作品技能（规则不变）+ 按启用顺序的插件技能（合计 ≤ 20），重名丢弃（作品优先、先启用的插件优先）；`findAvailableSkill`、`hasPluginSkills`。技能目录与点名段只在有插件技能时换说法、插件行写「（插件「id」）」；没有插件时逐字不变。
  - 新只读工具 `skill.read`（`specs/skill.ts`、`skillHandlers.ts`）：参数只有 `name`，作品与插件技能都能读，最多 20000 码点；未知名字报错并列出可用名字。**只在这一轮可用技能里有插件技能时才装进 SDK 工具表**（`chatLoopAdapters.ts`），没装时模型硬调按未知工具处理，与 master 一致。
  - 续跑指纹：插件技能（点名或 `skill_read` 读过）记在 `plugin:<id>/<插件内路径>` 键下，同时记插件文件夹绝对路径，核对时用记下的路径（保存点的只读依赖里没有插件库根）。
- 界面：`/` 菜单与上下文浮窗技能块列出插件技能（第二行「插件「X」 · 什么时候用」；面板里插件技能不可点、带「插件 X」小标）；`skill.read` 读过的技能标「这一轮用了」；「这一轮读了」把插件技能记成不可点的「插件「X」/<路径>」；思考过程里叫「读技能 名字（插件 X）」。
- 验证：
  - 引擎新测试 `loop/pluginSkills.test.ts` 15 条；`catalog.test.ts` 与 Python 预言机比对的三项先滤掉 `skill.read` 再比、另钉「只多了 `skill.read`」；工作者三处变异（总是交出 `skill_read`、去掉插件指纹核对、去掉重名丢弃）均被抓住、已还原。整套引擎 14061 passed + 2 skipped。
  - **golden 零改动**：`git status --short packages/engine/golden` 与 `git diff --stat packages/engine/golden` 都为空。
  - 前端：`context-panel.test.ts` +3、`context-panel-view.test.tsx` +1、`composer-skill-commands.test.tsx` +1、`engine-agent-deps.test.ts`（工具数 28→29、插件库根传到运行时）；整套前端 2535 passed。
  - `pnpm verify` EXIT=0：project-core 34、引擎 14061 passed + 2 skipped、前端 2535 passed、三个浏览器回归通过。
  - 行尾：改动文件全 LF；`--numstat` 与 `--ignore-all-space --numstat` 只在 `ContextPanel.tsx`、`context-panel.ts` 各差 2 行（代码挪进新的嵌套多一层缩进），两文件均无 CRLF。
- 合并 master（#527 #528 #529，无冲突）后 `pnpm verify` EXIT=0：project-core 34、引擎 14061 passed + 2 skipped、前端 2537 passed、三个浏览器回归通过。
- 未覆盖：
  - 没有真宿主点穿（`plugin_library_dir` → 引擎读插件 → 模型调 `skill_read`）；没用真模型验证模型会不会按目录去读插件技能。
  - 作品还没有界面入口启用插件（下一刀）。
