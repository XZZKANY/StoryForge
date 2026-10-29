## 2026-10-29 参考上下文「已截断」按原因拆开，手动补入与自动选择同一口径（关联 #504）

- 改动：
  - 原因：参考上下文只亮一个「已截断」，作者看不出是份数挤掉了还是读不出来；手动补入的正文取开头（自动选择取结尾）、空文件照样加入、补读成功的旧「未读到」不消失；界面上限写死 12，引擎只用前 8 份。作者 10-29 拍板了范围：统一上限、按原因拆开、分类计数标明口径、标题照实写；「下次优先参考」按钮与逐文件详情不做。
  - `components/chat-window/context-files.ts`：补入改用 `excerptForContext`（按文件类别，正文取结尾、其他取开头，上限 1200）；去掉空白后为空的不加入、计入读取失败；读不出的计入读取失败并留在「未读到」；旧「未读到」里这次补读成功的（按同一规范化相对路径比对）去掉；上限改用引擎 `MAX_CONTEXT_FILES`，补入的排前，挤掉的计入超出席位。没有补入时也走同一条收尾（返回的 `missingPaths` 统一为合并去重后的列表）。
  - 份数上限 `MAX_CONTEXT_FILES` 的定义挪到 `packages/project-core`，引擎和界面都从那里取（见下方返工）；`lib/project/context-bundle.ts` 的默认 `maxFiles` 也改用它（原来写死 8，值不变）。
  - 自动选择：`selectContextBundleFiles` 多返回 `overflowCount`；`collectContextBundle` 记 `overflowCount` 与 `unreadableCount`（选中但读不出或摘录为空）。`truncated` 的置位条件不变，仍照旧发给引擎。
  - `ContextBundleBudget` 加两个可选字段 `overflowCount` / `unreadableCount`，只留在界面：`lib/api/codecs.ts` 按白名单逐字段映射，没动，引擎收到的形状不变；`contracts.ts` 没动。
  - `display-utils.ts` 新增 `contextCoverageWarnings`：分别给出「超出席位 N」「读取失败 N」，都是 0 不出；只有 `truncated` 没有细分的旧数据显示「已截断（原因未记录）」，不编数字。单份文件只送摘录不算警告。`contextBudgetText` 用它，分类计数前加「项目里：」。
  - `panels.tsx`：徽标按原因各出一个（同一 testid）；文件列表上方加一行「本轮参考资料（发送前选入，工具另读的不在此列）」，列表 aria-label 同步改名。文件从 976 行到 983 行（冻结豁免文件，没有行数门）。
- 验证：
  - 新增 `tests/context-files.test.ts` 7 条：正文补入取结尾、设定补入取开头且 1200 字、空内容不加入且计入读取失败、读不出计入读取失败并留在未读到、补读成功后从未读到去掉（含反斜杠写法）、上限等于引擎常量且补入排前挤掉的计入超出席位、自动选择分开记两类计数。
  - `chat-ux-polish.test.tsx`：旧数据徽标文字为「已截断（原因未记录）」；新增一条覆盖 `contextBudgetText` 只送摘录无警告、两类都有、只有读取失败、旧数据退回，以及面板无警告不渲染、两类各一个徽标。`conversation-starters.test.tsx`：旧数据徽标文字、标题说明与「项目里：」、无警告无徽标、两类徽标顺序。
  - `npx vitest run tests/chat-ux-polish.test.tsx tests/conversation-starters.test.tsx tests/context-files.test.ts tests/source-standards.test.ts`：4 个文件 38 passed（加自动选择那条前）；`context-files.test.ts` 加后 7 passed。
  - 变异（脚本逐个打一处、跑上面三个测试文件、备份字节无条件还原并断言还原一致，没用 git checkout / stash），7 处全红：补入仍用 `content.trim().slice(0, 1200)`；旧未读到不去掉；上限写回 12；空内容不计读取失败；自动选择读取失败恒为 0；去掉旧数据退回；去掉「项目里：」。
  - 行尾：`panels.tsx`、两个既有测试是 CRLF，改后仍全 CRLF；其余 LF 不变。`git diff --numstat` 与 `--ignore-all-space --numstat` 逐文件一致。
  - `pnpm verify` EXIT=0：lint 与前端类型检查通过；project-core 14 passed；引擎 99 个文件 13934 passed + 2 skipped；前端 250 个文件 2516 passed；行间续写、浏览器冒烟、Agent 对话三个浏览器回归通过。
- 未覆盖：
  - 没在真机看面板观感（徽标多一个时折叠头的挤压、说明行的位置）；没跑 Tauri 冒烟与真宿主探针。
  - 补入时读不出的文件同时出现在「未读到：…」和「读取失败 N」里，两处说的是同一件事的不同面（哪份、几份）。
  - 引擎还有一个 `MAX_PROMPT_CONTEXT_FILES = 12`（prompt 投影的预算），本刀按拍板对齐的是请求上下文实际截取用的 `MAX_CONTEXT_FILES = 8`。

## 2026-10-29 返工：上限常量挪到 project-core

- 原因：初版让界面经 `lib/api/context-limits.ts` 从 `@storyforge/engine` 桶静态导入常量，`lib/project/context-bundle.ts` 又静态导入它，于是大量前端测试文件一加载就拉进整个引擎。编排者复核时实测：前端整套 `npx vitest run` 在本分支稳定红 1 条（`tests/suggestion-writeback-lifecycle.test.tsx` 的 `unmount during audit retains original delivery for cold recovery: interrupted`，toast 1!==0），pre-push 的 `node scripts/fast-tests.mjs` 连红两次；master 上同样跑是绿的；把 `context-limits.ts` 临时换成 `export const MAX_CONTEXT_FILES = 8;` 后整套 2516 全绿（已字节还原）。初版记录里写的 `pnpm verify` EXIT=0 是真的，但那一轮没撞上这条。
- 改动：新增 `packages/project-core/src/contextLimits.ts` 定义 `MAX_CONTEXT_FILES = 8` 并从 `index.ts` 导出；引擎 `kernel/contextValues.ts` 改为从 `@storyforge/project-core` 引入并照旧导出（引擎其余用法与 golden 不变）；前端 `context-bundle.ts` 与 `context-files.ts` 直接从 `@storyforge/project-core` 取；删掉 `lib/api/context-limits.ts`，撤回引擎 `src/index.ts` 的导出（与 master 无差异）。`context-files.test.ts` 改从 project-core 取常量，另加一条断言它与引擎 `kernel/contextValues.ts` 的值相等。
- 验证：
  - 前端整套 `npx vitest run`：Test Files 250 passed，Tests 2516 passed。
  - `node scripts/fast-tests.mjs`：前端 2516 passed，引擎 13934 passed + 2 skipped，EXIT=0。
  - `pnpm verify` EXIT=0：project-core 14 passed；引擎 99 个文件 13934 passed + 2 skipped；前端 250 个文件 2516 passed；三个浏览器回归通过。
