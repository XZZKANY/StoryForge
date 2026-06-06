# 项目上下文摘要（真实 LLM 35k 章节上限修复）

生成时间：2026-06-04 23:27:43 +08:00

## 1. 相似实现分析

- **实现1**: `.codex/run-real-llm-long-direct.py`
  - 模式：真实长程 runner 负责创建一次性 SQLite、调用业务 smoke 函数、输出 `summary.json`、`book.md`、`audit_report.json` 和脱敏 metadata。
  - 可复用：现有 `--chapter-count`、`--target-word-count`、`--token-budget`、质量门禁与敏感扫描。
  - 需注意：当前 30 章运行已通过探针，但 runner 内部返回 1，stderr 显示被 10 章上限拒绝。
- **实现2**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：`run_phase9b_real_llm_smoke` 集中创建蓝图、BookRun、章节生成、Judge/Repair、导出和审计。
  - 可复用：`_assert_preflight` 是唯一章节、预算、字数参数校验点，应复用而不是复制校验逻辑。
  - 需注意：默认 10 章 smoke 上限仍是安全边界，不能把所有调用默认放宽到 30。
- **实现3**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：PowerShell wrapper 先执行连通性探针，探针通过后调用 Python runner。
  - 可复用：只需透传脱敏章节上限参数，不改变凭据输入、清理和探针顺序。
  - 需注意：不得写入或输出私有运行时配置。
- **实现4**: `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`
  - 模式：通过 importlib 加载 `.codex` runner，直接测试内部工具函数和 runner 契约。
  - 可复用：可用 `pytest.raises(..., match=...)` 锁定默认上限错误，可用 monkeypatch 替换真实生成函数。
  - 需注意：测试必须不触发真实 provider。

## 2. 项目约定

- **命名约定**：Python 使用 `snake_case`；PowerShell 参数使用 PascalCase；环境变量保持 `STORYFORGE_LLM_*`。
- **文件组织**：审计材料写入项目本地 `.codex/`；业务代码仍在 `apps/api/app/domains/book_runs/`。
- **导入顺序**：沿用现有测试文件的标准库、第三方库、本地加载顺序。
- **代码风格**：中文错误信息和注释；不新增外部依赖；不读取 `.env`。

## 3. 可复用组件清单

- `run_phase9b_real_llm_smoke`: 真实 LLM BookRun 主流程。
- `_assert_preflight`: 参数校验入口。
- `.codex/run-real-llm-long-direct.py`: 长程证据 runner。
- `.codex/run-real-llm-10ch-current-env.ps1`: 探针优先的安全 wrapper。
- `pytest.raises(..., match=...)`: 官方 pytest 异常断言方式。

## 4. 测试策略

- **测试框架**：pytest、Ruff、py_compile、PowerShell 解析检查。
- **测试模式**：先新增红灯测试，确认默认 smoke 拒绝 11 章，同时显式 `max_chapter_count=30` 允许长程 30 章；runner 测试用 monkeypatch 捕获参数，不真实外呼。
- **参考文件**：`test_phase9b_real_llm_long_wrapper.py`、`test_phase9b_real_llm_smoke.py`、`test_real_llm_connectivity_probe_script.py`。
- **覆盖要求**：默认安全边界不变；长程入口显式放宽；不触碰私有 provider 配置。

## 5. 依赖和集成点

- **外部依赖**：本轮不调用真实外部 LLM。
- **内部依赖**：业务 smoke 函数、runner argparse、PowerShell 参数透传、证据 metadata。
- **集成方式**：PowerShell wrapper 透传 `-MaxChapterCount` 到 Python runner，Python runner 再传给 `run_phase9b_real_llm_smoke`。
- **配置来源**：章节上限为脱敏运行参数，不包含私有凭据。

## 6. 技术选型理由

- **为什么用这个方案**：根因是调用场景混用同一个默认上限；通过显式参数保留默认 smoke 的 10 章门禁，同时让长程入口具备 30 章能力。
- **优势**：改动小、职责清晰、测试可证明默认行为与长程行为分离。
- **劣势和风险**：30 章会消耗更多时间和 token，仍需通过 token、时间和人工通读门禁控制。

## 7. 关键风险点

- **并发问题**：无新增并发。
- **边界条件**：`max_chapter_count` 必须为正数；`chapter_count` 不能超过显式上限。
- **性能瓶颈**：正式 30 章真实运行会产生大量外呼，本轮只修复入口契约。
- **安全考虑**：不得把用户私有 Base URL、API key、Authorization 或可还原 provider 私有值写入代码、日志、报告或命令。
