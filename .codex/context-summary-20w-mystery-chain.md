# 20w 悬疑小说项目链路上下文摘要

生成时间：2026-05-24 04:11:38 +08:00

## 相似实现

- `apps/workflow/storyforge_workflow/provider_client.py`：真实 OpenAI 兼容 provider 入口，使用 `STORYFORGE_LLM_*` 环境变量。
- `apps/workflow/tests/test_llm_provider.py`：使用 monkeypatch 隔离 provider 配置。
- `apps/workflow/tests/test_generation_graph.py` 和 `test_runtime_runner.py`：pytest 组织、显式失败和中文说明风格参考。

## 项目约定

- Python 使用 `from __future__ import annotations`，函数 snake_case，数据类 PascalCase。
- 测试使用 pytest，通过 provider 注入保持可重复。
- 文档、注释、测试说明使用简体中文。

## 可复用组件与集成点

- `provider_client.generate_text`：真实模型调用。
- `LongformGenerationPlan`：目标字数、分段、重试和退避参数契约。
- `generate_longform_article()`：分段生成、断点续跑、增量落盘。
- `count_article_chars()`：20w 验收的唯一正文计数口径。

## 风险与已处理问题

- 真实 API 长链路间歇 503：已增加可配置重试、指数退避和断点续跑。
- PowerShell 中文 here-string 编码污染：真实脚本使用 Unicode 转义字符串。
- `actual_chars` 旧逻辑计入换行符：已改为 `count_article_chars(cleaned)`。
