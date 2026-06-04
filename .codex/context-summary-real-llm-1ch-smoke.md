## 项目上下文摘要（真实 1 章 LLM smoke）

生成时间：2026-06-03 14:13:05

### 1. 相似实现分析

- **实现1**: D:\StoryForge\apps\api\app\domains\book_runs\phase9b_real_llm_smoke.py:52-57
  - 模式：通过 REQUIRED_REAL_LLM_ENV 明确校验真实 LLM 冒烟必需环境变量。
  - 可复用：直接复用 un_phase9b_real_llm_smoke 和模块 CLI main。
  - 需注意：STORYFORGE_LLM_API_KEY 不得写入日志或最终回复。
- **实现2**: D:\StoryForge\apps\api\app\domains\book_runs\phase9b_real_llm_smoke.py:788-855
  - 模式：CLI 接收章节数、token 预算、字数范围与 summary 输出路径，执行后输出脱敏 JSON 摘要。
  - 可复用：按用户模板执行 python -m app.domains.book_runs.phase9b_real_llm_smoke。
  - 需注意：失败退出码 1/2 需要检查 stderr.log。
- **实现3**: D:\StoryForge\apps\api\tests\test_phase9b_real_llm_smoke.py:78-130
  - 模式：测试使用 OpenAI 兼容 Chat Completions 协议边界，并断言审计产物不包含私有凭据。
  - 可复用：本次真实 smoke 使用相同环境变量协议。
  - 需注意：真实 provider 会产生外部调用耗时。
- **实现4**: D:\StoryForge\apps\api\app\domains\provider_gateway\runtime_config.py:59-74
  - 模式：运行时配置从 STORYFORGE_LLM_* 读取，凭据只记录 configured/missing 状态。
  - 可复用：沿用 openai-compatible provider 与 STORYFORGE_LLM_BASE_URL。
  - 需注意：不要额外引入自研配置流程。

### 2. 项目约定

- **命名约定**: Python 模块与函数使用 snake_case；环境变量使用 STORYFORGE_LLM_*。
- **文件组织**: 后端代码位于 D:\StoryForge\apps\api\app\domains\...，验证产物写入项目本地 .codex。
- **导入顺序**: 标准库、第三方库、项目模块分组导入；本任务不改代码。
- **代码风格**: Python 代码 UTF-8；本任务仅生成 Markdown/日志和运行既有命令。

### 3. 可复用组件清单

- D:\StoryForge\apps\api\app\domains\book_runs\phase9b_real_llm_smoke.py: 真实 LLM smoke CLI 与执行函数。
- D:\StoryForge\apps\api\app\domains\provider_gateway\runtime_config.py: LLM provider 环境配置解析。
- D:\StoryForge\apps\api\tests\test_phase9b_real_llm_smoke.py: CLI 输出脱敏与产物写入的验证模式。

### 4. 测试策略

- **测试框架**: pytest；本次为真实 smoke 运行验证，不新增测试。
- **测试模式**: 执行 uv run python -m app.domains.book_runs.phase9b_real_llm_smoke，检查退出码与产物文件。
- **参考文件**: D:\StoryForge\apps\api\tests\test_phase9b_real_llm_smoke.py。
- **覆盖要求**: 确认 summary.json、stdout.json、stderr.log 生成；失败时记录 stderr 摘要。

### 5. 依赖和集成点

- **外部依赖**: 用户提供的 OpenAI 兼容接口 https://token-plan-cn.xiaomimimo.com/v1。
- **内部依赖**: phase9b_real_llm_smoke、数据库会话、BookRun/Artifact/Judge/Repair 域服务。
- **集成方式**: 通过环境变量注入 provider 配置，通过 CLI 参数控制章节与字数预算。
- **配置来源**: 当前 PowerShell 进程环境变量，不将私有凭据落盘。

### 6. 技术选型理由

- **为什么用这个方案**: 用户要求按模板执行，且项目已有官方 CLI 入口，直接复用最稳定。
- **优势**: 不改源码、低风险、产物可审计、凭据可脱敏。
- **劣势和风险**: 真实 provider 可能因网络、配额、模型不可用、超时或返回格式失败。

### 7. 关键风险点

- **并发问题**: 本次单进程单次运行，无并发写入同一 outDir 风险。
- **边界条件**: 凭据缺失、模型名无效、接口不可达、字数范围校验失败。
- **性能瓶颈**: 真实 LLM 调用可能接近 900 秒预算。
- **安全考虑**: API key 只进入当前进程环境变量；日志和最终回复均脱敏。