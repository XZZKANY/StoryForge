# fix/chapter-truncation-warning-on-rebuild 验证记录（2026-10-30）

## 改了什么

- 补 #546 验证记录里写明的缺口：新写一章停在半句时，**断线后按事件表重建**的结果丢了结构化截断警告，红色提示和「两步确认」硬闸都没了。
- 取警告的来源：写章流程的截断警告不进终态事件（`permission_required` 的 payload 里没有），只记在同一次执行的 `chapter_check` 产物里（`agent_artifact` 事件，`payload.payload.truncation_warning`）。重建时就从这里取。
- `apps/desktop/frontend/src/lib/api/agent-run-events.ts`：`reconstructAgentResultFromEvents` 在补丁是写章产的（`created_by_tool === 'chapter.write'`）时，在当前这次执行的事件段里（最后一次 `agent_execution_started` / `claimed` 之后、终态之前）找到 id 相同的 `proposed_patch` 产物，取紧挨它之前的那份 `chapter_check` 产物上的 `truncation_warning`，原样放进重建结果的 `agent_result.truncation_warning`。没找到、没有警告或 `message` 为空就不放。
- 界面不用改：`review.ts::truncationWarningFromAgentResult` 先读 `agent_result.truncation_warning`，重建结果现在有了这一项，就和实时结果走同一处显示与硬闸。`file.revise` 退到轨迹取的那条路没动。
- 引擎判定、帧契约 schema、golden 都没动：`git status --short packages/engine/golden` 为空。

## 测试

- 新增测试夹具 `tests/support/chapter-write-rebuild-events.ts`：照引擎写章流程落库的顺序拼事件（执行开始 → `chapter.draft` / `chapter.check` 轨迹 → `chapter_brief` / `chapter_check` / 待决调用 / `proposed_patch` 产物 → `permission_required`）。
- `tests/agent-run-events.test.ts` 新增 3 条：停在半句的重建结果带回警告（四个键原样）且 `truncationWarningFromAgentResult` 取到文案；收句的不带；只认紧挨这份写章补丁的检查（补丁 id 对不上、补丁不是写章产的、检查在上一次执行里，都不取）。
- `tests/proposed-patch-outcome.test.ts` 新增 1 条：重建结果经 `emitProposedPatchOutcome` 发出的修订带 `truncationWarning`、`before` 为空；收句的不带。
- `tests/behavior/auto-writeback.test.tsx` 新增 2 条（真挂 `useSuggestionWriteback` + `PatchReviewPanel`）：重建的半截写章结果显示红色「疑似没写完」，第一次点接受不写、按钮变「仍然整份接受」，再点一次才写；收句的不显示警告、点一次就写。
  - 这两条用重建结果的警告构造编辑器建议，没有直接跑 `emitProposedPatchOutcome`：它会带上 `runId`，接受后要去收尾运行，而这个夹具没有替身，等不到收尾。重建结果 → 建议这一段由上面 `proposed-patch-outcome` 那条覆盖。

## 命令与结果

- `npm --prefix apps/desktop/frontend run test -- tests/source-standards.test.ts tests/ui-terminology.test.ts tests/agent-run-events.test.ts tests/behavior/auto-writeback.test.tsx tests/chat-window.test.ts tests/proposed-patch-outcome.test.ts tests/patch-review-panel.test.tsx`：7 个文件 109 passed（原有 `file.revise` 重建取警告的用例在 `chat-window.test.ts` 里照旧过）。
- 用到重建的其余测试：`agent-checkpoint-recovery` / `agent-control-settlement` / `agent-engine-chat-window` / `agent-failure-settlement` / `chapter-brief` / `independent-claim-history`：6 个文件 120 passed。
- `npm --prefix apps/desktop/frontend run typecheck`：退出码 0。
- 改动文件跑 eslint：退出码 0；prettier `--check`：通过。
- 没跑整套 `pnpm verify` 和前端全量（作者在用机器）。

## 变异

定点替换，先断言目标串只出现 1 次，跑完还原。

- M1 重建结果不挂写章警告（条件改成永远不成立）：3 红——重建取回警告、重建结果经 `emitProposedPatchOutcome` 带警告、编辑器红色警告与两步确认。
- M2 去掉「补丁必须是写章产的」这道限制：1 红——「只认紧挨这份写章补丁的检查」。
- 还原后上面的测试全绿。

## 没联通的

- 没在真宿主或装机版上点穿「写章半截 → 断线 → 重建 → 红色警告 + 两步确认」；事件形状按引擎 `recordAgentArtifact` / `recordPermissionRequired` 的写法手拼，没用真引擎跑出来的事件表做输入。
