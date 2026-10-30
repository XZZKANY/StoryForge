## 2026-10-30 事实待定测试先在 beforeAll 里加载引擎，满载时不再超 5 秒

- 问题：`apps/desktop/frontend/tests/fact-dispute-engine.test.ts` 在前端全套 vitest 满载时会超时（`Test timed out in 5000ms`），两条测试都中过招；master（`2269b25a`）满载复跑同样红（5028ms），单跑绿。会让 `pnpm verify` 的「Desktop frontend 单元测试」门随机红。
- 根因：测试体里的 `await import('../src/lib/api/facts')` 本身很轻（`api/facts.ts` 没有静态导入）；重的是 `resolveLedgerDispute` 第一次被调用时才动态加载的 `../engine/facts`，它静态导入整个 `@storyforge/engine` 包和 `lib/engine` 下的 agent / assistant / llm / store，冷转译全记在第一条用例的 5 秒里。第二条也中过招，推测是第一条超时后它等的是同一个还没加载完的模块。
- 改动（只动这一个测试文件，不改被测代码、不改断言）：照仓库已有做法（`chapter-checks-engine.test.ts`、`assistant-sessions-engine.test.ts` 等用 `beforeAll` + `60_000` 预先加载引擎），加 `beforeAll(async () => { await import('../src/lib/engine/facts'); }, 60_000)`。`vi.hoisted` / `vi.mock` 仍在文件顶部、会被提升到所有导入之前，`beforeAll` 在收集完用例之后才跑，预先加载的 `engine/facts` 拿到的仍是被替身换掉的 `reader` 与 `@tauri-apps/api/app`；测试文件不重置模块，两条用例里的动态导入都命中缓存。
- 验证：
  - 改前单跑 `npm --prefix apps/desktop/frontend run test -- tests/fact-dispute-engine.test.ts --reporter=verbose`：刚装完依赖的冷缓存（transform 6.67s）1 failed（首条 5000ms 超时）；热缓存两遍首条 2834ms / 3000ms、第二条 2ms。
  - 改后同命令：冷缓存（transform 6.49s）2 passed，首条 26ms；热缓存 2 passed，首条 20ms、第二条 2ms。
  - 前端全套 `npm --prefix apps/desktop/frontend run test` 连跑两遍：两遍都是 250 个文件、2523 passed，EXIT=0。
  - `pnpm verify`（PATH 上没有 pnpm，用 corepack 缓存的 pnpm 9.15.4 做临时 shim）：
    - 第一、二遍：前端单测门都绿（2523 passed），但后面的「行间续写真实 Monaco 回归」红：`page.screenshot: Timeout 30000ms exceeded`（waiting for fonts to load）。这次截图是脚本 `catch` 里的失败截图，原始错误被它盖掉了。当时同机另一会话正在主检出跑 `test:fast` 与引擎 vitest，另有一个 `npm ci`，空闲内存约 2.6 GB。单跑 `npm --prefix apps/desktop/frontend run verify:inline-continuation` EXIT=0。该回归不加载本次改的测试文件；同一回归满载超时在 `2026-10-29-fix-writeback-on-disk-519.md` 里也记过。
    - 等另一会话的测试进程全部结束后第三遍：EXIT=0。lint、前端类型检查、project-core 14 passed、引擎 14013 passed + 2 skipped、前端 2523 passed、三个浏览器回归通过。
  - 行尾：文件纯 LF（103 行 LF、0 CRLF）；`git diff --numstat` 与 `--ignore-all-space --numstat` 都是 6 增 1 删。
- 未覆盖：
  - 没在 master 上用同样满载复跑做改前对照，「改前满载 5028ms 红」用的是开题时在 `2269b25a` 上的观察。
  - 没做变异：只加预先加载，断言一行没动。
  - 「行间续写」浏览器回归满载时会超时、且失败截图会盖掉原始错误，本次没处理（不在范围）。
  - 没改宿主，没跑 Rust 测试与 Tauri 冒烟。
