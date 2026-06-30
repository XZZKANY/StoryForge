# Q6 整书级叙事终检 advisory audit 上下文摘要（2026-06-30）

## 目标

- 在 `audit_report.json` 导出时加入整书级咨询式终检，补足逐章 judge 看不到的跨章涌现问题。
- 终检只做 advisory，不阻断导出；必须区分 `pass`、`needs_review`、`partial`、`unavailable`、`error`，不得把未运行/异常伪装为 clean。

## 已落地

- `apps/api/app/domains/exports/book_markdown_exporter.py`
  - `export_book_run_audit_report()` 新增 `full_book_advisory_audit`。
  - `quality_summary["full_book_advisory_status"]` 投影整书终检状态。
  - 新增检查项：
    - `chapter_count_integrity`：approved 正文章数是否等于 `book_run.total_chapters`。
    - `forbidden_draft_terms`：复用 API judge 的 `FORBIDDEN_DRAFT_TERMS` 扫描整书正文。
    - `repeated_openings`：同一规范化开头出现 3 章及以上时标记 `needs_review`。
    - `story_state_open_items`：有 StoryState 事件源时检查未回收 foreshadow/conflict/countdown/oath；无事件源返回 `unavailable`。
    - `final_chapter_resolution_signal`：最终章缺少正向收束信号时标记 `needs_review`，并避免把 `没结束` / `未结束` 误判为收束。
  - audit 异常返回 `status=error`、`hard_gate=false`、`checks=[]`，不阻断导出。
- `apps/api/tests/test_book_exporter.py`
  - 既有导出测试断言 `full_book_advisory_audit` 存在、`hard_gate=false`、`story_state_open_items=unavailable`。
  - 新增 needs_review 回归：重复开头、`workflow` 系统词、未回收伏笔、最终章未收束时仍成功导出 `audit_report.json`。
  - 新增 unavailable 回归：没有 StoryState 事件时返回 `unavailable`，整书状态为 `partial`，不伪 pass。
- `apps/api/tests/test_book_generation.py`
  - fake provider 正文从“真实模型章节正文”改为“真实章节正文”，避免 Q5 系统词检测命中测试夹具。
  - `_draft_requests()` 排除 StoryState semantic grounding 请求，恢复生成请求计数口径。

## 验证

- `cd apps/api && uv run pytest tests/test_book_exporter.py -q` → 7 passed。
- `cd apps/api && uv run pytest tests/test_book_generation.py::test_book_generation_runs_one_chapter_and_records_evidence tests/test_book_generation.py::test_book_generation_fast_path_runs_semantic_advisory_when_local_gate_passes tests/test_book_generation.py::test_book_generation_resume_continues_after_existing_approved_chapters -q` → 3 passed。
- `cd apps/api && uv run pytest tests/test_book_exporter.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_run_recorded_skill_runs_export.py tests/test_phase9a_deterministic_smoke.py -q` → 61 passed。
- `cd apps/api && uv run ruff check app/domains/exports/book_markdown_exporter.py tests/test_book_exporter.py tests/test_book_generation.py` → All checks passed。

## 环境备注

- 本地 venv 的 `httpcore/_backends/__init__.py` 曾与 RECORD 不一致，导致真实 `httpx` 请求报 `No module named 'trio'`。
- 已用 `cd apps/api && uv pip install --force-reinstall httpcore==1.0.9` 修复本地环境；未改项目依赖。

## 仍未完成

- Q6 不是 Q9，未跑真实 4 万字长程、resume/预算暂停实战演练、人工盲评或 artifact sha256 登记。
- 真正 function/tool-call transport 与更广的跨章语义新维度仍未实现。
- 整书 advisory 的误报/漏报口径仍需 Q9 人工通读校准后再考虑是否升级为更强门禁。
