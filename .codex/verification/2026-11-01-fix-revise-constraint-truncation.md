## 2026-11-01 硬约束不再截在第 20 个字，「章纲已准备」不再出「。。」

- 改动：
  - `kernel/reviseScope.ts`：从修订指令里抽「保留 / 不动 / 不要改 / 别改」硬约束时，原来最多取 20 个字，作者用顿号列的一长串会被截在半个词上，再当「硬约束（必须遵守）」发给模型。改成只在标点处断、不限字数。
  - `loop/chapterWritingPipeline.ts`：「章纲已准备：<本章目标>。」在目标已经以句末标点结尾时不再补句号。
  - 两处都是 10-31 实验书对话复盘里查到的（复盘报告在工作区 `output/drift-check/`，含作者正文，不入库）。
- 验证：
  - `npx vitest run src/kernel/review.test.ts src/loop/chapterWriting.test.ts`（packages/engine）：303 passed。新增 3 条：长列项不截断、仍在下一个标点处断、目标自带句号时摘要只有一个句号。
  - 变异：把正则改回 `{1,20}`、把句号改回无条件追加，新增的 2 条对应测试红（2 failed | 301 passed）；用带 `count == 1` 断言的定点替换还原，diff 与还原前一致。
  - golden 无需更新：golden 里的约束都短于 20 字，章纲目标都不带句末标点，输出不变（golden 回放全绿）。
  - `pnpm verify`：EXIT=0。引擎 14274 passed | 2 skipped，前端 2816 passed，三个浏览器回归通过。
- 未覆盖：没在真模型、真宿主上验；没改 Rust 宿主与引擎和宿主之间的接口，没跑 Rust 测试与 Tauri 冒烟。
