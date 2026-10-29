## 2026-10-29 整文件修订的新稿看起来没写完时，补丁带警告、整份接受要再确认

- 取证（只读打开作者引擎库 `storyforge-engine.sqlite3`，`?mode=ro`；没读模型配置与 key，没碰作品目录）：
  - 事故补丁是 `agent_artifacts` #286（run 113，权限档 ask，`requires_confirmation=1`），来自对话循环里的 `file.revise`（工具轨迹 `assistant_tool_call_id=377`，对应 `assistant.revise` #378）。原文 6443 字，新稿 8349 字——新稿比原文长，按长度比例拦不住。
  - 那次请求的证据（artifact #284，step=file.revise）：流式、`max_tokens` 未设、`finish_reason=stop`、`status=response_completed`；`usage.token_usage_source=estimated_split`（completion_tokens 2087 是按字数估的，不是服务端给的数，也不是 8192 之类的整数上限）。
  - 判断：不是撞输出上限漏拦（没有 `finish_reason=length`，`rejectIncompleteResponse` 不会也不该拦），也不像模型自己收尾（停在半个词组上）。同一中转上 12 次成功返回的修订 / 起草（这个模型 6 次、另一个模型 6 次）里，只有这一次没有服务端 usage，其余都是 `provider_usage`；同一份修订三小时前那次（#373/#374）就是吐到 7401 字时 `IncompleteRead` 断流失败。最可能是中转在长输出途中掐断、却照样回了终止标记（`[DONE]` 或 stop 帧，证据只存最终 finish_reason，分不清是哪一种），传输层的「没收到终止标记就拒稿」因此放行。
  - 之后两版（#293、#304）都是在已截断的稿子上继续改，补丁本身保留了截断处，没有再丢东西。
- 改动：
  - 引擎新增确定性检测 `packages/engine/src/kernel/revisionTruncation.ts`（不加模型调用）：新稿最后一行停在半句（末字不是句末标点 / 闭合引号括号；或停在空节标题上；列表项本来就不带句号的稿子按同类行习惯不算），且原文里「最后一处仍留在新稿里的行」之后的若干段在新稿里整段找不到（只差一行时只认「照抄末行抄到一半」；新稿停在原文某一整行上算作者让删到这里）。不看长度比例。
  - `file.revise` 处理器命中时：补丁照交，`output` / 轨迹 `output_summary` 带 `truncation_warning`（message、缺失段数、缺失的顶层标题），summary 末尾附警告让模型也知道；补丁 `requires_confirmation` 强制为 true——自动档下疑似半截的稿子不再免点击落盘（只会更严，不放宽任何档位）。对话循环与固定修订管线都把它提到 `agent_result.truncation_warning`（与 `scope_warning` 同一条路）。
  - 界面：`AssistantFileSuggestion` 加可选 `truncationWarning`，修订横幅用醒目红字（`role="alert"`）显示；断线按事件表重建结果时，从同一补丁 id 的 `file.revise` 轨迹取回警告。整份接受（按钮、Ctrl+Y、对话里点接受、自动接受都走 `handleAcceptSuggestion`）先弹 AppDialog danger 档确认，取消就不写、不留快照；确认入口没接上时一律当没确认。逐处接受不受影响。
  - 没改帧契约 `agent-ws.schema.json` 与 `contracts.ts`：`agent_result` 与轨迹 `output_summary` 本来就是开放对象，`proposed_patch` 形状没动。golden 一个字节都没变（检测在全部预言机场景里都不命中）。
- 验证：
  - 用新检测只读扫作者库里全部 10 个有原文的修订补丁：只有 #286 命中，缺失标题正好是第五卷与七、八两节；其余 9 个（含一份末节改成不带句号列表的、一份项目说明列表改写）都不报。
  - 引擎：`kernel/revisionTruncation.test.ts` 7 条（事故形状且新稿更长要报、停在空节标题要报、删减以句号收尾不报、停在原文整行不报、列表习惯不报、末行改写不报 / 末行抄一半要报、整篇重写不下结论）；`loop/revisionTruncation.test.ts` 3 条（预言机回放：对话循环自动档截断稿→警告进 agent_result、补丁改成等确认、计划含 permission.confirm；完整稿照旧免点击；固定管线同样带警告）；`assistantService.test.ts` 加 1 条：流式 `finish_reason=length` 拒稿且不重发。
  - 前端：`patch-review-panel` 横幅显示 1 条；`chat-window` 警告提取（含按轨迹回取、不串别的补丁）1 条；`proposed-patch-outcome` 警告随补丁交给编辑器 1 条；`behavior/auto-writeback` 4 条（取消不写不留快照、确认后照常写；自动档也先问；确认入口没接上不写；无警告不弹）；`editor` 接线 1 条。
  - 接线变异（各自打一处，跑对应测试，确认变红后用带 `count==1` 断言的定点替换无条件还原，没用 git checkout / stash）：
    - agentRuntime 不把 `truncation_warning` 提进 agent_result → 对话循环那条红。
    - `file.revise` 不强制确认 → 对话循环与固定管线两条红。
    - `file.revise` 不挂警告 → 两条红。
    - 写回钩子跳过确认 → auto-writeback 3 条红。
    - `emitProposedPatchOutcome` 不传警告 → outcome 那条红。
    - Editor 不接确认入口 → editor 接线那条红。
    - 横幅不渲染 → panel 那条红。
  - `pnpm verify` EXIT=0：lint 与前端类型检查通过；project-core 14 passed；引擎 96 个文件 13832 passed + 2 skipped（golden 契约无改动）；前端 245 个文件 2439 passed；行间续写、浏览器冒烟、Agent 对话三个浏览器回归通过。
- 未覆盖：
  - 检测是启发式：截在句号处、整篇重写后截断（新稿里找不到任何原文行）、原文末尾某行恰好被搬到新稿前面，都会漏报；故意删掉末尾几节又恰好停在一行没标点的新内容上会误报（只多一次确认）。
  - 只接在 `file.revise`（对话循环与固定管线）。`project.trim_prose` 压缩、`chapter.repair`、Ctrl+K 行间修订（另有润色长度门）没接。
  - 传输层没改：中转回了终止标记但没给 usage 这一信号没有拿来用；`[DONE]` 不带 finish_reason 仍按 stop 认。
  - 断线重建结果里的 `scope_warning` 仍会丢（本次只给截断警告补了回取）。
  - 没跑 Tauri 冒烟与真宿主探针（作者正在用装机版），没在真机与真模型上点穿；确认框是居中弹窗。

## 2026-10-29 截断确认改成就地两步，不再弹居中确认框

- 改动：
  - 原因：作者明确说过「对话里的决定不要居中弹窗」（设置 / 应用级确认才居中）；上一提交用的 `dialogs.confirm` 违背了这条，改成照「请求停止 → 确认停止」的就地两步。
  - 写回钩子：删掉 `confirmTruncatedAccept` 注入与 AppDialog 依赖。`handleAcceptSuggestion` 开头加硬闸——有截断警告且这份补丁没武装就不写，这一次只武装（不进写回动作、不留快照）；武装着再来一次才写。武装 5 秒（`TRUNCATED_ACCEPT_CONFIRM_TIMEOUT_MS`）超时撤销，换补丁（含逐处接受后同一补丁局部刷新）撤销。逐处接受不经过这道闸。
  - 修订横幅：武装时「接受」就地换成 danger 档「仍然整份接受」，按钮旁一句「AI 可能没写完：整份接受会删掉原文末尾那几段，再点一次才写」；Ctrl+Y 同样两步；按钮失焦、鼠标移开、点拒绝 / 旁注 / 逐处接受等别的操作都撤销武装。
  - 对话路径：编辑器接到对话里的「接受，写进稿子」时，半截稿只在横幅上武装、从不写，回报新的 `armed`；`acceptPatchFromChat` 据此提示「这份修订可能没写完，没有写入……在横幅上点『接受』后再点一次『仍然整份接受』」。`useAgentRunControls.ts` 没动。
  - 自动接受仍先被引擎强制的 `requires_confirmation` 拦住；万一绕过，也只会武装、不会写。
- 验证：
  - `behavior/auto-writeback` 换掉上一版的 4 条确认框用例，加 8 条（把修订横幅按 Editor 的接法挂进同一个写回钩子测）：点两次才写且第一次不留快照、不弹居中框；Ctrl+Y 两步；超时撤销后仍要两次；失焦 / 移开撤销；对话里接受回 `armed`、两次都不写、只能在横幅上确认；自动档不写；逐处接受不受影响；无警告照旧一次就写。`patch-review-panel` 加武装态渲染与三种撤销 1 条；`editor` 接线用例改成核对横幅拿到武装状态、硬闸在开始写回之前、源码里不再有确认框入口。
  - 接线变异（各自打一处，确认变红后用带 `count==1` 断言的定点替换无条件还原）：硬闸失效（第一次点就写）→ auto-writeback 5 条红；对话路径绕过武装 → 对话那条红；Editor 不传武装状态 → editor 接线那条红；横幅失焦不撤销 → 2 条红。
  - `auto-writeback.test.tsx` 是 CRLF，改后仍全 CRLF；它的两组 numstat 差 2 行，是新旧用例里只差缩进的行，不是行尾噪音。其余文件两组 numstat 一致。
  - `pnpm verify` EXIT=0：lint 与前端类型检查通过；project-core 14 passed；引擎 13832 passed + 2 skipped；前端 245 个文件 2444 passed；三个浏览器回归通过。
- 未覆盖：武装只有 5 秒，从对话跳到编辑器看完对比时多半已超时，要重新点两次（提示文案按这个写）；没在真机上点过两步交互。
