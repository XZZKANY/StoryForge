# StoryForge P0/P1 修复验证报告

生成时间：2026-06-11 01:18:00 +08:00

## 1. 需求字段完整性

- **目标**：按 P0 安全硬化、P1 可观测性、Provider 错误分类、低风险清理的顺序完成本轮修复。
- **范围**：Web API Key 与 IDE 命令 BFF、下载/导出/预览 `workspace_id` 作用域、ModelRun/BookRun 可观测性、Provider usage 与错误分类、重复 fixture 清理、Studio accept/reject 不持久化提示。
- **交付物**：代码、Alembic 迁移、OpenAPI 契约、shared types、Web/API/Workflow 测试、`.codex/context-summary-p0-p1-hardening.md`、`.codex/operations-log.md`、本验证报告。
- **审查要点**：不引入新认证框架；缺 `workspace_id` 返回 422、错域返回 403、不存在返回 404；`token_usage` 保持兼容；`generate_text()` 保持旧接口；Studio 仅提示本页标记不写回。

## 2. 交付物映射

- `apps/web/lib/api-client.ts`：声明 `server-only`，移除 Web 侧硬编码 `local-dev-key`，缺少 `STORYFORGE_API_KEY` 时抛中文配置错误。
- `apps/web/app/api/ide/commands/[commandId]/route.ts`、`apps/web/components/ide/commands/command-client.ts`：浏览器同源 BFF 调用 IDE command，不再动态导入服务端 API client。
- `apps/api/app/domains/artifacts/*`、`exports/*`、`book_runs/*`、`ide/*`：下载、详情、作品导出、BookRun 导出、IDE 预览均接入 `workspace_id` 作用域校验；IDE preview versions 按工作区过滤。
- `apps/web/app/artifacts/api.ts`、`apps/web/app/book-runs/api.tsx`、`apps/web/app/ide/page.tsx`、`apps/web/components/ide/url/ide-url-state.ts`：前端从已加载元数据或 URL state 传递 `workspace_id`。
- `apps/api/alembic/versions/20260610_0001_add_model_run_observability.py`、ModelRun/BookRun ORM/schema/service：新增 usage、成本、finish reason、错误分类、latency 聚合等观测字段。
- `apps/workflow/storyforge_workflow/provider_client.py`、`runtime/provider_adapter.py`、`runtime/provider_execution.py`、`runtime/runner.py`：保留 `generate_text()`，新增完整 Chat Completion 结果、真实 usage、Retry-After、错误 kind 和 sink payload。
- `apps/workflow/tests/fixtures/quality_cases/*`：删除未引用重复乱码 fixture，保留根目录 `tests/fixtures/quality_cases`。
- `packages/shared/src/contracts/storyforge.openapi.json`、`packages/shared/src/generated/api-types.ts`：已重新生成。

## 3. 本地验证结果

- `pnpm openapi`：通过，已生成 OpenAPI 契约。
- `pnpm --filter @storyforge/shared generate:types`：通过，已生成 shared API types。
- `pnpm --filter @storyforge/web test`：231/231 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `cd apps/api && uv run pytest tests/test_artifacts.py tests/test_exports.py tests/test_book_exporter.py tests/test_ide_artifact_preview.py tests/test_model_runs.py tests/test_book_runs.py tests/test_alembic_heads.py -q`：59 passed，2 warnings。
- `cd apps/workflow && uv run pytest tests/test_provider_adapter.py tests/test_provider_fallback.py tests/test_runtime_runner.py tests/test_model_run_token_tracking.py tests/test_prose_static_check.py -q`：56 passed。
- `pnpm run lint`：退出码 0；Prettier 全部通过；ESLint 有 1 个非阻断 warning，位于 `apps/web/tests/home-page.test.tsx:320`，变量 `shell` 未使用。
- `pnpm run test`：退出码 0；Web 231 passed，shared typecheck 通过，API 536 passed / 1 skipped / 7 warnings，Workflow 258 passed。

## 4. 子代理与审计发现

- 子代理 `Darwin` 执行只读安全旁路审计，不写代码。
- 审计发现一：IDE Artifact Preview 的 versions 查询仅按 `lineage_key`，可能泄露其他工作区同 lineage 版本；已新增测试并修复为按 `resolve_artifact_workspace_id()` 过滤。
- 审计发现二：`GET /api/artifacts/{artifact_id}` 详情端点无 `workspace_id`，下载页相邻读取链路可绕过作用域；已收紧为必填 `workspace_id`，Web 详情读取也传递作用域。
- `Hooke`、`Linnaeus` 为交接摘要中的上一轮子代理，不是本轮新派发的活动 worker。

## 5. 工具与资料来源

- 使用 `sequential-thinking` 与 `shrimp-task-manager.process_thought` 完成问题分解、计划和结论记录。
- 使用 `desktop-commander` 做本地搜索与文件分析；使用 PowerShell/rg 作为补充。
- 使用 Context7 查询 FastAPI required query parameter 与 Next.js BFF / `server-only` 官方文档。
- 使用 `github.search_code` 做开源实现检索；结果参考价值有限，最终以本项目代码模式为主。

## 6. 风险与补偿计划

- `pnpm run lint` 仍报告 1 个 ESLint warning：`apps/web/tests/home-page.test.tsx:320` 未使用变量。该 warning 不影响退出码，且来自相邻测试代码；建议后续清理。
- API 全量测试中有第三方/既有 warning：Alembic `path_separator` deprecation、JWT 测试短 key warning、FastAPI/Starlette 422 常量 deprecation。均未阻断本轮交付，建议单独治理。
- 本轮安全边界仍是用户确认的 `workspace_id` 作用域参数，不等同完整用户级多租户授权；后续如引入用户身份，应在此基础上叠加用户/成员鉴权。

## 7. 评分

- **代码质量**：94/100。改动集中在现有 domain service/router、Web helper 和 workflow adapter，未新增大型框架。
- **测试覆盖**：95/100。覆盖缺参 422、错域 403、正确路径、历史旧契约更新、provider usage/error kind、迁移单 head 和全量测试。
- **规范遵循**：93/100。完成上下文摘要、操作日志、子代理审计、Context7/GitHub/desktop-commander 使用和本地验证；保留一个非阻断 lint warning。
- **需求匹配**：96/100。P0/P1/Provider/清理项均已落地，并额外闭合子代理发现的相邻安全旁路。
- **架构一致**：94/100。复用现有 FastAPI Query、domain service、readJson params、Provider adapter 和 OpenAPI 生成链路。
- **风险评估**：92/100。破坏性 `workspace_id` 契约已通过测试和 OpenAPI/types 显式化，剩余风险已记录。

## 8. 结论

综合评分：94/100。

明确建议：通过。当前实现满足本轮 P0/P1 修复计划，所有关键本地验证已通过；残留 warning 不阻塞交付，但建议进入后续清理队列。

审查结论已留痕，时间戳：2026-06-11 01:18:00 +08:00。

---

## 9. Q2 增量：结构化人工盲评 schema（2026-06-11 续）

- **目标**：闭合审计 §2 唯一剩余的纯代码项 Q2——将 `manual_read_gate` 自由字典升级为受校验的结构化盲评门禁，补上缺失的数值评分表。
- **契约设计**（向后兼容，旧 `manual_read_gate` 保留）：
  - `ManualReadDimensionScore`（`extra="forbid"`）：`dimension`（限定 6 个质量维度集合）、`score`（1–5 整数 Likert）、`comment`（≤500）。
  - `ManualReadReview`（`extra="forbid"`）：`status`(passed/failed/needs_revision)、`reviewer`、`reviewed_chapter_count`、`word_count`、`dimension_scores`（≥1，去重校验）、`overall_score`（缺省按维度均分自动计算）、`conclusion`、`blind`。
  - `BookRunProgressUpdate` 新增 `manual_read_review` 字段；service 写入 `progress["manual_read_review"]`。
  - 将 `manual_read_gate`、`manual_read_review` 纳入 `STICKY_PROGRESS_KEYS`，修复后续 progress patch 不带键即丢失的隐患。
  - exporter 新增盲评评分表投影。
- **收尾修复**：上一轮新增 import 引入两处 ruff `I001`（`exports/book_markdown_exporter.py`、`book_runs/router.py`），经核对 master 干净、属本批引入，已 `ruff --fix` 收口。
- **本地验证**：
  - `cd apps/api && uv run ruff check .`：All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_runs.py tests/test_book_exporter.py tests/test_book_export_epub.py tests/test_exports.py tests/test_model_runs.py -q`：51 passed，1 warning。
  - `node scripts/generate-openapi.mjs` + `pnpm --filter @storyforge/shared generate:types`：契约/types 重新生成，OpenAPI 净新增（ManualRead 盲评 + O1 ModelRun 观测列 + S2 workspace_id），无删除项。
  - `pnpm --filter @storyforge/shared exec tsc --noEmit`：退出码 0。
  - `pnpm --filter @storyforge/web test`：231/231 passed（含新增 IDE command BFF 路由测试）。
  - `pnpm --filter @storyforge/web run lint`（`tsc --noEmit`）：退出码 0。
- **未联通能力**：完整 `pnpm e2e` 的真实 HTTP pytest 需起 docker 服务，本机服务未启动；本轮以 API/web 单元+契约测试与 OpenAPI/types 生成链路覆盖增量。

收尾时间戳：2026-06-11 10:55:00 +08:00。

---

## 13. Narrative Contract Closure Implementation（2026-06-12）

- **目标**：实现 StoryForge 总计划改造 P0/P1 第一批：critic 合同核验、prompt 注入键统一、正文级 narrative extract、fact-based collapse judge、Phase9C contract evidence、commit-time memory/continuity side effects、repetition ledger 参数化。
- **本地验证**：
  - `cd apps/workflow && uv run pytest tests/test_prompt_builder.py tests/test_generation_state_references.py tests/test_narrative_extract.py tests/test_narrative_collapse_and_beat_sheet.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_book_run_adapter.py tests/test_narrative_registries.py tests/test_narrative_plan.py tests/test_book_run_dispatch_payload.py -q`：122 passed。
  - `cd apps/api && uv run pytest tests/test_phase9c_narrative_smoke.py tests/test_phase9b_real_llm_smoke.py tests/test_book_runs.py -q`：45 passed，1 warning（FastAPI/Starlette 422 常量 deprecation）。
  - `cd apps/workflow && uv run ruff check storyforge_workflow/prompts storyforge_workflow/state.py storyforge_workflow/narrative storyforge_workflow/orchestrators tests/test_prompt_builder.py tests/test_narrative_extract.py tests/test_narrative_collapse_and_beat_sheet.py tests/test_book_loop_three_chapters.py tests/test_narrative_registries.py tests/test_narrative_plan.py tests/test_book_run_dispatch_payload.py`：All checks passed。
  - `cd apps/api && uv run ruff check app/domains/book_runs/phase9c_narrative_smoke.py tests/test_phase9c_narrative_smoke.py`：All checks passed。
- **范围说明**：`tests/test_narrative_30ch_regression_fixtures.py` 在当前 worktree 不存在，未纳入本轮命令；`tests/test_phase3_arc_consistency.py` 仍有 3 个基线失败，原因是测试 payload 缺少既有 guard 要求的 `narrative_plan.locked=True`，已由 Task 5 审查确认不是本批改动引入。
- **未联通能力**：未重跑真实 6/15/30 章 narrative smoke；满足本批单元/契约门槛后再执行真实 smoke。
- **下一步**：先跑 6 章 Phase9C narrative smoke，模板章 <=1 且人工抽读通过后进入 15 章。

记录时间戳：2026-06-13 00:23:47 +08:00。

---

## 14. 6 章真实冒烟孤儿 running 诊断 + 中断韧性/超时修复（2026-06-14）

- **诊断对象**：`.codex/narrative-smoke-6ch-20260613-155422/smoke.sqlite`。
- **根因**：进程在第 1 章 `_call_llm`→`urlopen` 阻塞期间被外部中断（KeyboardInterrupt/SystemExit），该 BaseException 不被主循环的 `except Phase9BRealLlmSmokeError` 捕获，直接穿透退出，BookRun 孤儿化在 `running`。
  - 库内事实：`book_runs` 1 行 status=`running` 且 created==updated（2026-06-13 18:10:46，再未更新）；`progress.completed_chapters=[]`；6 个 chapter 全 `planned`；`model_runs=0 / artifacts=0 / tokens_used=0`；产物目录无 `book.md/summary.json/audit_report.json/gate-results.json`。
  - 反证：任何 `_call_llm` 失败都会走 `_pause_by_failure` 写 `status=failed`，但库里仍是 `running`，故只能是 BaseException 穿透。
  - 诱因：`_call_llm` 超时默认 60s，短于 mimo reasoning 模型实际延迟（provider config `timeout_seconds=300`），首 token 迟迟不来易被人工 Ctrl-C。
- **改动**（`apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`）：
  - 新增 `_pause_by_interrupt`：中断时 rollback 后落 `status=paused_by_user` + 已完成证据 + `pause_reason`，再 re-raise。
  - `run_phase9b_real_llm_smoke` 主循环与 `resume_phase9b_real_llm_smoke` 续跑循环各加 `except (KeyboardInterrupt, SystemExit)` 兜底，杜绝孤儿 `running`。
  - `_call_llm` 默认超时 60s → 300s，对齐 mimo。
- **本地验证**：
  - 新增 `tests/test_phase9b_real_llm_smoke.py::test_phase9b_real_llm_smoke_interrupt_marks_paused_not_orphan_running`：monkeypatch `_generate_chapter` 抛 KeyboardInterrupt，断言 BookRun 落 `paused_by_user`、`current_chapter_index=1`、`completed_chapters=[]`、pause_reason 含「中断」。
  - `cd apps/api && uv run pytest tests/test_phase9b_real_llm_smoke.py -q`：20 passed。
  - `cd apps/api && uv run ruff check app/domains/book_runs/phase9b_real_llm_smoke.py tests/test_phase9b_real_llm_smoke.py`：All checks passed。
- **未联通能力**：本轮纯本地逻辑/配置改动，未接真实 LLM。下一步需 export `STORYFORGE_LLM_*` 凭证后跑 `run-real-llm-single-shot-probe.py` 确认 mimo 存活与真实 latency，再重发 6 章。

记录时间戳：2026-06-14 +08:00。

---

## 15. 探针确认 mimo + 6 章重发跑通 + S3 导出降级修复（2026-06-14）

- **探针**：`run-real-llm-single-shot-probe.py`（同款 full-chapter prompt 打 mimo-v2.5-pro）→ `probe_verdict: ok`，`latency_ms=47238`（单发草稿 47.2s，completion_tokens=1807）。印证旧 60s 默认超时余量不足，改 300s 必要。
- **6 章重发**（`.codex/narrative-smoke-6ch-20260614-134425/`，独立 sqlite + judge 模型对齐 mimo）：
  - 生成端到端跑通，零卡死（上次卡死在第 1 章，本次顺至第 6 章）：`book_run=completed`、6/6 章、`scenes=6`、`model_runs=6`、`judge_issues=6`、tokens_used=18584。
  - 语义 Judge 全 6 章 pass（一致性/文风无问题）。
  - **字数硬门禁真实生效**：蓝图区间 600–1000 字，mimo 实际写 CH1 1123 / CH3 2102 / CH4 2132 / CH5 1363 / CH6 1329（全超上限）→ 被 `_apply_word_count_floor` 压到阈值下 → `needs_revision`；仅 CH2（839 字）在区间内 → 唯一 `approved`。`repair_patches=0`（repair 不修篇幅）。
- **S3 导出降级 bug**：原 run 在 `export_book_run_markdown` 崩于 `NoSuchBucket`（本地无 MinIO）。`book_markdown_exporter.py` 注释承诺「S3 失败回退 memory://」，但 `s3_client.upload_bytes` 遇上传异常直接 `raise S3UploadError`，与 docstring（「失败返回 None」）不符。
  - 改动：`upload_bytes` 上传失败改为 `_logger.exception` + `return None`，兑现 docstring 契约，三处导出调用点（md/audit/epub）一次性受益；回退为 memory:// 内联真实正文，非假数据。
  - 测试：新增 `tests/test_artifact_s3_export.py::test_export_falls_back_to_memory_when_upload_raises`（put_object 抛 NoSuchBucket → 断言 memory:// 回退），补上原测试漏掉的「client 可用但上传失败」分支。
- **重导出**（`reexport.py`，不重跑生成）：从现有 sqlite 导出 → `markdown_uri=memory://...`、`gate=PASS`。产出 book.md/audit_report.json/gate-results.json/summary.json。`exported_chapter_count=1`（exporter 只导 approved 场景，故 book.md 仅 CH2，839 字，叙事 gate pass）。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_artifact_s3_export.py tests/test_exports.py tests/test_phase9b_real_llm_smoke.py -q`：32 passed。
  - `cd apps/api && uv run ruff check app/common/s3_client.py app/domains/exports/book_markdown_exporter.py tests/test_artifact_s3_export.py`：All checks passed。
- **未联通能力 / 下一步**：mimo 系统性超字数（600–1000 区间对其偏紧），6 章中 5 章因篇幅被拒批——需要么放宽蓝图字数区间匹配模型实际输出，要么让 repair 能针对篇幅收敛；本轮未动。S3 真实路径（起 MinIO + 建 bucket）未验证，仅验证降级回退。

记录时间戳：2026-06-14 +08:00。

---

## 16. 字数上限改失控护栏 → 首次 6/6 approved 端到端跑通（2026-06-14）

- **根因订正**：放宽字数区间（600–1000 → 1000–2200）后重跑，mimo 仍系统性超上限（实测 2346–4126 字），且越往后越长（recap 累积）。抽读 CH3（4126 字）确认是密实好正文（具体动作/感官细节/审计链推进/角色一致性），非注水。结论：mimo 不遵守 prompt 字数上限，固定上限是与模型天性对着干的错误约束目标；探针另证关思考反而更糟（reasoning_effort=low → 空返回，1050/1052 token 全耗在 reasoning）。
- **改动**（`phase9b_real_llm_smoke.py`）：
  - 新增常量 `WORD_COUNT_CEILING_RUNAWAY_FACTOR = 2.5`。
  - `_apply_word_count_floor`：下限仍硬拒（防截断/太短）；上限从「蓝图目标值直接拒批」改为「目标上限 × 2.5 的失控线」，只拦无限重复/明显失控，放过「质量 pass 但偏长」。
- **测试**：新增 `test_word_count_floor_over_target_within_runaway_factor_passes`（超目标上限、在失控线内 → score=100 通过）+ `test_word_count_floor_caps_score_for_runaway_chapter`（超失控线 → 压分拒批，保留护栏）。
- **重跑验证**（`.codex/narrative-smoke-6ch-20260614-144438/`，区间 1000–2200 → 失控线 5500）：
  - `book_run=completed`、tokens=47290、耗时 520s。
  - **6/6 章全部 approved**（字数 1892/3248/4637/4024/3800/3019，均 < 5500 失控线）。
  - 导出成功（S3 降级回退 memory://）：`book.md` 含全部 6 章、60482 字符；`audit_report.json` 落库；叙事 gate PASS。
  - 这是产品首次端到端产出一本「6 章全批准 + 已导出」的书。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_phase9b_real_llm_smoke.py -q`：22 passed（含 2 个新护栏测试）。
  - `cd apps/api && uv run ruff check app/domains/book_runs/phase9b_real_llm_smoke.py tests/test_phase9b_real_llm_smoke.py`：All checks passed。
- **未联通能力 / 下一步**：护栏倍数 2.5 是经验值，更长篇（15/30 章）recap 持续累积时单章是否继续膨胀至触线，需更长跑验证；repair 仍不修篇幅；S3 真实路径仍未起 MinIO 验证。

记录时间戳：2026-06-14 +08:00。

---

## 17. 15 章长跑：15/15 approved，但护栏被 recap 膨胀逼到墙角（2026-06-14）

- **配置**：区间 1000–2200（失控线 5500）、token_budget 30 万、max_chapter_count 20（run.py 补 `SMOKE_MAX_CHAPTER_COUNT` 参数透传，否则默认 10 拦 15 章）。产物 `.codex/narrative-smoke-15ch-20260614-151502/`。
- **结果**：`book_run=completed`、tokens=138317、耗时 1357s（22.6 min）、**15/15 全 approved**、book.md ~16.6 万字符、audit 落库、叙事 gate PASS。
- **关键趋势（待解）**：单章字数随章数膨胀，CH13=5012、CH14=5129，距失控线 5500 仅 371–488 字。token_usage CH1 3218 → CH14 11914（×3.7），而正文字数 2733 → 5129（×1.9）——差额来自 recap 累积，prompt 膨胀带动输出膨胀。15 章勉强全过，**固定倍数 2.5 的失控线与"随章数线性上涨的单章字数"两条线即将相交，30 章后段极可能误判失控**。
- **判断**：`WORD_COUNT_CEILING_RUNAWAY_FACTOR` 固定倍数对长篇不够 robust。可选方向（未实施，待定）：(a) 失控线随章数/recap 规模放宽；(b) 去掉字数上限只留下限，失控改由重复检测兜底；(c) 收敛 recap 规模（压 prompt 膨胀，从源头抑制输出膨胀，治本）。
- **本地验证**：本轮无代码改动（仅 run.py 加 `max_chapter_count` 透传参数），沿用第 16 节已测护栏逻辑。
- **未联通能力 / 下一步**：30 章未跑（按当前趋势预计后段触线）；repair 仍不修篇幅；S3 真实路径未验。

记录时间戳：2026-06-14 +08:00。

## 18. 方案 c：收敛 recap 注入预算（治本，纠正"recap 无限膨胀"误判）（2026-06-14）

- **背景**：第 17 节判断 prompt 膨胀带动输出膨胀，选方案 c 收敛 recap。本节先做诚实诊断，结论与第 17 节的直觉有出入。
- **真实路径定位**：smoke runner 的 `_generate_chapter` 走 `assemble_prompt_injection(chapter_ordinal=...)` → `BookContext.compile_blocks_for_chapter(full_chapters=2, token_budget=2000)`，**不是** `_prior_chapters_recap`（后者在本路径是死代码）。
- **诊断纠偏（带 DB 实证）**：
  - 查 `.codex/narrative-smoke-15ch-.../smoke.sqlite`：`memory_atoms=1`、`continuity_records=0` → **continuity_facts 不是膨胀源**，排除"记忆原子无限累积"假设。
  - recap 走 `compile_blocks_for_chapter`，**早已被 `token_budget=2000` 钳住**（≈2000 token ≈ 12000 字符），并非"无限膨胀"。`model_runs.input_summary` 长度 CH1 1411 → CH4 ~8800 → 后续在 8000–12000 区间**振荡**（非单调线性增长），即 recap 快速顶到预算上限后在天花板附近波动。
  - 一度想改的 `book_context.py` 回退系数 `token_budget * 6`：经核 `scene_packets/budget.py::estimate_tokens = (len+5)//6`（6 字符/token），`*6` 与该 token 模型**一致**，且真实章长仅 500–834 token/章，`compile_context` 成功、**回退分支根本不触发**。故已 **revert** 对 book_context.py 的改动（误判的杠杆）。
- **真正的杠杆**：recap 长期顶满 2000 token 预算（占 prompt 大头：15 章 prompt 88944 token vs completion 49373 token），且注入「2 整章原文」充当**长度范例**，系统性诱导模型越写越长。
- **改动**（`prompt_assembly.py`）：抽常量 `_RECAP_FULL_CHAPTERS=1`、`_RECAP_TOKEN_BUDGET=1200`（原 2、2000）。只保留紧邻上一章完整原文（续写连续性的真正所需），更早章节降级为 digest 梗概行。效果：recap 上限 ≈12000 → ≈7200 字符（−40%），并移除「两整章范例」压力。
- **本地验证**：`uv run pytest tests/test_prompt_assembly.py tests/test_book_context_cache.py tests/test_phase1_context_optimization_verify.py tests/test_phase9b_real_llm_smoke.py -q` → **49 passed, 1 skipped**。
  - 新增回归 `test_assemble_recap_stays_bounded_across_long_run`：45 章长正文场景，ord=30 与 ord=45 两个饱和点位 recap 长度差 ≤50（收敛、不随章数膨胀），且只含 1 章完整原文（full_chapters=1）。
- **未联通能力 / 下一步**：本节只压了 prompt 侧；输出字数是否随之下降是**经验问题，需真实长跑验证**（未跑）。30 章长跑、repair 修篇幅、S3 真实路径仍未验。

记录时间戳：2026-06-14 +08:00。

## 19. 30 章长跑验证方案 c：prompt 收敛证实，但暴露 CH9 失控未修 + 计数失真两个新问题（2026-06-14）

- **配置**：30 章、band 1000–2200（失控线 5500）、token_budget 60 万、mimo-v2.5-pro（judge 同模型）。产物 `.codex/narrative-smoke-30ch-20260614-171554/`。
- **结果**：`book_run=completed`、30/30 章节落库 approved（**除 CH9**）、tokens=205279、book.md 9.1 万字符、耗时约 40 min。

**✅ 方案 c 主目标证实（prompt 收敛 + 输出不再随章数膨胀）：**
- **prompt token 不再随章数爬升**：CH1 865 → CH8 3321 → CH15 2873 → CH30 4390，全程在 ~3000–4800 区间**平稳振荡**，无 15 章那次单调上爬到 ~11000 的趋势。
- **每章均摊 prompt token：3769**（vs 15 章那次 88944/15=**5930**，−36%）。
- **单章字数全面回落**：29 个 approved 章节 content 1731–4809 字符，**无一逼近失控线 5500**；对比 15 章那次 CH13=5012、CH14=5129 已贴墙。systematic 越写越长的趋势被消除。

**⚠️ 暴露的新问题（诚实记录，未修）：**
1. **CH9 失控 5912 字 → 护栏正确拒批，但 repair 没修**：CH9 草稿 5912 字 > 失控线 5500，`_apply_word_count_floor` 把 score 压到 69（<70）、标 `word_count_violation`。但 `repair_rounds=0` —— 根因：`_apply_word_count_floor` 在 `_judge_and_repair_loop` **循环结束后**才施加（960 行），而语义 judge 在循环内给的是高分、提前 break，导致字数违规**从未进入 repair 输入**。结果 scene 停 `needs_revision`、chapter 停 `planned`、导出被排除。**护栏判得对，但修复链对"篇幅违规"是断的。**
2. **计数失真**：`actual_chapter_count=30`、`failure_count=0`，但 book.md 只有 29 章（缺 CH9）。runner 把"已处理 30 章"等同"已产出 30 章"，未把 CH9 的未批准surfaced 成 failure，**对前端/审计是误导**。
3. **叙事 gate FAILED（与篇幅无关）**：`collapse_judge` 把 CH3、CH4 标 `template_chapters`（phase9c 叙事质量启发式），`beat_fulfillment=unknown`。这是内容套路化问题，独立于本次篇幅治理，单列。

- **本地验证**：本轮无代码改动（沿用第 18 节 prompt_assembly 收敛）；问题 1/2/3 均为长跑暴露、待定方案。
- **下一步候选**：(1) 把字数违规并入 repair 循环输入（让 repair 真去压缩失控章）；(2) runner 区分"处理数"与"产出数"，未批准章 surfaced 成 failure；(3) collapse_judge 套路化单独处置。

记录时间戳：2026-06-14 +08:00。

## 20. 修复计数失真：区分"处理章数"与"产出章数"（第 19 节问题 2）（2026-06-14）

- **问题**：30 章长跑 `summary.json` 报 `actual_chapter_count=30`、`failure_count=0`，但 CH9 失控被拒批、book.md 只有 29 章 —— runner 把"已处理"等同"已产出"，丢章不 surfaced，违反 CLAUDE.md「不创建假数据兜底」。
- **为何不先做"repair 修篇幅"（候选 1）**：repair 是 **span 替换**架构（`_maybe_repair` → `create_repair_patch` 产出 span_start/end + replacement_text），擅长替换局部违规文字；而"压缩整章 5912→5500"是全局重写，架构对不上，且 mimo 已被实证无视字数上限——让 repair 修篇幅是跟模型本性硬顶，高风险，单独立项。本节先做低风险、直击数据诚信的候选 2。
- **改动**（`phase9b_real_llm_smoke.py`）：
  - 新增纯函数 `_count_approved_chapters(completed_chapters)`：按每章已记录的 `approved` bool 汇总真实产出数（该 bool 本就在 `completed_chapters` 里，只是没被汇总暴露）。
  - `Phase9BRealLlmSmokeResult` 加字段 `approved_chapter_count`；主 run + resume 的 3 个返回点（含 already-completed 早返回，用 `_reconstruct_completed_chapters` 重建）均填真实批准数。
  - run.py 模板：`summary.json` 增 `approved_chapter_count`，`failure_count` 由写死 0 改为 `target − approved`。
- **本地验证**：`uv run pytest tests/test_phase9b_real_llm_smoke.py tests/test_prompt_assembly.py tests/test_book_context_cache.py -q` → **51 passed**；`ruff check` 通过。
  - 新增 `test_count_approved_chapters_excludes_unapproved`（处理 4 章、批准 3 章 → 计数 3，处理数仍 4）、`test_count_approved_chapters_empty_is_zero`。
  - 顺带修一处**测试隔离缺陷**（本次新增收敛测试暴露）：`book_context._context_cache` 是模块级按 book_id 缓存，跨测试 DB 重置后 id 复用导致串读他测试的章；在 `test_assemble_recap_stays_bounded_across_long_run` 起始 `clear_book_context_cache()`，phase9b 先跑也稳定通过。
- **未联通能力 / 下一步**：候选 1（repair 修篇幅）、候选 3（collapse_judge 套路化）仍未做；本节只让计数不再说谎，未改变"失控章会被丢"这一行为本身。

记录时间戳：2026-06-14 +08:00。

## 21. 修复 collapse_judge 套路化误报（第 19 节问题 3）（2026-06-14）

- **先核实再动手**：把 30 章被标 `template_chapters=[3,4]` 的 CH3/CH4 整章读完——**是误报，不是真套路化**。两章均为 ~3000 字扎实侦查推进：CH3 采集七号浮标物证、序列号"指向同一批次"、时间戳 17:09/18:47；CH4 推算"差额二十八块电路板"、发现无标识快艇、引入新实体鸿海精密/王建国。
- **根因**：`_chapter_template_fact` 判 `is_template = 命中≥3 动作桶 且 无结构性保护`。动作桶用「回到/推开/比对/记录/转身离开」等**高频动词**，任何长篇散文都会堆叠命中；而"结构性保护"只认 4 个窄词表（cost/relationship/irreversible/clue_reinterpret），真章用表外同义表达（"对得上"/"一致"/"差额"）就被漏判 → 纯因含常见动词被打成套路。
- **改动**（`phase9c_narrative_smoke.py`）：新增 `_concrete_detail_signals` 具体性维度——多个数字证据（≥3 个数字）/ 时间戳（`\d{1,2}[:：]\d{2}`）/ 直接引语（≥2 个引号）任一命中即视为"不可互换的实写正文"。判套路加一档条件：`动作桶≥3 且 无剧情推进 且 无具体锚点`。套路骨架（"林岚来到X，询问Y，查看Z…"）抽象无数字无对话，仍被正确判 True。
- **本地验证**：
  - 真 30 章 book.md 整本重判 → **status=pass、template_chapters=[]**，CH3/CH4 三个具体性信号全中、`is_template=False`。
  - 测试里 3 个套路样本（短句占位骨架）`concrete_detail=[]`、仍判 `is_template=True`，未被新豁免误放。
  - `uv run pytest tests/test_phase9c_narrative_smoke.py -q` → **8 passed**（原 7 + 新增回归 `test_phase9c_does_not_flag_concrete_investigation_chapter_with_action_verbs`）；`ruff` 通过。
- **边界**：这是启发式 gate，非语义评审；本节只消除"含动作动词的实写章"这一类系统性误报，不声称能识别一切套路化。真正的套路化（重复骨架 + 空洞）仍被拦。
- **下一步候选**：仅剩候选 1（repair 修篇幅，span 架构 vs 全局重写，需单独设计）；S3 真实路径、HTTP+LangGraph 生产消费者仍未做。

记录时间戳：2026-06-14 +08:00。

## 22. S3 真路径闭环 + 确定性 golden 回测基准（2026-06-14）

- **背景与范围裁定**：用户要求"补全 HTTP→LangGraph→S3 全链路 + 建回测基准"。调研后做了现实校正并经用户确认收敛范围：
  - **HTTP→生成→导出 已是可工作消费者**：`POST /api/book-runs/{id}/start` → FastAPI BackgroundTasks → `resume_phase9b_real_llm_smoke` → 同一套导出器（封顶 6 章）。不需新建。
  - **LangGraph 那套（generation_graph/NovelLoop/BookLoop/runner）应用代码零消费者**，接它是周级高风险改写（跨进程 worker/queue、ModelRun adapter 注入、checkpoint 对账），且**不在"建回测基准"的关键路径上**——经用户拍板**搁置**。
  - **S3 client 不缺**：boto3 已声明并 lock（1.43.29），upload+presigned+4 个单测齐全。真正断点只有一个：**MinIO/S3 默认不自建 bucket → `put_object` 抛 NoSuchBucket → 一路回退 memory://**。

- **Part A — S3 真路径闭环**：
  - `s3_client.py` 新增 `_ensure_bucket`（head_bucket 探测 → 不存在则 create_bucket，幂等；失败不致命，留给 upload 回退）。放 client 层而非仅 compose init——**CLI 冒烟不经 compose，只有 client 层能同时覆盖 compose + CLI 两条路**。在 `get_s3_client` 初始化成功后调一次。
  - `docker-compose.yml` 加 `minio-init` 容器（minio/mc，`mc mb --ignore-existing`）作双保险；`docker compose config` 校验通过。
  - **真实 MinIO 实跑验证（非降级）**：本机 MinIO 在线，`STORYFORGE_S3_INTEGRATION=1` 跑 `test_s3_integration.py` → **2 passed**：ensure_bucket 建桶 → upload_bytes 落 `s3://storyforge/...` → presigned URL → urllib HTTP GET 取回字节**往返一致**；ensure_bucket 连调两次幂等。端到端再验：`get_s3_client()`（含 ensure_bucket）→ 导出落 `s3://` → presigned 可生成，全部 True。
  - 新增 3 个 `_ensure_bucket` 单测（建桶/跳过/吞异常）；集成测试默认 skip（`@pytest.mark.integration` + env gate，pyproject 注册 marker）。

- **Part B — 确定性 golden 回测基准（用户选"冻结 book.md 快照"）**：
  - 冻结基准 `apps/api/tests/golden/novel_baseline/`：30 章真实导出 `book.md`（268KB、29 章，CH9 失控被门禁正确剔除——这一缺位是基准的一部分）+ `expected_gate.json`（确定性快照）+ README。
  - 新增回测器 `golden_regression.py`（纯函数，零 LLM/随机/DB）：book.md → `_auto_gate_results_from_book_export` + `_parse_markdown_chapters` → 与 expected 逐字段 diff（collapse 结论 / 套路化章 / 章序号完整性 / 每章字数）→ pass/fail + 偏差明细。带 `__main__` CLI（无回归 exit 0、有回归 exit 1，便于 CI 卡阈值）。
  - 回测单测 `test_golden_regression.py` → **4 passed**：基准零回归；**注入套路化章变体被抓到**（collapse 翻转）；**删章变体被抓到**（章缺失）；评分确定性（两次全等）。
  - CLI 入口：`scripts/run-golden.mjs` + `package.json` 的 `pnpm golden`，跑通 exit 0。

- **本地验证**：本程涉及的全部套件 `uv run pytest tests/test_artifact_s3_export.py tests/test_s3_integration.py tests/test_golden_regression.py tests/test_phase9c_narrative_smoke.py tests/test_prompt_assembly.py tests/test_book_context_cache.py tests/test_phase9b_real_llm_smoke.py -q` → **71 passed, 2 skipped**；ruff 全过。
  - 全量 `uv run pytest` 有 1 个**预先存在、与本程无关**的失败 `test_phase9_fact_sources::...roles_are_converged`——它断言 README.md 含某收敛字符串，而该串在 git HEAD 的 README 就缺失（`git show HEAD:README.md | grep` 得 0），本程未碰任何 README/docs。

- **未联通能力 / 下一步**：LangGraph 生产消费者（搁置，需周级专项）；repair 修篇幅（候选 1，未做）；CI 自动触发与 golden 阈值门禁（本程只接好 `pnpm golden` 入口，未改 CI 触发器，CI 仍 workflow_dispatch 手动）；minio-init 容器未在真实 `docker compose up` 端到端验证（仅校验 config 语法 + 代码层 ensure_bucket 已对真 MinIO 验通）。

记录时间戳：2026-06-14 +08:00。

## 23. 命名正名：phase9b/9c 历史阶段名 → 业务语义名（2026-06-14）

- **动机**：`phase9b_real_llm_smoke`（"9B 阶段冒烟测试"）实为唯一在用的长篇生成主路径，`phase9c_narrative_smoke` 实为叙事门禁/collapse 判定。名字按路线图阶段号起，与职责无关，每次引用都得先解释"它其实不是冒烟测试"。经用户拍板正名为 **book_generation 系**（落 book_runs 域）。
- **命名决议（用户选 book_generation 系）**：
  - `phase9b_real_llm_smoke.py` → `book_generation.py`；`run/resume/missing_phase9b_real_llm_*` → `run_book_generation` / `resume_book_generation` / `missing_book_generation_env`；`Phase9BRealLlmSmoke{Result,Error,PreflightError}` → `BookGeneration{Result,Error,PreflightError}`。
  - `phase9c_narrative_smoke.py` → `narrative_gate.py`。
  - `phase9b_parallel_ports.py` → `book_generation_parallel.py`；`run_phase9b_real_llm_parallel` → `run_book_generation_parallel`。
  - 8 个 `test_phase9b_*/test_phase9c_*` 测试文件随同 `git mv` 改名（保留 git 历史）。
- **持久化字符串：冻结不改（用户拍板）**。落库/进 progress JSON 的值原样保留——`issue_type="phase9b_real_judge_pass"`（resume 靠它过滤 judge 证据，改名会让旧 run 续跑找不到证据）、`"mode": "phase9b_real_llm_smoke"`、`"metric_scope": "phase9b_direct_smoke_serial"`、`"memory_recall_budget_scope": "phase9b_parallel_story_memory_recall"`、`"runner": "phase9b_parallel_workflow"`。**代码符号全部正名，落库值保持兼容，旧 run resume 不受影响，零数据迁移。**
- **碰撞防护（关键）**：token `phase9b_real_llm_smoke` 既是模块路径（要改）又是 `"phase9b_real_llm_smoke"` 持久串（不能改），文本一字不差。重命名脚本用**锚点区分**：模块路径替换只对 `(?<=\.)phase9b_real_llm_smoke`（点号前缀）生效，绝不碰裸引号串；其余符号都是全 token 唯一（`\b` 边界），与任何持久串无交集。
- **碰撞防护的实证校验**：
  - 改名后 diff 中**被删除的含冻结串的行为 0**（`git diff -- '**/*.py' | grep '^-' | grep <5 个冻结串>` → 无匹配），证明 5 个冻结串逐字节未动。
  - 模块路径残留引用清零（grep 旧名 → 排除冻结串后 0 命中）。脚本漏掉的 1 处 `import phase9b_real_llm_smoke as smoke`（空格前缀，锚点正确跳过）单独手修。
- **范围边界（冻结历史不动）**：`.codex/` 的时间戳跑批产物（audit_report.json 等）、`docs/superpowers/plans|specs/` 的日期化设计文档属冻结证据，**不改**（改了即篡改历史）。仅更新**可运行的** CLI 命令文档（README.md / current-phase.md / TODO.md / local-start.md 里的 `python -m ...phase9b_real_llm_smoke` → `...book_generation`，否则命令直接失效）+ golden README 的纯函数引用。
- **本地验证**：受影响 9 套件 `uv run pytest` → **80 passed**；全量 `uv run pytest` → **580 passed, 3 skipped, 1 failed**——失败为 §22 已记录的预存项 `test_phase9_fact_sources::...roles_are_converged`（断言 README 含某收敛串，HEAD README 即缺失，与本程无关）。改名后 CLI `python -m app.domains.book_runs.book_generation --help` exit 0；`pnpm golden` exit 0。我改名的文件 ruff 全过；service.py 的 `F401 os`/`UP017` 为**前序会话遗留的未提交改动**（BackgroundTasks+SessionLocal，103 行纯新增）自带，非本次重命名引入，按"不顺手重构"留置。
- **未联通 / 下一步**：模块/函数/类的**展示性描述串**仍是旧语义——docstring 与 `--help` 仍写"Phase 9B 真实 LLM 冒烟"，内部 helper 名仍带 `_smoke`（`_create_smoke_book` 等）。这是"冒烟/smoke"词汇层的语义清洗，比本次符号重命名更大，**未做**，待用户决定是否一并清洗。（→ 已在 §24 完成。）

记录时间戳：2026-06-14 +08:00。

## 24. 词汇层语义清洗：扫掉"冒烟/Phase 9B/9C"展示串与 _smoke 内部符号（2026-06-14）

承 §23：符号正名后，docstring/`--help`/注释/内部 helper 名仍写"Phase 9B 真实 LLM 冒烟"——名字正了但描述还在撒谎。本节按用户"一并扫掉"指示完成词汇层清洗。

- **三类边界（清洗前先分类，红线优先）**：
  - **冻结（外部契约/持久值，一字不动）**：① 环境变量名 `STORYFORGE_LLM_SMOKE_*`（4 处：FAST_JUDGE / TIME_BUDGET_SECONDS / RECAP_FULL_CHAPTERS——用户在 shell 里 export，改名直接破坏其配置）；② 持久值 `"mode": "phase9b_real_llm_smoke"` / `"metric_scope": "phase9b_direct_smoke_serial"` 及 progress key `"real_llm_smoke"`（§23 已冻结，落库/进 progress JSON）。
  - **重命名（内部符号，安全）**：`_create_smoke_book`→`_create_generation_book`；`_smoke_planning_arcs`→`_default_planning_arcs`；`_direct_smoke_integration_metrics`→`_serial_integration_metrics`；并发模块别名 `import book_generation as smoke`→`as generation`（连带 `smoke.` 调用前缀全改）。同步改测试里的 import 与 `monkeypatch.setattr` 字符串路径。
  - **清洗（展示串，本节核心）**：docstring、`argparse description`、`--help`、错误消息标签、章节/书名 title seed、注释里的"冒烟/Phase 9B/Phase9C"→"整书生成/真实 LLM 生成"等业务语义。
- **断言安全**：清洗只改语义标签，保留测试 `match=` 的功能子串（`"只允许 1 到 10 章"`、`"并发度必须大于 1"`、env 变量名等原样）。
- **范围排除（核实后留置）**：
  - `deterministic_smoke.py` 全仓零 importer，且此处"smoke"是**准确**的（确定性无 LLM 测试夹具，名副其实），不在"撒谎"清洗范围，**不动**。
  - packet key `"真实 LLM 冒烟": True`（line 918）核实 studio 等下游只读 `"证据链接"`，无消费者——可清洗，已随展示串改。
  - golden `expected_gate.json` 核实**不锁标题文本**，冻结 `book.md` 永不从源码再生，故 title seed 清洗对 golden 零影响。
- **测试名一并正名**：31 个 `test_phase9b_*/test_phase9c_*` 函数名 + `_Phase9BChatHandler` 类名 + alembic 测试名 → `test_book_generation_*` / `test_narrative_gate_*` / `_BookGenerationChatHandler`（纯 pytest 标识符，无契约）。
- **验证**：
  - 冻结串终检 `2/2/1/1/1`（仅 `*.py` 源码计），与 §23 收尾一致——清洗未动任何冻结值；`STORYFORGE_LLM_SMOKE` env 变量计数 `4` 原样保留。
  - 残留展示性"冒烟/Phase9"清零（grep 排除冻结串后 0 命中）；旧 helper 名残留清零。
  - 受影响 11 套件 `uv run pytest` → **90 passed**；全量 `uv run pytest` → **580 passed, 3 skipped, 1 failed**（同 §22/§23 预存的 `test_phase9_fact_sources`，与本程无关）。
  - 改名/清洗文件 ruff 全过；`python -m app.domains.book_runs.book_generation --help` 输出"运行 StoryForge 真实 LLM 整书生成"（旧串"Phase 9B 真实 LLM 冒烟"已消失）；`pnpm golden` exit 0、无回归。
- **未联通 / 下一步**：repair 修篇幅（候选 1，仍未做）；service.py 的 `F401 os`/`UP017`（§23 记录的前序会话未提交改动自带，非本程引入，留置）。

记录时间戳：2026-06-14 +08:00。

## §25 修复 reasoning token 泄漏进成稿（`_call_llm` 思维链剥离）

承"接 repair 修篇幅收益大吗"——三轮真实证据扒数据后**否决了修篇幅**，反向定位到一个真 P0。

- **数据驱动的判断（先扒再定，不拍脑袋）**：
  - 扒 `.codex/*/summary.json` 共 22 次真实 run、208 章的 `per_chapter_char_counts`：**短章（< floor）仅 1/208 = 0.5%**——repair 修篇幅（补短）是在修一个几乎不发生的问题，**不值得做**。超长（> 上限×2.5 失控线）9/208 = 4.3%。
  - 逐章翻超长样本，最极端的 `real-llm-35k-resume` 第29章（7091字）暴露真因：正文里**裸泄 `</think>` 思维链结束标记**，且标记前后是同一段故事写了两遍（推理草稿 + 重写正文都进了成稿）→ 既污染成稿又撑爆字数，被篇幅护栏误判成"失控"但**没诊断出真因**。
- **根因**：`book_generation.py::_call_llm` 取 `data["choices"][0]["message"]["content"]` 后**只 `.strip()`，无任何思维链剥离**。mimo 等推理模型在部分返回风格下把 `<think>…</think>` 混进 content，整段裸泄。串行 + 并行两条路径共用此函数（并行经 `generation._generate_chapter` → `_call_llm`），改一处即覆盖两路。
- **修复**：新增 `_strip_reasoning_leak(content)` + 三个正则常量（`THINK_BLOCK_RE`/`THINK_OPEN_RE`/`THINK_CLOSE_RE`）。逻辑：① 成对 `<think>…</think>` 整段删除；② 残留闭合标签（第29章那种开标签被上游吞掉的残体）→ 丢弃最后一个 `</think>` 及其之前全部内容，只留其后正文；③ 孤立开标签抹除。`_call_llm` 在原"空返回"检查后调用它，并新增"剥离后为空"硬错误（仅思维链无正文 → 抛 `BookGenerationError`，不静默放过），剥离发生时打 stderr 计数日志。
- **不碰**：DB / OpenAPI 契约 / 持久值 / 冻结证据（`.codex/` run 产物只读取统计、未改）全部未动。
- **验证**：
  - 新增 5 个纯函数单测（成对标记 / 残缺闭合标签 / 多闭合标签取末段 / 干净正文保真 / 孤立开标签）→ 全过。
  - **真实证据回归**：把第29章 7363 字泄漏原文喂入 `_strip_reasoning_leak` → 输出 3681 字、`</think>` 消失、保留末段冲锋舟正文。即此修复同时消除「标记污染」与「字数翻倍→误判失控」两个连带症状。
  - `tests/test_book_generation.py` + `test_book_generation_parallel.py` → **40 passed**；改动文件 ruff 全过。
  - 全量 `uv run pytest` → **585 passed, 3 skipped, 1 failed**（仍为预存的 `test_phase9_fact_sources`，属前序未提交 BackgroundTasks 工作，与本程零交集——已 `git diff` 确认 fact_sources 域无本程改动）。
- **未联通 / 下一步**：超长 4.3% 中除第29章外的 8 章（4083-4749字）尚未逐章确认是「密实好正文」还是「真注水」——若要进一步收紧护栏需先做这个采样；repair 修篇幅经本程数据论证为低收益，除非短章率随更大规模 run 上升，否则不安排。

记录时间戳：2026-06-14 +08:00。

---

# Desktop 项目工作台 UI 对齐（cursor-like plan Stage 2）

生成时间：2026-06-15 +08:00

## 目标与范围

- 依据 `docs/architecture/cursor-like-project-workbench-ui-plan.md`，把 Desktop IDE 主体验从旧布局
  `文件树(左) | 编辑器(中) | Assistant(右)` 改为方案三栏：
  `项目(左) | AI 交互(中) | 文件工作区[文件树 + 编辑器](右)`。
- Stage 1（Web 原型）此前已收口：`apps/web/components/ide/prototypes/StoryForgeWorkbenchPrototype.tsx`
  已是三栏 + 三焦点模式，本程不再投入 Web。

## 交付物

- `apps/desktop/frontend/src/components/ProjectPanel.tsx`：新增左侧"项目"面板。项目列表为用户真实打开过的本地目录
  （localStorage `recent-projects`），名称取目录 basename、副标题为真实路径，不伪造"长篇/修订中"状态标签。
  保留 `#open-project-btn` / `data-testid=open-project`（菜单 `menu:open-project` 与冒烟依赖）。
- `apps/desktop/frontend/src/App.tsx`：重写为三栏布局，项目/当前文件状态上提到 App；右侧文件工作区内嵌
  可调宽文件树 + 编辑器。保留全部冒烟 testid：`desktop-shell`、`assistant-panel`、`file-tree-panel`、
  `editor-panel`、`collapse-/expand-file-tree`、`collapse-/expand-assistant`。
- `apps/desktop/frontend/src/components/FileTree.tsx`：改为受控组件（`projectPath` 由上层注入），
  按项目根下第一层目录分组（大纲/人物/设定/正文/质量 语义），根目录文件优先，保留 `file-list` / `file-item` testid。
- `apps/desktop/frontend/src/components/Composer.tsx`：作为中间 AI 交互区，标题显示《项目名》项目会话、
  上下文条显示当前文件相对路径、回复显式引用该路径；有项目上下文即可输入。
- `apps/desktop/frontend/src/lib/smoke.ts`：抽出 `__STORYFORGE_SMOKE__.openProject` 与 `registerSmokeProjectLoader`，
  与渲染组件解耦，App 注册 loader → `selectProject`。
- `apps/desktop/frontend/scripts/verify-smoke.mjs`：断言文案随新布局更新为 `['项目', '打开', 'AI 交互']`。

## 本地验证结果

- `npm run typecheck`（apps/desktop/frontend）：通过，无错误。
- `npm run verify:smoke`（playwright 无头）：`Desktop frontend smoke passed`，无控制台错误，`#open-project-btn` 存在。
- `npm run build`：构建成功（`built in 9.61s`，monaco 大 chunk 警告为既有现象）。
- Rust 侧未改动；冒烟探针流程与新 DOM 对应关系：
  `collapse-file-tree`→收起文件工作区→出现 `expand-file-tree`；`collapse-assistant`→收起 AI 区→`expand-assistant`；
  `openProject(path)`→`selectProject` 重新打开工作区并加载 2 个 md；分组排序保证 `chapter-001.md` 为首个 `file-item`。

## 未联通 / 下一步

- Stage 3（AI 建议落地为文件 diff、接受/拒绝/旁注、版本记录）与 Stage 4（项目模板、文件类型语义、关联索引、命令面板）尚未实现。
- Composer 仍为占位回复，真实 Assistant API / 流式 / 自动审查触发待 Stage 3 接入。
- 建议在真实 Tauri 运行时跑一次 `apps/desktop/scripts/verify-tauri-smoke.mjs` 端到端复核（需本机 cargo + 桌面环境）。

---

# Desktop 版本记录 + 命令面板（cursor-like plan Stage 3/4 起步）

生成时间：2026-06-15 +08:00

## 目标与范围

- Stage 3：让保存产生可追溯版本记录，支持历史查看与恢复（方案验收"写回文件后保留版本记录 / 可撤回或查看历史版本"）。
- Stage 4：命令面板（打开文件 / 审查当前文件 / 切换面板），文件类型语义化文件树分组。
- 明确未做：AI 结构化建议补丁与待应用 diff 仍需真实 Assistant API，本程不伪造 diff；Composer 审查为占位回复（已显式标注 TODO）。

## 交付物

- `apps/desktop/frontend/src/lib/versions.ts`：版本快照库。保存覆盖前把磁盘旧内容写入
  `<project>/.storyforge/versions/<相对路径>/<unix毫秒>.snapshot.md`（真实 FS，无伪造）；提供 `listVersions`/`readVersion`。
- `apps/desktop/frontend/src/components/Editor.tsx`：保存时先快照后写入；新增"历史"面板，按时间倒序列出版本，可恢复到编辑器（标脏待用户确认保存）。新增 `projectPath` prop。
- `apps/desktop/frontend/src/components/FileTree.tsx`：递归列表排除 `.storyforge/` 内部目录，避免快照污染文件树。
- `apps/desktop/frontend/src/components/CommandPalette.tsx`：Ctrl+P 打开文件（按真实项目文件列表过滤）/ Ctrl+Shift+P 命令；键盘上下选择、Enter 执行、Esc/点击遮罩关闭。
- `apps/desktop/frontend/src/lib/assistant-events.ts`：`storyforge:review-current-file` 事件桥，命令面板"审查当前文件"→展开 AI 区并由 Composer 响应。
- `apps/desktop/frontend/src/App.tsx`：接入命令面板状态、快捷键、动作回调，并把 `activeProject` 透传给 Editor。
- `apps/desktop/frontend/src/components/Composer.tsx`：监听审查事件，围绕当前文件相对路径产出回复。

## 本地验证结果

- `npm run typecheck`：通过。
- `npm run verify:smoke`：`Desktop frontend smoke passed`，无控制台错误。
- `npm run build`：成功（9.62s）。

## 未联通 / 下一步

- AI 建议 → 结构化 diff → 接受/拒绝/旁注闭环，需接真实 Assistant/Workflow API（Stage 3 核心仍待）。
- Stage 4 剩余：项目模板、关联文件索引（人物出场章节/设定引用/伏笔绑定）、按文件类型切换审查策略的真实后端。
- 真实 Tauri 运行时端到端：建议跑 `apps/desktop/scripts/verify-tauri-smoke.mjs`（需本机 cargo + 桌面环境）复核冒烟探针与版本/命令面板交互。

---

# Desktop IDE UI 打磨（自有暖调 + 配色地基修复）

生成时间：2026-06-16 +08:00

## 目标与范围

- 打磨桌面 IDE（`apps/desktop/frontend`）视觉 / 交互 / 布局 / 细节四方面。
- 用户选定方向：换成 StoryForge 自有暖色深调；验证只跑 typecheck + 冒烟。
- 约束：保留全部 `data-testid` 与 `#open-project-btn`/`#editor-save-btn`，不破坏冒烟脚本依赖文案；Monaco 内部主题暂留。

## 根因与交付物

- **配色系统半失效（地基 bug）**：`tailwind.config.js` 的 `theme.extend` 为空，导致代码中大量透明度修饰类（`hover:bg-muted/20`、`border-border/50`、`bg-error/10`、`border-accent/30 border-t-accent` 等）不生成 CSS——hover 无反馈、错误卡无底色、loading 转圈无色。
  - `tailwind.config.js`：颜色接入 `theme.extend.colors`，采用 `rgb(var(--x) / <alpha-value>)` 通道格式使透明度修饰符生效；新增 `surface` 卡片层；新增 `fade-in`/`slide-up-fade` keyframes + animation。
  - `src/index.css`：CSS 变量改为空格分隔 RGB 通道；换成暖调（背景 #1b1917、面板 #23201b、surface #2b2721、accent 赭橙 #c8804a、accent-foreground 深色）；删除原手写颜色工具类（改由 Tailwind 生成）；滚动条引用新变量；加 `prefers-reduced-motion` 关闭动效。
- **面板宽度恢复 bug**：`ResizablePanel` 原用 `useState(defaultWidth)` 只取初始值，localStorage 恢复的宽度无法反映。改为受控于父级 `defaultWidth`，拖拽仅经 `onWidthChange` 回传；合并重复的两层拖拽手柄为单层（hover 显示 accent 细线 / 拖拽加宽高亮），拖拽时锁 body cursor/userSelect。
- **视觉 + 布局统一**：四个面板 header 统一 `h-10 px-3` 对齐成一条水平线；层次 background→panel→surface；列表选中态 / 主按钮收敛到 accent + 深字；hover 统一 `hover:bg-foreground/10` + `active:` 轻按下态；圆角统一（列表项 `rounded-md`、卡片 `rounded-lg`）。涉及 `App.tsx`、`Composer.tsx`、`ProjectPanel.tsx`、`FileTree.tsx`、`Editor.tsx`、`CommandPalette.tsx`。
- **交互反馈**：命令面板遮罩淡入 + 面板滑入；消息气泡 / 建议审查面板 / 版本记录 / suggestionStatus 淡入；FileTree loading/空/错误态统一为 surface 卡；DiffColumn before/after 加 success/error 淡色块区分；Editor `✕`、版本记录关闭按钮统一为图标按钮规格。

## 本地验证结果

- `pnpm.cmd typecheck`：通过（tsc --noEmit 无错）。
- `pnpm.cmd run verify:smoke`：`Desktop frontend smoke passed`，无控制台错误（兜住 Tailwind 类名与运行时报错）。

## 未联通 / 下一步

- Monaco 编辑器内部主题仍为 `vs-dark`，与新外壳暖调略有出入，留作下一轮单独适配。
- 真实 Tauri 运行时端到端复核（需本机 cargo + 桌面环境）未跑。
- 未做浅色 / 双主题（用户选定单一自有深调）。

---

# 桌面端 Assistant 接入真实 LLM 修订链路（2026-06-16）

## 问题

桌面 IDE 中间「AI 交互区」（Composer）是纯占位空壳：`Composer.tsx` 标 `// TODO: 接入真实 Assistant API`，只回显固定话术；所谓「补丁」是 `assistant-suggestions.ts` 在文件末尾字符串拼接的假旁注；桌面前端无任何 API client；后端 assistant 域只存会话/消息/工具调用，无「文本+指令→LLM 修订」接口。右侧 Editor 的 diff 评审 UI（接受/拒绝/存旁注）本已做好，缺的是中间这条真·AI 修订链路。

## 交付物

- **后端新增 `POST /api/assistant/revise`**：
  - `apps/api/app/domains/assistant/schemas.py`：`AssistantReviseRequest` / `AssistantReviseResponse`。
  - `apps/api/app/domains/assistant/service.py`：`revise_file_content()` 复用 `book_runs.book_generation` 的 `_call_llm` + `missing_book_generation_env`（不重构 book_generation）；落会话 + `assistant.revise` tool-call（running→completed/failed）。LLM 未配置 `AssistantLlmNotConfiguredError`、调用失败 `AssistantReviseError`，均不伪造兜底。
  - `apps/api/app/domains/assistant/router.py`：env 缺失→422，LLM 失败→502，错误原样透出。
- **桌面前端**：新增 `apps/desktop/frontend/src/lib/api-client.ts`（renderer fetch，`X-StoryForge-API-Key` + `no-store`，base/key 走 Vite env）；`src/vite-env.d.ts` 补 `import.meta.env` 类型。
- **Editor**：`onRequest` 改 async 调 `requestRevision`，加载态 + 真实 before/after 走评审 UI；`assistant-suggestions.ts` 加 `createRemoteFileSuggestion`；`assistant-events.ts` 加 `SUGGESTION_RESULT_EVENT` / `emitSuggestionResult`。
- **Composer**：删除 `setTimeout` 固定话术与 TODO；有文件时任意指令走真实修订；监听结果事件显示成功/真实错误。

## 验证结果

- **后端单测**（mock `_call_llm`）：`uv run pytest tests/test_assistant_revise.py -q` → 3 passed（正常返回 diff + tool-call completed；env 缺失 422；LLM 抛错 502 + tool-call failed）。assistant 全套 `test_assistant_*` → 10 passed。
- **契约**：`pnpm openapi` → diff 纯新增 `/api/assistant/revise`（+145 行，0 删除），无漂移。
- **桌面前端门禁**：`npm run typecheck` 通过；`npm run build` 通过；`npm run verify:smoke` → `Desktop frontend smoke passed`，无控制台错误。
- **真实 mimo 端到端**（`.codex/run-assistant-revise-e2e-probe.py`，真实 DB + 真实 mimo-v2.5-pro）：`http=200`，`changed=True`，返回真实修订正文（133 字、completion_tokens=828、latency≈24s）。命令：
  ```
  STORYFORGE_LLM_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1 STORYFORGE_LLM_MODEL=mimo-v2.5-pro \
  uv run python ../../.codex/run-assistant-revise-e2e-probe.py
  ```

## 未联通 / 说明

- 本机 venv 的 uvicorn 无条件 import uvloop（Windows 无 uvloop），无法经真实 HTTP socket 起服务；端到端改用 Starlette `TestClient` 挂载 `app.main:app`，仍走完整中间件/鉴权/DB/`_call_llm`→mimo，仅少 socket 一跳。
- 桌面 smoke 在非 Tauri 浏览器跑，不覆盖真实修订路径（需真实 Tauri 运行时 + 本机 cargo）；修订链路的端到端由上面的 API 探针覆盖。
- mimo 对长 prompt 有 500/超时前科（见生成质量真相记录）；本端点 prompt 短，若真打失败会原样透出 502（不兜底）。
- API key 在本地 localhost 用默认 `local-dev-key`；硬化为 Rust 命令读 env 留作后续。

---

# 桌面 IDE Agent 编排链路（自然语言意图 → 复用命令注册表，2026-06-19）

## 问题

上一轮把「文本+指令 → LLM 修订」单端点 `POST /api/assistant/revise` 接通后，桌面中间「AI 交互区」仍只能做单文件修订一件事。IDE WebSocket 通道 `/api/ide/agent/sessions/{id}` 此前只接受 `command` 消息（前端需自己拼命令），没有「自然语言 → 选意图 → 调对应工具 → 落 tool-call → 等确认」的编排层；桌面 ChatWindow 也无法把作者一句话路由到 revise / 审查 / 启动生成。

## 交付物

- **后端编排器** `apps/api/app/domains/ide/orchestrator.py`（新增，660 行）：
  - `SUPPORTED_INTENTS = {chat.explain, file.revise, chapter.review, chapter.repair, bookrun.start}`。
  - `orchestrate_agent_message(session, agent_session_id, message)`：按意图分派，**全部复用现有真相源**——`file.revise` 复用 `assistant_service.revise_file_content`（同一 `_call_llm`）；`chapter.review`/`chapter.repair` 复用 `judge.run`/`judge.repair` 命令注册表；`bookrun.start` 复用 `ide.service.execute_ide_command_by_id` 的 `bookrun.start`。
  - 落 `assistant_session` + 每步 `assistant_tool_call`（running→completed/failed），返回 `agent_result` / `proposed_patch` / `tool_trace`；写操作 `requires_user_confirmation=True`，由作者在右侧 diff 面板确认后才走既有 approve 命令，不擅自写回。输入不足或下游失败抛 `AgentOrchestrationError`，不伪造兜底。
- **WebSocket 接入** `apps/api/app/domains/ide/router.py`：新增 `user_message` 消息类型走编排器；新增 `_accept_or_reject_agent_socket`（`x-storyforge-api-key` header 或 `api_key` query，校验失败 1008 关闭）；`finally` 兜底关闭仍连接的 socket。保留原 `command` 路径。
- **桌面前端**：`lib/api-client.ts` 新增 `sendAgentUserMessage` + `AgentResult`/`AgentProposedPatch`/`AgentToolTrace` 类型与 `agent_result` 守卫；`components/ChatWindow.tsx` 用 `detectConversationIntent` 把作者输入路由到 `file.revise`/`chat.explain`/`file.export`，展示 `tool_trace` 步骤树、`requires_user_confirmation` 时引导到右侧 diff；`lib/assistant-events.ts` 新增导出/作者循环结果事件桥；`lib/smoke.ts` 暴露 `getApiConfig` 快照供冒烟读取。

## 本地验证结果

- 后端单测：`uv run pytest tests/test_ide_agent_orchestrator.py -q` → 4 passed（意图注册表一致；`file.revise` 返回待确认补丁 + tool-call completed；`chapter.review` 经 judge.run→judge.repair 返回待确认 repair_patch + approve 命令；`bookrun.start` 复用命令注册表，status=running、audit_event_id 带 `ide-command-event:` 前缀）。assistant + ide_agent 合并 `-k "assistant or ide_agent"` → 17 passed。
- 桌面前端门禁：`pnpm.cmd run typecheck` 通过；`pnpm.cmd run verify:smoke` → `Desktop frontend smoke passed`，无控制台错误。
- 契约：`pnpm openapi` 刷新后 diff 为纯新增 schema（`AssistantContextBundle` 等，+90/-0），**无 path 变化、无删除**（WebSocket 不进 OpenAPI，确认无意外漂移）。

## 未联通 / 下一步

- 真实 Tauri 运行时端到端（作者一句话→编排→右侧 diff 确认→写回）未跑，需本机 cargo + 桌面环境；本轮由后端 WebSocket 测试 + 前端冒烟覆盖。
- `chat.explain` 当前为编排层直答，未接独立解释型 LLM 调用；`chapter.repair` 独立入口与 `chapter.review` 复用同一 judge 链路。
- 桌面 UI 四栏重构与暖调打磨（App.tsx 等）属另一摊改动，本笔不含。

记录时间戳：2026-06-19 +08:00。
