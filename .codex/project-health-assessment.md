# StoryForge 项目健康评估报告

生成时间：2026-06-01 04:20:41 +08:00

## 1. 评估基线

- 分支：codex/project-health-assessment-plan。
- 代码基线：包含 944f9db 合并 BookRun workflow adapter recorded skill_runs。
- 评估方式：只读代码、运行本地验证、生成 .codex 评估文档。
- 范围：workflow、API、Web 审计、BookRun 主链路、skill_runs 审计投影。
- 非范围：不修改 apps/** 业务代码，不恢复历史 stash，不做真实生产接线。

## 2. 本地验证结果

| 验证项 | 命令 | 结果 | 结论 |
| --- | --- | --- | --- |
| workflow lint | cd D:\StoryForge\apps\workflow; uv run ruff check . | All checks passed | 通过 |
| workflow 全量测试 | cd D:\StoryForge\apps\workflow; uv run pytest -q | 156 passed | 通过 |
| API lint | cd D:\StoryForge\apps\api; uv run ruff check . | All checks passed | 通过 |
| API 全量测试 | cd D:\StoryForge\apps\api; uv run pytest -q | 326 passed, 6 warnings | 通过，warnings 非本任务阻塞 |
| Web 审计 contract | cd D:\StoryForge; pnpm --filter @storyforge/web test -- book-run-audit | 3 pass / 0 fail | 通过 |
| workflow 主链路目标测试 | cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v | 27 passed | 通过 |
| API 主链路目标测试 | cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py tests/test_book_runs.py -v | 12 passed, 1 warning | 通过，warning 非阻塞 |

## 3. Warning 分类

### 阻塞 warning

无。

### 非阻塞 warning

1. API 全量测试中的 JWT InsecureKeyLengthWarning：来自 tests/test_api_middleware.py 使用测试密钥长度不足 32 字节。影响测试安全提示，不影响当前 BookRun 主链路评估；建议后续把测试密钥长度调整到 32 字节以上。
2. API 全量测试和目标测试中的 HTTP_422_UNPROCESSABLE_ENTITY DeprecationWarning：来自 anyio 调用栈中旧常量提示。当前断言仍通过；建议后续统一替换为 HTTP_422_UNPROCESSABLE_CONTENT。

## 4. 当前测试健康度初判

- workflow 本地门禁健康：ruff 与 156 个 pytest 均通过。
- API 本地门禁健康：ruff 与 326 个 pytest 均通过，但存在 6 个非阻塞 warning。
- Web 审计路径健康：book-run-audit contract 3 个子测试通过。
- BookRun recorded skill_runs 主链路有目标测试覆盖：workflow 27 个目标测试和 API 12 个目标测试通过。
- 当前最大测试风险不是失败，而是生产触发路径尚未有端到端真实接线测试。
