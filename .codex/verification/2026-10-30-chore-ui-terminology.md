## 2026-10-30 界面用词统一：作品 / AI / 修订

- 改动：作者 10-30 定下界面用词——书叫「作品」（目录叫「作品文件夹」）、帮写的叫「AI」、AI 给出等接受的改动叫「修订」。前端 `src` 里含中文的字符串与 JSX 文字中「项目 / Agent / 补丁」共 150 处改掉（49 个文件，只动字符串，不动标识符；用 TypeScript AST 定位节点后替换，先短语后通用词，例如「项目目录」→「作品文件夹」、「哪个项目」→「哪部作品」、「等待修改确认」→「等待修订确认」）。`CONTEXT.md` 加「界面用词」表；新增 `tests/ui-terminology.test.ts`，含中文的字符串里再出现这三个词就红。`src/lib/writeback-receipt-fixture.ts` 照抄 Rust 宿主原话「写回目标不在当前项目内」，这次不改，测试里列为例外。
- 验证：
  - 改完先跑前端全套：19 个文件 25 条失败，全是断言旧文案；逐条定点改 26 处断言（`fix-tests` 脚本，每条核次数），测试标题不改；用改掉的每句原文在 `tests/` 里搜过，把会因改名而永远通过的反向断言（`not.toContain('当前项目还没有可选')`）也改成新说法。单跑这 20 个文件：232 passed。
  - 变异验证：把 `src/components/ChatWindow.tsx` 的「AI 正忙，请稍后重试」改回「Agent 正忙…」，守护测试红 1 条并指出 `ChatWindow.tsx:160`；用核次数的定点替换还原，复跑绿。
  - 行尾：`git diff --numstat` 与 `--ignore-all-space --numstat` 一致；`CONTEXT.md` 按字节插入，CRLF 53 行、无裸 LF / CRCRLF。
  - `pnpm verify` 跑了两次，都是 EXIT=1，都只卡在「Desktop frontend 单元测试」里 `tests/fact-dispute-engine.test.ts` 一条 5 秒超时（5028ms / 5014ms），其余 2523 passed；lint、前端类型检查、project-core（14 passed）、引擎（14013 passed、2 skipped）都过了。
  - 定性：这条超时 master 上原来就有。把本分支提交后在同一工作区切到 `origin/master`（2269b25a），同样满载跑前端全套，同一条照样超时（5028ms）。单跑这个文件是绿的（2 passed，两条合计约 4 秒）；本分支第一次全量时它也是绿的。原因是测试体内动态加载 `lib/api/facts` 要转译整套引擎，计入单条 5 秒。跟这次改名无关，已另记待修。
  - verify 停在第一处失败，后面三条浏览器回归单独跑：`verify:smoke` EXIT=0、`verify:agent-conversation` EXIT=0；`verify:inline-continuation` 第一次在 `page.goto` 30 秒超时（冷启动 Vite 预构建依赖，还没进页面），重跑 EXIT=0。
- 未覆盖：
  - 没在真宿主上看改后的界面（只有 happy-dom 单测与浏览器回归）。
  - 引擎喂给模型的提示词、工具说明与工具反馈仍说「补丁 / 写盘 / diff」（约 60 句、20 个文件，牵动 18 份 golden），模型回话会照着说；Rust 宿主报错约 107 句含「项目 / 补丁 / Agent」。都没动。
  - 「写回 / 写盘 / 落盘」「diff / 对比」「手稿 / 稿子 / 正文」作者还没定，没动。
