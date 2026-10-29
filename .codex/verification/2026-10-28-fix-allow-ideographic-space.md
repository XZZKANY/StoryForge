## 2026-10-28 编辑器不再给全角空格加黄框（试用问题 #23）

- 改动：
  - 问题：作者 10-28 截图，大纲里「### 第6章　第一次冲关」的章号与章名之间有个黄色方框，问是什么意思。
  - 只读核对作者作品 `大纲/总纲.md`：黄框处是全角空格 U+3000（IDEOGRAPHIC SPACE），全文 100 个。
  - 原因：编辑器的 `unicodeHighlight.invisibleCharacters` 开着（用来标出零宽字符这类看不见的东西），Monaco 把全角空格也算进去了。中文排版里全角空格很常见（标题间隔、段首缩进）。
  - 做法（`components/editor/options.ts`）：在 `allowedCharacters` 里只放行 U+3000，其他看不见的字符照样标出。源码里用 `String.fromCharCode(0x3000)` 生成，不直接写这个字符。读了 Monaco 0.52.2 的 `unicodeTextModelHighlighter.js`：放行名单在「看不见字符」检查之前判断（:144）。
  - 同一分支另一提交：`packages/engine/src/loop/budgetCompaction.test.ts` 的「会话已超历史预算」一组放宽到 30 秒超时。这组造的是约 160 KB 的会话，单跑约 2.3 秒；首轮全量门禁在满载下超过默认 5 秒（5090ms）变红，单跑 6 条全过。照仓库里冷启动重测试的惯例放宽，测试逻辑不变。
- 验证：
  - `tests/editor-options.test.ts` 加断言：全角空格在放行名单里，零宽空格（U+200B）不在。14 passed。
  - `pnpm verify` 首轮 EXIT=1，原因是上面那条引擎测试满载超时；放宽后重跑 EXIT=0：引擎 13821 passed + 2 skipped，前端 2431 passed，三个浏览器回归通过。
- 未覆盖：没有在真宿主上看黄框是否消失（测试里的 Monaco 是替身）。
