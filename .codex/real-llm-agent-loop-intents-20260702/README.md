# Agent loop 循环内 file.review / file.revise 真·LLM 实跑证据（2026-07-02）

## 场景

延续 `.codex/real-llm-agent-loop-20260702-165907` 的环境（run_windows.py 单机 sqlite 起服 + `STORYFORGE_LLM_CONFIG_FILE` 挂 deepseek-v4-flash BYO-key，真实 WebSocket，消息形状与桌面端一致），验证本轮新增的循环内审稿 / 修订工具。

单条消息：「帮我审一下 正文/第02章.md，然后按审稿意见把最明显的一个问题修一版，给我一个待确认的修订补丁。」

## 结果

- **自主工具链**：3 轮 / 3 次工具调用，55.0s——`file.review`（多视角审稿出 issue 列表）→ `fs.read`（读原文）→ `file.revise`（生成补丁）。全程模型自主决策，无关键词路由。
- **补丁契约**：`proposed_patch.kind=file_revision`、`requires_confirmation=true`、`file_path` 为项目内绝对路径；`agent_result.requires_user_confirmation=true` + `writeback_blocked_until_user_confirms=true`；plan 为 `agent.loop:completed + permission.confirm:needs_approval`；`permission_required` 事件发出、run 暂停在 `permission.confirm`。
- **写回红线实证**：跑完后盘上 `正文/第02章.md` 原文原样（含原句「凿痕很旧，起码有十几年」，不含修订新增句）——补丁未确认即未写盘。
- **回答质量**：最终回话结构化说明了审稿发现（plot-1 场景断裂）与修订动作（补对话暗示 / 内心冲突 / 章尾钩子），并明确「等你确认后才会写盘」——模型正确理解了补丁不落盘语义。
- **事件时间轴**：0.1s run_started → 11.8s plan + file.review + fs.read → 50.2s file.revise → 55.0s permission_required + agent_result。
- 脱敏扫描确认证据目录不含 API key。

## 不外推

单一 provider；真机 Tauri GUI 上 PatchReviewPanel 对循环产出补丁的确认写回观感未验（属桌面端到端验收项）；chapter.review / bookrun.* 等其余显式 intent 未并入循环。
