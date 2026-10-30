## 2026-10-30 文件树预览行去掉虚线框

- 改动：作者觉得文件树里预览文件（单击打开、可被覆盖的那一行）外面的虚线框太扎眼。`ResourceExplorer.tsx` 与 `StoryNavigator.tsx` 两处预览行样式去掉 `outline-dashed outline-1 -outline-offset-1 outline-border-strong`，保留斜体与浅底色作为预览标记；编辑器页签的预览斜体不动。只改样式类名，不动预览逻辑。
- 验证：
  - `pnpm verify` 全量跑一次：lint、前端类型检查、project-core、TS 引擎（103 文件 14013 passed / 2 skipped）、前端单测（250 文件 2523 passed）五道通过；第六道行间续写浏览器回归在 `page.screenshot` 处超时（等字体加载 30s，紧接整套 vitest 之后机器满载）。
  - 单独重跑剩下三道浏览器回归：`verify:inline-continuation` EXIT=0（5 条结果 passed）、`verify:smoke` EXIT=0、`verify:agent-conversation` EXIT=0。
  - `grep -rn outline-dashed apps/desktop/frontend/src` 无结果；`git diff --numstat` 与 `--ignore-all-space --numstat` 一致（各 1/1），行尾未变。
- 未覆盖：没在真宿主或装机版里看实际观感；没跑 Rust 测试与 Tauri 冒烟（未动宿主）。未打包，作者要等下一版安装包才看得到。
