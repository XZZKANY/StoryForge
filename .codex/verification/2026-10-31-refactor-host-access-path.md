## 2026-10-31 前端调宿主只经 lib 里的封装模块；窗口事件名只走常量

开分支时 #574（设置行、菜单项、左栏分区）还没合，按约定从 `origin/refactor/ui-rows-and-sections`（`55d922d7`）开；PR base 仍是 master。#561 在改的十二个 chat-window 文件和七个测试文件一个没动；本刀也不挪任何模块的路径（挪进 `lib/host/` 等 #561 合后做）。

- 改动：
  - 组件里直接引 `@tauri-apps` 的 5 个文件改成调 `lib/` 里的封装，行为不变（对话框参数、事件名、报错文案、取消监听时机都照旧）：

    | 原来直接调宿主 | 现在调 | 封装放哪 |
    | --- | --- | --- |
    | `components/app/useNewProject.ts`：`plugin-dialog` 选保存位置 | `pickDirectory('选择作品保存位置')` | `lib/tauri-fs.ts` 新增 `pickDirectory` |
    | `components/app/useProjectCommands.ts`：两处 `plugin-dialog` 选作品文件夹 / 示例作品保存位置 | `pickDirectory(...)` | 同上 |
    | `components/settings/usePlugins.ts`：`plugin-dialog` 选插件文件夹 / .zip | `pickDirectory` / `pickFile` | `lib/tauri-fs.ts` 新增 `pickFile` |
    | `components/app/useTauriMenuBridge.ts`：动态引 `@tauri-apps/api/event` 的 `listen`（连类型） | `loadHostEventListen()`、`HostEventListen` | `lib/tauri-env.ts` 新增；「加载失败」「注册失败」两段报错照旧分开 |
    | `components/shell/Titlebar.tsx`：`@tauri-apps/api/window` 窗控（拖动 / 最小化 / 最大化 / 关闭） | `runWindowAction` 整段原样搬出 | 新建 `lib/host-window.ts` |

  - 另有一处不在 components 下、但也不在封装里：`lib/project/initialize.ts` 的「发送即开书」直接引 `@tauri-apps/api/path` 取文档目录，改成调 `lib/tauri-env.ts` 新增的 `documentDirectory()`。
  - 为什么新建 `lib/host-window.ts`：窗控不属于现有任何封装的领域；`tauri-env.ts` 在 6 个测试里被整体工厂 mock（只给 `isTauriRuntime`），放进去会让 `titlebar-drag` 测试拿不到函数、也让内部的运行时判断绕过 mock。选文件 / 文件夹放 `tauri-fs.ts`（文件系统对话框）；事件通道和文档目录放 `tauri-env.ts`（宿主运行环境），文件头注释相应改成中文说明这三件事。
  - 守护测试并进 `tests/source-standards.test.ts`：
    1. `@tauri-apps/` 只许出现在白名单 20 个文件里：`lib/engine/` 下 9 个（agent / assistant / crossChapter / db / facts / ideCommands / llm / reader / writer）+ `lib/` 顶层 11 个（app-update / book-cover / desktop-llm-config / host-close / host-window / native-delivery / plugin-library / shadow-git / tauri-env / tauri-fs / update-check）。白名单与实际双向核对（不再调宿主的要从白名单去掉）。`main.tsx` 不引宿主，没列。
    2. 窗口事件名：每个 `*_EVENT = 'storyforge:…'` 必须是 `export const`，常量名、事件名全局不重名；已定义的事件名在定义处以外不许再以字符串出现；`dispatchEvent` / `addEventListener` / `removeEventListener` / `new CustomEvent(<…>)` 的第一个参数不许直接写 `'storyforge:…'`。localStorage 键（也以 `storyforge:` 开头）不在扫描范围内。
  - 窗口事件名字面量：`src/` 里 25 个频道早已全部经常量派发 / 监听，**改了 0 处**；禁碰文件里也没有，不需要豁免。
- 验证：
  - `pnpm lint`：EXIT=0，0 error，2 warning 都在没动过的 `tests/independent-claim-history.test.ts`（原有），本刀 0 新 warning；prettier 全过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `pnpm --filter @storyforge/engine test`：EXIT=0，111 个文件，14267 passed / 2 skipped；golden 零变化（`git diff --stat -- packages/engine/golden` 为空）。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，271 个文件，2770 passed。
  - 变异验证（脚本打变异 → 单跑 `tests/source-standards.test.ts` → 按字节无条件还原，还原后复核字节相同）：
    - `usePlugins.ts` 加一行 `import { invoke } from '@tauri-apps/api/core'` → 宿主白名单那条红 1 条，报出该文件。
    - `toast.ts` 派发处把 `TOAST_EVENT` 换成 `'storyforge:toast'` → 事件名那条红，报 `src/lib/toast.ts: storyforge:toast`。
    - `write-batch-tabs.ts` 的事件名改成 `'storyforge:toast'` → 红，报重名 `storyforge:toast`。
    - `plugin-events.ts` 去掉 `export` → 红，报该文件不是 `export const`。
    - `assistant-events.ts` 多行 `new CustomEvent<FileSuggestionTarget | undefined>(` 的参数换成未定义的 `'storyforge:brand-new'`、`useProjectCommands.ts` 的 `addEventListener` 同样换 → 各红 1 条。
    - 全部还原后单跑 9 passed。
  - 行尾：`Titlebar.tsx`、`tauri-fs.ts` 原为 CRLF，按字节改、改后仍全 CRLF；其余改动文件与新文件为 LF。`git diff --numstat` 与 `--ignore-all-space --numstat` 逐文件一致。
- 未覆盖：
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI 为准。
  - Rust 没动，没跑 Rust 测试与 Tauri 冒烟；选文件夹 / 插件导入 / 窗控 / 冒烟复位事件 / 发送即开书取文档目录都没在真宿主上点过，只有 vitest（含对 `plugin-dialog` `open` 参数的断言）覆盖。
  - `book-cover.ts` 选封面图片仍自己调 `plugin-dialog`，没改成 `pickFile`（它本身是白名单里的封装，不在本刀范围）；`host-close.ts` 里两个宿主事件名 `storyforge:host-closing` / `storyforge:close-requested` 是 Tauri 宿主事件（与 Rust 对名），不是窗口事件，没纳入事件名守护。
