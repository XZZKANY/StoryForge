# 验证报告 · dogfood 止血波1：刷新护栏 / 索引跳 .git / Monaco 对色 / 状态栏字数

时间：2026-07-18
分支：`fix/dogfood-wave1-20260718`
背景：2026-07-16 真机 dogfood 15 条问题清单（D:\记事本\todo.md）分析后拍板四波推进，
本刀是波1「止血包」——全部落在「安全可日更」主路径上。

## 问题与变更

### #10 装机 F5/Ctrl+R 整页刷新丢稿 + 壳子右键弹浏览器菜单（数据丢失隐患）

- 新增 `lib/browser-guards.ts`：capture 层拦 F5 / Ctrl+R / Ctrl+Shift+R 默认行为；
  window 层 `contextmenu` preventDefault（input/textarea/contenteditable 放行，
  Monaco 自带菜单自行 preventDefault 不受影响）。
- `main.tsx` 仅 `import.meta.env.PROD` 安装——dev 保留刷新与 devtools 工作流。
- Rust 侧 `AreBrowserAcceleratorKeysEnabled(false)` 更彻底的一刀（需引 webview2-com）
  未做，JS 层已覆盖数据丢失主通道。

### #1/#4 文件树「加载中」卡死 / 打开项目慢（连载工作区会随 .git 增长越来越卡）

- 根因：`fs.rs::list_dir` 递归 WalkDir 不跳任何目录，`.git` 对象库（连载工作区
  30 分钟一次自动 commit，只增不减）全树遍历后才返回；前端各调用方的 SKIP_DIR
  是拿到结果后的事后过滤，省不掉遍历开销。
- 修：`filter_entry` 截断 `.git` / `node_modules` 子树（`HEAVY_DIR_SKIP`，depth>0
  守卫防项目根本身被过滤）。**其余 dot 目录（.storyforge 等）保留**——S3 硬规矩下
  连载工作区的作者内容都在 dot 目录里。非递归分支保持原始列举语义不动。

### #9 编辑区背景与壳子色差（Monaco 内置 vs-dark #1e1e1e ≠ --background #1c1c1f）

- `lib/theme.ts` 新增 `ensureMonacoThemes`：defineTheme `storyforge-dark/light`
  （base vs-dark/vs），editor.background/foreground、行号、scrollbarSlider 对齐
  index.css token（hex 双处同步有注释红线）；vitest monaco stub 无 defineTheme，
  typeof 守卫静默跳过。`monacoThemeFor` / `currentMonacoTheme` 返回新主题名，
  `applyTheme` 懒加载路径先 ensure 再 setTheme。

### #6 行号对正文无用，缺字数统计

- `editor/options.ts::lineNumbersFor`：`.md/.markdown` 关行号（canon.json 等数据
  文件保留），创建与 updateOptions 两处接线。
- 新增 `lib/text-metrics.ts::countProseChars`（非空白字符、按码点计，网文口径）+
  事件桥 `EDITOR_TEXT_METRICS_EVENT`；Editor 在内容/选区/换模型时去抖 200ms 广播；
  StatusBar 监听显示「N 字 / 已选 M / N 字」。
- **stub 坑**：vitest 的 FakeEditor `onDidChangeModelContent` 是单监听槽，字数
  effect 守卫必须要求 onDidChangeCursorSelection/onDidChangeModel 整组存在才订阅，
  否则会把脏跟踪监听顶掉（代码内有注释）。

## 验证

- Rust：`cargo test fs::` 18 passed（新增 `recursive_list_dir_skips_heavy_dirs_but_keeps_dot_content`，
  断言 .git/node_modules 剔除、.storyforge 保留、非递归列举不隐藏）。
- 前端：vitest 全量 `54 files / 286 passed`（新增 browser-guards 5 例、
  text-metrics 2 例、status-word-count 1 例、editor-options lineNumbersFor 1 例）。
- typecheck 绿；`pnpm lint` 0 errors（仅 Editor.tsx 既有 exhaustive-deps warning，
  master 基线已存在）+ prettier 绿。
- `pnpm verify` 全量门禁见 PR。

## 红线审计

- 后端零改动、OpenAPI 零漂移；写回红线不碰（只读索引路径与纯前端呈现）。
- 递归跳目录只收窄索引范围，不新增任何写路径；`.storyforge` 可见性保持。
- 暂存全部使用显式路径。

## 未验证项

- 真机观感归下次真机波：装机 exe 里 F5/Ctrl+R 实拦、右键菜单实抑、连载工作区
  文件树加载速度、编辑区与壳子同色观感、字数统计跟手感。
- 浏览器快捷键 Rust 侧一刀（AreBrowserAcceleratorKeysEnabled）与 Alt+←/→ 未拦，
  留待真机确认是否需要。
