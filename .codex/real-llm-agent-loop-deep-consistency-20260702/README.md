# Agent loop 循环内 project.deep_consistency 真·LLM 实跑证据（2026-07-02）

## 场景

环境同前几轮（`run_windows.py` 单机 sqlite 起服 + `STORYFORGE_LLM_CONFIG_FILE` 挂 deepseek-v4-flash BYO-key，真实 WebSocket）。验证本轮新增的深度一致性（语义 judge）循环工具，同时 live 验证 PR-G1：语义 judge 经 `resolved_llm_env` 覆盖链吃到 `llm-provider.json`（此前 judge 直读 os.getenv，本场景下会因拿不到 key 而静默跳过）。

测试项目：临时中文小说项目（5 个 md），第二章**故意埋 6 处违背 Character Bible / 世界观的雷**：
1. 涨潮夜点主灯（违背世界观铁律「从无例外」）
2. 主灯闪四十次（设定为三十二次，且「没有人觉得异样」双重矛盾）
3. 林岚右手拎铁箱（右臂旧伤提不起重物）
4. 沈曜眯起左眼打量（左眼已瞎）
5. 沈曜自称说过谎（一生不撒谎）
6. 林岚一口气说半刻钟（语气克制、说话从不超过三句）

单条消息：「帮我深查第二章：正文有没有违背人物设定或世界观的地方？查完把问题按严重程度列出来。」

## 结果

- **自主工具链**：4 轮 / 6 次工具调用，58.7s——fs.list → fs.read×4（第二章 + 两个人物文件 + 世界观）→ **project.deep_consistency**（模型自主传 `bible_paths=['人物/林岚.md','人物/沈曜.md','设定/世界观.md']`）。
- **语义 judge 命中**：`issue_count=6`，与埋雷数完全一致；`bible_file_count=3`。
- **结论质量（人工核对）**：模型最终回答按严重度列出 6 处问题，**6 处埋雷全部命中、零漏报**，每处均给出原文行号 + 设定出处 + 修改建议；额外产出一条叙事层观察（沈曜编造「老规矩」若是有意违规应加铺垫）——机械信号 + 语义 judge + LLM 综合的三层分工成立。回答末尾正确引导走修订补丁确认流程，未擅自改稿。
- **证据链**：`assistant_tool_calls` 含 project.deep_consistency 逐调用记录（input bible_paths / output issue_count）；WS 事件渐进到达（agent_run_started → agent_step → tool_trace×6 → agent_result）；REST events 与会话消息齐全。
- 脱敏扫描确认证据目录不含 API key（grep "sk-" 零命中）。

## 判定与边界

- 通过：深度一致性工具在真实 provider 下被自主选用、语义 judge 走 llm-provider.json 覆盖链真实出网、issue 信号被模型正确消化为分级结论。
- 不外推：单一 provider；测试项目仅 5 文件、埋雷为显性矛盾（隐性/跨章长程矛盾的召回率未验）；工具产出是 advisory 信号，结论质量取决于模型；真机 GUI 观感未验；不构成长程质量结论。
