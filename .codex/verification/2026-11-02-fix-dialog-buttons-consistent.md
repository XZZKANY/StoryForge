## 2026-11-02 确认框：删改类主按钮用实心红、三选一的删改选项单独靠左、命令面板去掉 Mac 符号

从 `master`（`aed79dd5`）开分支。

起因是作者 11-02 说「弹窗感觉没做好」，并点名确认框也算在内。我用隔离调试宿主和示例作品，把删除、重命名、关标签未保存、命令面板、设置几种居中弹窗都弹了一遍截图。遮罩实测是 50% 黑，位置也居中，问题出在按钮和文案：

1. **主按钮各长各的**：
   - 重命名框的主按钮是实心深色；
   - 删除框的「删除」只是红色描边，和「取消」一样轻，看不出回车会做什么；
   - 未保存框是实心深色加红描边，「放弃修改」紧挨着「保存并关闭文件」。
2. **未保存框的文案重复**：标题「有未保存修改」，正文又是「第003章.md 有未保存修改。」。
3. **命令面板在 Windows 上用 Mac 符号**：输入框前是 ⌘ 图标；同一面板里快捷键一会儿写「Ctrl ⇧ P」，一会儿写「Ctrl Shift H」。

- 改动：
  - 新增按钮变体 `danger-solid`（实心红），以及颜色变量 `--error-foreground`：
    - 深色主题的红偏浅，配深字（5.04:1）；浅色主题配白字（5.15:1）。都过 AA，做法和紫色按钮一致。
    - `tone: 'danger'` 的确认框主按钮改用它。
  - 三选一框：删改类选项（`tone: 'danger'`）放进最左边单独一组（`mr-auto`），仍用描边红。它排在 DOM 最前，所以 Tab 顺序和看到的一致。我一开始用的是 CSS `order`，发现会让 Tab 顺序和视觉不一致，改掉了。
  - 未保存三选一框的文案改成：标题「「第003章.md」还没保存」，正文「关闭文件前要先保存吗？」（「关闭文件」随调用方的 actionLabel 变）。
  - 命令面板：
    - ⌘ 图标换成 `ChevronRight`（>），「Ctrl ⇧ P」改为「Ctrl Shift P」；
    - `Command` 图标不再有人用，从 `shell-icons` 的导入导出里删掉。
- 验证：
  - 截图前后对照（`output/readme-shots/shots-popups/`，不入库）：
    - 改前：`07-confirm-delete.png`、`21-unsaved-close.png`、`22-command-palette.png`；
    - 改后：`43-dialogs-after-sheet.png`（浅色）、`44-after-delete-dark.png`（深色红底深字）。
  - 新增和改动的测试：
    - `app-dialog.test.tsx` 1 条：删改确认用 `danger-solid`；三选一按钮顺序为「放弃修改 / 继续编辑 / 保存并关闭文件」，且放弃修改在靠左的那一组里。
    - `command-palette.test.tsx` 1 条：有「Ctrl Shift P」，没有 ⇧ 和 lucide-command。
    - `accessibility-guards.test.ts`：双主题下 `--error-foreground` 对 `--error` ≥ 4.5。
    - `ui-primitives.test.tsx`：变体清单加 `danger-solid`。
    - `close-dirty-file.test.tsx`：记录的调用多带 title，断言改成新文案。
    - `surface-hierarchy.test.tsx`：浅色主题颜色变量快照登记 `--error-foreground`。第一次跑门禁时这条红了，是漏登记。
  - 变异验证：5 处，每处至少红 1 条。用脚本定点替换（断言恰好出现 1 次），在 `finally` 里还原；还原后 `git diff --numstat` 与变异前一致。
    - 确认框不用实心红：红 1；
    - 删改选项不单独靠左：红 2；
    - 深色主题实心红配白字：红 1；
    - 没写 `danger-solid` 样式：红 1；
    - 命令面板写回 ⇧：红 1。
  - 定向：上述 5 个测试文件 61 passed；前端 `tsc --noEmit` EXIT=0。
  - `pnpm verify`：EXIT=0，8 道门全过。
    - project-core 48；
    - TS 引擎 14325 passed、2 skipped；
    - 前端 2842 passed；
    - 行间续写真实 Monaco 回归、浏览器冒烟、Agent 对话浏览器回归均通过。
- 未覆盖：
  - 没在作者装机版上看。
  - 其余用 `tone: 'danger'` 的确认框（删除会话、删除模型配置、删插件、恢复版本等）共用同一个外壳，会一起变成实心红，但没有逐个截图。
  - 下拉菜单 / 浮层越出所在栏的问题另开分支。
