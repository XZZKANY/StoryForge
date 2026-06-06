# 项目上下文摘要（真实 LLM 35k ModelRun 摘要长度修复）

生成时间：2026-06-05 01:00:00 +08:00

## 1. 相似实现分析

- **实现1**: `apps/api/app/domains/model_runs/schemas.py`
  - 模式：`ModelRunCreate.input_summary` 与 `output_summary` 使用 Pydantic `Field(max_length=50000)` 约束。
  - 可复用：保持 schema 上限作为 API 与日志写入边界。
  - 需注意：真实失败为 `string_too_long`，不能把超长 prompt 直接传给该 schema。
- **实现2**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：`_record_model_run` 记录真实生成 prompt 与正文摘要。
  - 可复用：只在该函数入库前裁剪摘要字段，真实 LLM 请求路径 `_call_llm` 不变。
  - 需注意：长程续写会把前文拼入 prompt，后续章节容易超过 50000 字符。
- **实现3**: `apps/api/app/domains/context_compiler/service.py`
  - 模式：上下文预算会记录 `truncated` 和 debug summary。
  - 可复用：本轮采用“保留可审计标记”的思想，在 ModelRun payload 中记录原始长度与是否截断。
  - 需注意：不引入跨域依赖，避免把真实 LLM smoke 绑到 context compiler。
- **实现4**: `apps/api/tests/test_phase9b_real_llm_smoke.py`
  - 模式：使用本地 fake provider 和 SQLite session 验证真实 LLM smoke 的协议与产物。
  - 可复用：新增直接调用 `_record_model_run` 的单元测试，不触发真实外部网络。
  - 需注意：测试中的私有值是本地假值，不能写入真实 provider 配置。

## 2. 项目约定

- **命名约定**：常量使用大写 snake case；helper 使用下划线前缀；测试函数 `test_*`。
- **文件组织**：业务修复留在真实 LLM smoke 模块内；审计文件写入项目 `.codex/`。
- **导入顺序**：标准库、第三方、本地应用模块。
- **代码风格**：中文注释解释约束；短文本不改变；长文本保留头尾和中文截断标记。

## 3. 可复用组件清单

- `ModelRunCreate`: 继续作为模型运行日志 schema。
- `create_model_run`: 继续作为持久化入口。
- `_record_model_run`: 修复点，只处理入库摘要。
- `pytest` 与本地 `session` fixture：验证 schema 限制和入库结果。

## 4. 测试策略

- **测试框架**：pytest、Ruff、py_compile。
- **测试模式**：构造超过 50000 字符的 prompt/output，直接调用 `_record_model_run`。
- **参考文件**：`test_phase9b_real_llm_smoke.py`、`test_phase9b_real_llm_long_wrapper.py`、`test_real_llm_connectivity_probe_script.py`。
- **覆盖要求**：长摘要可成功入库；入库字段不超过 50000；payload 记录原始长度与截断状态；真实请求 prompt 不在本轮修改。

## 5. 依赖和集成点

- **外部依赖**：本轮不调用真实外部 LLM。
- **内部依赖**：Book、Chapter、Scene、BookBlueprint、BookRun、ModelRun。
- **集成方式**：`_record_model_run` 在构造 `ModelRunCreate` 前裁剪摘要字段。
- **配置来源**：无新增配置。

## 6. 技术选型理由

- **为什么用这个方案**：真实失败来自日志摘要字段上限，而不是模型上下文长度；裁剪入库摘要能修复失败且不影响生成质量。
- **优势**：改动小，保留 schema 约束，避免长 prompt 破坏日志 API。
- **劣势和风险**：入库摘要不再是完整 prompt；通过 payload 记录原始长度和截断状态补足审计信息。

## 7. 关键风险点

- **并发问题**：无新增并发。
- **边界条件**：截断标记本身也要计入 50000 上限。
- **性能瓶颈**：字符串切片成本远低于真实模型外呼。
- **安全考虑**：不读取 `.env`；不写入私有 API key、Base URL 或 Authorization 值。
