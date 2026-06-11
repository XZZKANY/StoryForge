## 项目上下文摘要（源码剪枝 Workflow provider token usage helper）

生成时间：2026-06-05 16:25:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：通过源码字符串断言防止未调用 helper 或旧入口回潮。
  - 可复用：读取目标文件源码并检查必须保留和必须删除的符号。
  - 需注意：护栏自身会包含禁用符号，残留搜索时需允许 source-pruning 文本。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`
  - 模式：`ProviderClientAdapter.generate()` 分别计算 prompt tokens 与 completion tokens，再计算总 token 和成本估算。
  - 可复用：`_estimate_token_count` 与 `_estimate_cost` 是当前真实计算路径。
  - 需注意：不修改 provider 调用、fallback 或 parity harness。
- **实现3**: `apps/workflow/tests/test_provider_adapter.py`
  - 模式：验证真实 adapter 响应字段归一化和 token_usage 行为。
  - 可复用：作为删除死 helper 后的行为护栏。
  - 需注意：当前断言依赖 prompt 与输出长度合计估算行为。

### 2. 项目约定

- **命名约定**: Python 私有 helper 使用 `_` 前缀，pytest 用例使用 `test_` 前缀。
- **文件组织**: provider runtime 适配逻辑集中在 `storyforge_workflow/runtime/provider_adapter.py`。
- **导入顺序**: 本批不新增生产导入。
- **代码风格**: pytest plain `assert`，测试说明和断言消息使用简体中文。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`: provider adapter、token 估算和成本估算事实源。
- `apps/workflow/tests/test_provider_adapter.py`: provider client adapter 行为验证。
- `apps/workflow/tests/test_provider_fallback.py`: fallback 行为验证。
- `apps/workflow/tests/test_model_run_token_tracking.py`: ModelRun token 字段映射验证。
- `apps/workflow/tests/test_source_pruning.py`: 剪枝防回潮护栏。

### 4. 测试策略

- **测试框架**: pytest，经 `uv run pytest` 或根目录 `pnpm run test:workflow` 调用。
- **测试模式**: 先新增红灯护栏确认 `_estimate_token_usage` 仍存在，再删除该 helper 形成绿灯。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_provider_adapter.py`。
- **覆盖要求**: 未调用 helper 删除、真实 token/cost helper 保留、provider adapter 行为不变、Workflow 全量不退化。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖。
- **内部依赖**: `ProviderClientAdapter.generate()` 依赖 `_estimate_token_count` 与 `_estimate_cost`。
- **集成方式**: 删除未调用私有 helper，不改变公开 dataclass 或 adapter 方法。
- **配置来源**: provider 配置继续由 `provider_config` 注入。

### 6. 技术选型理由

- **为什么用这个方案**: `_estimate_token_usage` 未被调用，且职责已由更细粒度的 prompt/completion token 估算路径承担。
- **优势**: 减少 provider adapter 内部维护面，避免未来误用粗粒度 helper。
- **劣势和风险**: 风险很低，但必须保留 token/cost 真实路径和现有测试覆盖。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除 `_estimate_token_count`、`_estimate_cost`，不改 `ProviderClientAdapter.generate()`。
- **性能瓶颈**: 删除未调用函数无性能影响。
- **安全考虑**: 本批不修改认证、鉴权、限流、请求超时或审计留痕。
