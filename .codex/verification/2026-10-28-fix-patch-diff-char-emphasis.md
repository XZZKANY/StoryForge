## 2026-10-28 AI 修订对比只把真正改了的字标深色（试用问题 #12）

- 改动：
  - 问题：作者 10-27 反映修改对比里同一段改了几个字，整段都是红底删、绿底加，看不出改了哪几个字。作者 10-28 拍板「保持上下对照，只标改动的字」。
  - 原因：对比区是 Monaco 自带的内联 diff（`PatchReviewPanel` 的 `createDiffEditor`，`renderSideBySide:false`）。Monaco 本来就按字算出了改动：同一行有改动时，`diffEditorDecorations.js` 给 innerChanges 挂 `char-insert` / `char-delete`。但它默认的整行底色和改动字底色深浅相近，中文整段看着是一个色。
  - 做法：对比容器加 `sf-patch-diff` 类；`src/index.css` 加四条规则，整行 `line-insert` / `line-delete` 压到 0.06，改动字 `char-insert` / `char-delete` 用 0.32 / 0.3，与行间修订（Ctrl+K）的句内高亮同一套深浅。选择器优先级 0,3,0，压过 Monaco 的 0,2,0。整段新增 / 删除的行本来就挂着 `char-*`，仍是整行深色。没有写新的 diff 函数。
- 验证：
  - `tests/patch-review-panel.test.tsx` 新增 1 例：对比容器带 `sf-patch-diff`；读 `src/index.css`，断言四条规则存在，且整行透明度低于改动字的三分之一。26 passed。
  - 首版测试的正则写在普通模板字符串里，写入时反斜杠被吃掉一半，`\s` 变成字母 `s`，断言失败；改用 `String.raw` 后通过。
  - 读了 Monaco 0.52.2 源码，确认内联模式下同一行的改动会挂字级装饰。
  - `pnpm verify` EXIT=0：引擎 93 files / 13818 passed + 2 skipped，前端 241 files / 2419 passed，三个浏览器回归通过。首轮门禁跑着时我在同一工作区开始改下一刀（同一个文件），那轮作废；把下一刀另存、工作区恢复成只含本刀改动后重跑，结果即此。
- 未覆盖：
  - 没有在真宿主上截图看观感（测试环境里的 Monaco 是替身，不渲染 diff）。
  - 深浅数值照行间修订取的，没有在作者的浅色暖色主题下单独调。
