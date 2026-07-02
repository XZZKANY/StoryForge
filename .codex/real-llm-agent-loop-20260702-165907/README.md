# Agent loop 真·LLM tool-calling headless 实跑证据（2026-07-02）

## 运行环境

- 服务：`apps/api` 经 `run_windows.py` 单机起服（sqlite 自建表，`DATABASE_URL=sqlite:///...`，无 docker / Redis）。
- LLM 配置：`STORYFORGE_LLM_CONFIG_FILE` 指向桌面 Alpha 写盘的 `llm-provider.json`（provider=deepseek，model=deepseek-v4-flash，BYO-key）；密钥不落盘、不入证据。
- 客户端：真实 WebSocket 连接 `/api/ide/agent/sessions/{id}`，消息形状与桌面端一致（`user_message` + `args.project_path` + `stream=true`）；两条消息经 `assistant_session_id` 续同一会话。
- 测试项目：临时中文小说项目（5 个 md：两章正文、人物 / 世界观设定、三幕大纲），埋有跨文件伏笔（第二章铜镜凿星 ↔ 世界观摇光禁术 ↔ 大纲十七年前旧案）。

## 场景与结果

### happy-*（意外获得的回落路径实证）

`.env.local` 中的旧 key 已失效，provider 返回 HTTP 401：首轮 LLM 调用失败 → `ChatLoopUnavailableError` → 静默回落单轮对话 → 单轮同样 401 → 如实回话「这轮没答上来：真实 LLM 返回 HTTP 401…」，run 以 `agent_result` 正常收尾，无 `chat_loop` 字段、无伪造内容、无崩溃。回落路径在真实 provider 错误下成立。

### happy2-*（工具循环主路径，key 有效）

| 消息 | rounds | 工具调用 | 用时 | completion_tokens |
|---|---|---|---|---|
| 1. 项目梳理（主角 / 进度 / 第二章线索） | 4 | fs.list + fs.read×3（大纲、人物、第02章） | 98.1s | 808 |
| 2. 凿星呼应 + 「观澜」全项目检索 | 2 | fs.search×3（含自主构造正则 `凿去\|凿星\|七星\|北斗`） | 57.5s | 804 |

- **接地核对**：主角身份 / 口头禅 / 章节数 / 铜镜凿摇光 / 禁档均与项目文件一致；引用的行号（世界观.md:4、大纲.md:5、人物.md:5）与真实文件行号一致；跨文件伏笔（凿痕「十几年」↔ 观澜「十七年前被除名的前任灵台郎」）被模型自主串起。
- **事件渐进到达**（msg1 时间轴）：0.2s run_started → 14.6s plan + fs.list → 34.3s fs.read×2 → 55.9s fs.read → 98.1s agent_result；前端流程树可按真实节奏渲染。
- **证据链落库**：`assistant_tool_calls` 含逐调用 fs.* 记录（input/output summary）+ `assistant.chat_loop` 汇总（rounds / tool_call_count / completion_tokens / exhausted）；REST `/api/agent-runs/{id}/events` 含 agent_run_started / agent_plan_created / tool_trace×4 / agent_run_completed。
- **质量观察**：回答第 1 条把案件演绎为「井中尸体案」，正文只写「井里捞出来的东西」，属轻度过度演绎（非工具链问题，是模型行为）；其余全部接地。

## 判定与边界

- 通过：真实 provider（deepseek-v4-flash）tool-calling 多轮循环、并行工具调用、正则检索、事件流、证据链、回落路径均在 headless WS 路径成立。
- 不外推：单一 provider；真机 Tauri GUI 多轮渲染观感未验（属桌面端到端验收项）；审稿 / 修订等显式 intent 仍走固定管线未进循环；本证据不构成任何长程质量结论。
