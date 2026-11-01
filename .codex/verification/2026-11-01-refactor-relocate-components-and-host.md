## 2026-11-01 文件归位：components 顶层组件进各自文件夹，宿主封装集中到 lib/host，去掉组件里的再导出

从 `origin/refactor/chat-window-unify-tail`（`cb7c139e`，#592 未合）开分支，PR base 仍是 master。作者 11-01 定的「架构与组件统一」最后一刀：只挪文件（`git mv` 保留历史）、改路径与 import，不改逻辑。`packages/` 零改动。

- 改动：
  - 组件归位（9 个，按实际谁用它定）：
    - `ChatWindow.tsx` → `components/chat-window/`（对话窗口容器，只被 `app/AppShell` 用，组合的全是 chat-window 下的 hook）；`AgentStepsPanel.tsx` → 同目录（只被 `chat-window/panels.tsx` 用）。
    - `Editor.tsx` → `components/editor/`（编辑器容器，组合的全是 editor 下的 owner）；`PatchReviewPanel.tsx` → 同目录（只被 `Editor` 用）；`BranchCanvas.tsx` → 同目录（只被 `editor/VersionHistory.tsx` 用）。
    - `CommandPalette.tsx` → `components/command-palette/`（该目录已有它的 `palette-items` 与 `usePaletteCommands`）。
    - `SettingsView.tsx` → `components/settings/`（该目录全是它的分区）。
    - `StoryNavigator.tsx` → `components/shell/`（只被 `shell/SidePanel.tsx` 用）；`ResourceExplorer.tsx` → 同目录（只被 `StoryNavigator` 用）。
    - 挪完 `src/components/` 顶层没有 `.ts` / `.tsx`；目标目录都已存在，没有新增子目录，`LIVE_MODULE_ROOTS` 不用加。
  - 宿主封装集中到 `src/lib/host/`（12 个）：原白名单里的 11 个 `lib/` 顶层封装（`tauri-fs`、`host-close`、`host-window`、`plugin-library`、`shadow-git`、`native-delivery`、`app-update`、`book-cover`、`desktop-llm-config`、`tauri-env`、`update-check`），加上只被它们用的 `writeback-receipt-fixture.ts`（`tauri-fs` 在非 Tauri 运行时替宿主写回命令的浏览器替身，`src/` 里只有 `tauri-fs` 引它）。`lib/engine/` 的端口实现不动。
  - 核过没挪的：
    - `host-file-errors.ts`：除 `tauri-fs`、`writeback-receipt-fixture` 外，`lib/writeback-receipts.ts`、`components/app/useBookProfile.ts`、`components/editor/patch-review-text.ts` 也用它，且它自己的注释写明前端核出漂移时也抛 `DiskDriftError`——不是只被宿主封装用，留在 `lib/` 顶层。
    - `writeback-receipt-types.ts`：组件、`lib/project/knowledge-writeback.ts`、`suggestion-recovery`、`writeback-audit` 都直接用，同理不挪。
  - 去掉 `src/components` 下为少改 import 留的再导出（10 个文件 19 条语句），调用方改从真实位置取（29 个文件 31 条 import：src 9 个、测试 20 个）：
    - `chat-window/ChatWindow.tsx`：8 条（`agent-result` 5 个名字、`request-payload`、`recovery`、`review` 5 个、`resumed-result` 3 个、`panels` 的 `AgentRunRecoveryPanel`、`types` 的 `StableAgentRequestPayload`、`overview-activity` 3 个）。
    - `chat-window/panels.tsx`：`ConversationHeader`、`RunActionBar`（连同「仍从这里导出，调用方的引用路径不变」那行注释）。
    - `editor/PatchReviewPanel.tsx`：`buildPatchReviewTraceTitle`；`editor/Editor.tsx`：先 import 再 `export { EditorLoadStatus }`。
    - `editor/useSuggestionWriteback.ts`：`TRUNCATED_ACCEPT_CONFIRM_TIMEOUT_MS` 与 3 个类型；`chat-window/useRunAuthorAgent.ts`：类型 `RunAuthorAgent`；`chat-window/useWriteBatchScheduler.ts`：类型 `WriteBatchProgress` / `WriteBatchResult`；`app/useProjectCommands.ts`：类型 `BookBreakdownPreview`。
    - `app/AppShell.tsx` 的 `ObservatoryHandle`、`app/useBookOverviewChapters.ts` 的 `buildProjectChapterIndex` / `ProjectChapter`：没有任何调用方经它们取，直接删。
    - 保留：`components/ui/index.ts`（共享组件的公共入口）、`components/icons/shell-icons.tsx`（`lucide-react` 的唯一入口，`ui-primitives.test.tsx` 钉着）。`lib/` 里的再导出（如 `lib/project-context.ts`、`lib/host/tauri-fs.ts` 的 `FileEntry`）不在本刀范围。
  - 引用改法：脚本按旧布局解析每个以 `./` / `../` 开头的字符串（import、`vi.mock`、`vi.importActual`、动态 `import()`、`new URL` 经变量传入的路径），目标或所在文件挪了就按新布局重算，共 403 处；再把 `src/components/X`、`src/lib/X`、`lib/X` 这类 cwd / src 相对写法（`readFileSync`、守护清单、注释）换成新位置，22 处。另手改：`apps/desktop/scripts/release-build.test.mjs` 按段拼的 `lib` 目录加 `host`；`tests/ui-primitives.test.tsx` 设置 `<details>` 守护里单列的 `SettingsView.tsx` 去掉（已在 `sourceFiles('src/components/settings')` 里，再列会重复）。按字节替换、保留原行尾；改过的 src 与原本过 prettier 的测试文件跑了 prettier。
  - 文档：`src/STRUCTURE.md` 两条读法路径、Size Gates 改成「components 顶层不放源文件」、Ownership Boundaries 加一条 `lib/host/`；`CLAUDE.md` §3 布局补「src/lib/host 是界面调宿主的唯一入口」；`docs/operations/release-checklist.md` 的 `lib/app-update.ts`；`src-tauri/src/host_error.rs` 文档注释里的两个前端路径（只改注释）。`docs/archive/`、`.codex/` 旧记录、`docs/internal/write-batch-plan-2026-10.md`（钉在 `e31b6ab0` 的方案、自己写着行号会漂）属历史记录，不改。
  - 守护（`tests/source-standards.test.ts`）：
    - 新增「components 顶层没有源文件，组件都放在各自的文件夹里」；500 行门禁不再单算顶层文件；`HARD_LINE_LIMITS` 两条路径随文件挪、按目录归位排序。
    - 「只有白名单里的封装模块引 @tauri-apps」改成目录白名单 `HOST_GATEWAYS = ['src/lib/host/', 'src/lib/engine/']`：引 `@tauri-apps/` 的文件必须在这两个目录里；另断言两个目录各至少有一个文件引（防正则失效后空过）。逐文件的「不再调宿主了：从白名单去掉」随之去掉（`lib/host/writeback-receipt-fixture.ts` 本来就不引 `@tauri-apps`）。删掉「挪进 lib/host/ 待 #561 合后做」注释。
    - `@tauri-apps/plugin-dialog 只在 tauri-fs 里引` 的期望路径改为 `src/lib/host/tauri-fs.ts`。
- 验证：
  - 旧路径零残留：脚本扫全仓 git 跟踪的文本文件 1143 个（排除 `.codex/verification/`、`.codex/verification-report.md`、`docs/archive/`），四种写法——`components/<挪走的组件>`、`lib/<挪走的封装>`、解析不到的 `./<旧名>` / `../<旧名>`、按段拼的 `'<旧名>.ts(x)'`——命中 5 处，都不是残留：`STRUCTURE.md` 两处是正文里的裸文件名 `` `ChatWindow.tsx` `` / `` `Editor.tsx` ``，`release-build.test.mjs` 两处已按 `lib/host` 目录拼，`write-batch-plan-2026-10.md` 一处是历史方案。
  - 解析对照：改前改后各扫一遍 `src` / `tests` / `scripts` / `apps/desktop/scripts` / 根 `scripts` 里所有相对路径字符串（3199 → 3178 条），按「旧路径映射到新路径」逐条比对：除再导出改道、守护清单改成目录、`ui-primitives` 去掉重复项外解析目标一一对应；改后没有新增解析不到的路径（新增的 3 条是守护里的目录字符串 `src/components/editor`、`src/lib/host/`、`src/lib/engine/`）。
  - `vi.mock` 没有静默落空：测试里 `vi.mock(` 共 397 处，改前改后相同；能解析到仓库文件的 341 处，改前改后相同；其中指向 `lib/host/` 的 41 处（改前指向那 12 个旧路径的也是 41 处：`tauri-fs` 19、`desktop-llm-config` 9、`tauri-env` 6、`plugin-library` 3、`update-check` 3、`shadow-git` 1），指向挪走组件的 19 处（`Editor` 9、`ChatWindow` 6、`SettingsView` 4），改前改后相同。`vi.importActual` / 动态 `import()` 共 575 条（含 `vi.mock`）按目标逐条相同。
  - `pnpm lint`：EXIT=0，0 error，2 warning 都在 `tests/independent-claim-history.test.ts` 第 95 / 210 行（原有，本刀只改了它一行 import 路径），0 新 warning；prettier 全过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，274 个文件，2823 passed（改前同一起点 274 / 2822，多的 1 条是新守护）。之后又对 8 个测试文件跑了 prettier（只动换行），连同两条守护所在文件单跑 10 个文件 123 passed。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14275 passed / 2 skipped；`packages/` 零改动，golden 零变化。
  - `node --test apps/desktop/scripts/release-build.test.mjs`：EXIT=0，7 passed（读 `lib/host` 下的 `update-check.ts` / `app-update.ts`）。
  - 变异验证（单跑 `tests/source-standards.test.ts`）：

| 打在哪 | 变异后 | 还原后 |
| --- | --- | --- |
| 新建 `src/components/Stray.tsx`（`export const stray = 1;`） | 红 1 条（components 顶层守护，报 `src/components/Stray.tsx`） | 删掉文件，16 passed |
| `src/components/shell/Titlebar.tsx` 开头加 `import '@tauri-apps/api/core';` | 红 1 条（宿主入口守护，报 `src/components/shell/Titlebar.tsx`） | 定点删掉那一行，`git hash-object` 与变异前相同，16 passed |

  - 行尾：237 个改动（21 个改名 + 216 个修改）逐个对比改前改后，原 CRLF 的仍 CRLF、原 LF 的仍 LF，无 CRCRLF。`git diff -M --numstat` 与 `--ignore-all-space --numstat` 完全相同（505 / 557）。
- 未覆盖：
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI `Windows Verify` 的 `pnpm verify` 为准；行间续写回归的 `scripts/fixtures/inline-continuation.jsx` 与 Agent 实跑探针 `scripts/fixtures/engine-p3-agent-real.ts` 里的 `tauri-fs` 路径已改，前者靠 CI 验，后者要花钱、没跑。
  - 没跑 Rust 测试与 Tauri 冒烟：Rust 只改了 `host_error.rs` 的一行文档注释；没打包、没在装机版上点。

## 2026-11-01 并入 master（#590 / #591），让 PR 能在 CI 上跑

本分支起点之后 master 合了 #590（文件树路径分隔符）与 #591（TODO），试合并有 2 处冲突，PR 会因此跑不了 CI，所以把 `origin/master`（`b3537706`）并进来。#592 本身与 master 无冲突。

- 改动：两处冲突都是 #590 在 import 区加了行、本刀把相邻的 `tauri-fs` 路径改了：`src/lib/project/tree.ts` 保留 master 新加的 `joinPath` import、`FileEntry` 改从 `../host/tauri-fs` 取；`tests/pending-new-file-tabs.test.tsx` 保留 master 新加的两行 import、`TauriFileSystem` 改从 `../src/lib/host/tauri-fs` 取。两文件仍是 LF。其余（含 `source-standards.test.ts` 末尾 #590 新加的 `${a}/${b}` 守护，豁免路径都不在挪走的文件里）自动合并。
- 验证：
  - 合并后重跑旧路径残留扫描：结果同上（5 处，都不是残留）；相对路径解析：没有新增解析不到的路径（#590 改过的测试里没有新写挪走文件的旧路径）。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。`pnpm lint`：EXIT=0，仍是那 2 条原有 warning，prettier 全过。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，274 个文件，2833 passed（多出的 10 条是 #590 带来的测试）。
- 未覆盖：同上一节。#592 合并前，本 PR 的改动列表里会带着 #592 的两个提交。
