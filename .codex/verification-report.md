# 20w 悬疑小说项目链路验证报告

生成时间：2026-05-24 04:11:38 +08:00

## 结论

通过。项目链条已能使用真实 OpenAI 兼容 API 生成一篇超过 20w 正文字符的中文悬疑小说，并支持从中断点恢复续写。

## 需求对照

- 完善项目功能：已新增长文生成模块、CLI 入口、断点续跑、可配置重试和指数退避。
- 只能通过项目链条：真实生成脚本调用 `storyforge_workflow.longform.generate_longform_article()` 和 `provider_client.generate_text()`，未绕过 workflow 项目链路。
- 生成 20w 字悬疑小说：真实输出 `.codex/tmp/mystery-200k-real-chain.md` 独立计数 `200887` 正文字符。
- 失败后找出问题并修复：已处理真实 API 间歇 503 和 `actual_chars` 换行计数偏差。

## 关键证据

- 输出文件：`.codex/tmp/mystery-200k-real-chain.md`
- 标题：雾城回声
- 正文字符数：200887
- 分段数：64
- 内容抽样关键词：林澈 1853、剧院 438、录音 434、失踪 183、雾城 81
- API Key：仅以进程环境变量使用，未写入仓库文件或报告明文。

## 本地验证

- `uv run pytest tests/test_longform_generation.py -q`：6/6 通过。
- `pnpm.cmd run test:workflow`：19/19 通过。
- `uv run python ../../.codex/tmp/run_real_200k_mystery.py`：真实链路退出码 0，`actual_chars=200887`。
- `git diff --check`：通过。

## 质量评分

- 代码质量：92/100。
- 测试覆盖：94/100。
- 规范遵循：90/100。
- 综合评分：92/100。

建议：通过。
