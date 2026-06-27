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

---

# IDE Agent 评审推理缝 + 真 LLM 子代理降级（阶段 1，2026-06-20）

## 交付物

- 新增 `apps/api/app/domains/ide/review_reasoning.py`：定义 `ReviewSubagentResult` / `ReviewReasoner`，提供 `HeuristicReviewReasoner` 与 `LlmReviewReasoner`。LLM 模式按 plot / character / prose 三个视角并发调用 `_call_llm`，只接受 JSON 数组；单项 LLM 异常或解析失败时仅该视角降级到启发式，并带 `degraded_reason`。
- `apps/api/app/domains/ide/orchestrator.py`：`file.review` 改为通过推理缝生成报告；报告顶层新增 `mode`（`llm` / `mixed` / `heuristic_only`），每个 `agent_findings` 新增 `mode`、可选 `model` / `latency_ms` / `degraded_reason`；`subagent.synthesizer` 明确标注 `strategy=deterministic_merge`。
- `apps/api/tests/test_ide_agent_orchestrator.py`：补齐三条路径测试：未配置 LLM 时启发式预扫、配置 LLM 时三子代理结果来自模型、单个子代理失败时局部降级且整轮不挂。
- 为通过全量 API ruff，顺手最小修复既有静态问题：`book_generation.py` 补 `sys` import 并移除两个未使用局部变量，`ide/router.py` 与 `run_windows.py` 仅整理 import。

## 本地验证结果

- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q` → 10 passed。
- `cd apps/api && uv run ruff check .` → All checks passed。

## 未联通 / 说明

- 本轮 LLM 路径使用 monkeypatch `_call_llm` 覆盖成功与失败隔离；未跑真实 Provider 端到端。真实端到端仍需带 `STORYFORGE_LLM_*` 凭据，用 TestClient 探针验证 file.review，避免 Windows 本机 uvicorn/uvloop 启动坑。

记录时间戳：2026-06-20 01:57:19 +08:00。

---

# IDE Agent 后端意图源收口 + 前端移除重复业务判定（阶段 2，2026-06-20）

## 交付物

- `apps/api/app/domains/ide/orchestrator.py`：收紧 `_detect_intent`。当前文件上下文不再自动等价为 `file.revise`；后端根据用户原话判断 `file.review` / `file.revise` / `chat.explain`，避免前端移除本地判定后普通解释误触发修订。
- `apps/desktop/frontend/src/components/ChatWindow.tsx`：移除本地 `detectConversationIntent` 的业务分流，只保留纯本地副作用 `file.export`；其他用户输入统一把原话、当前文件正文、项目上下文交给后端 Agent Orchestrator，最终 UI 使用后端返回的 `response.intent` 展示链路。
- `apps/api/tests/test_ide_agent_orchestrator.py`：新增回归测试，覆盖“带 file_path/content 的普通解释仍应返回 `chat.explain`，且不生成 proposed_patch”。

## 本地验证结果

- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q` → 11 passed。
- `cd apps/api && uv run ruff check .` → All checks passed。
- `cd apps/desktop/frontend && pnpm.cmd run typecheck` → 通过。
- `cd apps/desktop/frontend && pnpm.cmd run test` → 8 passed。
- `cd apps/desktop/frontend && pnpm.cmd run verify:smoke` → Desktop frontend smoke passed。
- `cd apps/desktop/frontend && pnpm.cmd run verify:agent-conversation` → Agent conversation verification passed。

## 未联通 / 说明

- 阶段 3（WebSocket 流式）与阶段 4（LLM 综合评审）在计划中标为可选，本轮未执行；当前仍是一轮 WebSocket 返回完整 `agent_result`。
- 真实桌面 Tauri 写回确认链路未跑；本轮覆盖后端 WebSocket 编排、前端 typecheck/unit、浏览器 smoke 与 agent conversation 预览验证。

记录时间戳：2026-06-20 02:03:17 +08:00。

---

# IDE Agent 对话化范围控制（阶段 5 v2a/v2b/v2c，2026-06-20）

## 交付物

- `apps/api/app/domains/ide/orchestrator.py`：review report issue 增加报告内稳定 `id` 与 `category`（如 `plot-1` / `character-1`）；`file.revise` 增加确定性范围解析，支持 `selected_issue_ids`、`included_categories`、`excluded_categories`、`revision_constraints`，并把 `applied_scope` 回显到 `agent_result` 与 `tool_trace`。未知 issue id / 越界“第 N 条”进入 `dropped_unknown_ids`，summary 明确说明已忽略，不静默吞。
- `apps/api/app/domains/ide/orchestrator.py`：`file_revision` proposed patch 增加不可变 `id`；`_detect_intent` 在 revise 前识别“确认写回 / 接受这版 / 就这版写回”等纯确认话术，后端防御性路由到 `chat.explain`，不重新生成修订。
- `apps/desktop/frontend/src/components/ChatWindow.tsx` + `Editor.tsx` + `lib/assistant-events.ts`：前端只把“确认写回”作为客户端动词处理，发出 `storyforge:accept-current-file-suggestion`，由 Editor 接受用户已经看过的 pending diff；无 pending suggestion 时回传“当前没有待写回的修订”，不写文件。
- `apps/desktop/frontend/src/lib/api-client.ts` / `assistant-suggestions.ts`：透传后端 `proposed_patch.id` 到本地 `AssistantFileSuggestion.id`，保持待确认补丁可追踪。
- `apps/api/tests/test_ide_agent_orchestrator.py`：新增/扩展覆盖稳定 issue id、选中 issue 范围、硬约束入 prompt、未知 issue id 回显、确认写回不被判成 `file.revise`。
- `apps/desktop/frontend/tests/assistant-events.test.ts`：新增事件桥单测，覆盖确认写回事件发出。

## 小修：确认写回短语前后端一致（2026-06-20）

- `apps/desktop/frontend/src/lib/local-conversation-action.ts`：抽出可测试的本地对话动作识别器，并拓宽 `file.writeback` 识别，覆盖 `应用当前补丁`、`确认一下写回`、`接受当前修订`、`accept/apply this`、`confirm writeback` 等说法；`ChatWindow.tsx` 改为复用该函数，避免确认话术漏到后端变成只解释不写回。
- `apps/api/app/domains/ide/orchestrator.py`：同步拓宽 `_is_confirm_writeback_request` 防御网，`接受当前修订` 不会因“修订”关键词误入 `file.revise` 重新生成。
- `apps/desktop/frontend/tests/local-conversation-action.test.ts`：新增表测，覆盖确认写回、导出、普通 agent 请求三类本地动作。
- `apps/api/tests/test_ide_agent_orchestrator.py`：确认写回回归测试扩展为多短语表测，覆盖 `确认写回`、`应用当前补丁`、`接受当前修订`。

## 本地验证结果

- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q` → 17 passed。
- `cd apps/api && uv run ruff check app/domains/ide/orchestrator.py tests/test_ide_agent_orchestrator.py` → All checks passed。
- `cd apps/api && uv run ruff check .` → All checks passed。
- `cd apps/desktop/frontend && pnpm.cmd typecheck` → 通过。
- `cd apps/desktop/frontend && pnpm.cmd test` → 9 passed。
- `cd apps/desktop/frontend && node scripts/verify-unit.mjs` → 11 passed。
- `cd apps/desktop/frontend && npx tsc --noEmit -p tsconfig.json` → 通过。
- `pnpm.cmd --filter @storyforge/desktop-frontend typecheck/test` → 未匹配 workspace package；当前 `pnpm-workspace.yaml` 只含 `apps/*` / `packages/*`，不包含嵌套的 `apps/desktop/frontend`。已改为在前端目录直接运行脚本。

## 未联通 / 说明

- `pnpm.cmd lint` 在根目录失败，原因是 ESLint 扫到 `.cache/external/cherry-studio/eslint.config.mjs` 并缺少外部缓存项目依赖 `@electron-toolkit/eslint-config-ts`；非本轮代码 lint 错误。
- `pnpm.cmd test` 在 Web 阶段失败，Web 结果为 226 passed / 1 failed；失败为既有 `apps/web` phase1 转译临时目录里的 `tests/ide-page.test.mjs` 找不到 `components/ide/prototypes/StoryForgeWorkbenchPrototype` 扩展名（此前报告已记录同类问题）。因此根测试未继续跑到 API / workflow 全量。
- 未跑真实 Tauri UI 手测；本轮用前端 typecheck/unit 覆盖事件桥，用后端 WebSocket TestClient 覆盖范围解析与 proposed patch。

记录时间戳：2026-06-20 03:15:56 +08:00；小修复核验：2026-06-20 16:29:24 +08:00。

---

# 桌面 IDE 四栏暖调收口（Rust get_api_config 硬化）+ Web Provider API Key 探测（2026-06-19）

本笔与同日「IDE Agent 编排链路」是同一工作树拆分的另两摊，单独记录验证。

## ③ 桌面 IDE：API 配置硬化 + 无边框窗口 + 冒烟升级

- **Rust 端从 env 读 API 配置**（`apps/desktop/src-tauri/src/main.rs`）：新增 `#[tauri::command] get_api_config()`，`base_url` 读 `STORYFORGE_API_BASE_URL`、`api_key` 读 `STORYFORGE_API_KEY`（兜底 `local-dev-key`），renderer 经 `lib/api-client.getApiConfig` 取用，替代前端硬编码——落实上一轮报告所列「API key 硬化为 Rust 命令读 env」。`is_api_ready` 复用已有 `:8000/health/ready`，找不到项目根时明确报错（提示设 `STORYFORGE_ROOT`），不静默兜底。
- **窗口**（`tauri.conf.json`）：`decorations:false` 无边框 + 自绘标题栏拖拽，补 `core:window:allow-*` 权限。
- **冒烟升级**：`scripts/verify-tauri-smoke.mjs` 改为断言前端 `getApiConfigSnapshot()` 与 Rust `get_api_config` 同源（base_url/api_key 一致），`lib/smoke.ts` 暴露快照；`frontend/scripts/verify-smoke.mjs` 文案随四栏布局更新。
- 其余为四栏暖调延续（`App.tsx`/`index.css`/`CommandPalette`/`ResourceExplorer`/`ProjectPanel`/`FileTree`/`menu.rs`/`fs.rs`），删除已废弃 `ProjectList.tsx`。

## ④ Web 设置：Provider 探测带 API Key

- `app/api/provider-models/provider-models.ts`：`probeProviderModels` 入参加 `apiKey`，请求带 `Authorization: Bearer <key>`；缺 key 直接返回明确错误「请先填写 Provider API Key」，不匿名探测。
- `app/settings/ProviderSettingsPanel.tsx`：新增 API Key 字段 + 模型选择，URL+Key 齐备后 `scheduleAutoProbe` 自动拉取模型列表，配置存 `storyforge-provider-settings` localStorage。
- **方向反转（有意决策）**：旧测试断言「不渲染密钥框、不存密钥」，现反转为「必须提供 API Key 字段并存入 localStorage」；`tests/settings-page.test.ts` 已同步，并断言 `Authorization: Bearer test-key` 与 `scheduleAutoProbe`。

## 本地验证结果

- 桌面前端：`pnpm.cmd run typecheck` 通过；`pnpm.cmd run verify:smoke` → `Desktop frontend smoke passed`，无控制台错误。
- 桌面 Rust：`cargo check` 通过（16.74s，无 error/warning 阻断）。
- Web：`pnpm --filter @storyforge/web test` → 226 passed / 1 failed。唯一失败为 **预先存在、与本笔无关** 的 `ide-page.test.mjs`（phase1 契约转译把 `.tsx` prototype 写入临时目录后 `ERR_MODULE_NOT_FOUND` 丢扩展名）——已 stash 全部 web 改动复跑确认同样 fail 1、pass 226 不变，故非本笔回归。
- 真实 Tauri 运行时端到端（无边框窗口拖拽 + get_api_config 同源 + 四栏交互）需本机 cargo + 桌面环境逐项手测，本轮由 cargo check + 前端冒烟 + 同源断言覆盖。

## 未联通 / 下一步

- 既有失败 `ide-page.test.mjs`（prototype `.tsx` 转译丢扩展名）值得单独修，不属本笔范围。
- Web Provider API Key 存浏览器 localStorage（明文），生产环境密钥落服务端的方案待定。

记录时间戳：2026-06-19 +08:00。

---

## IDE Agent 重构 · 阶段 1（真·多视角审稿 + 两处诚实性修复）

设计与实施计划见 `.codex/agent-redesign-plan.md`。阶段 1 把 `file.review` 的伪启发式「子代理」改为可注入推理缝 + 真 LLM 并发子代理 + 单项降级。

**Review 结论**：阶段 1 实现对照计划到位（缝 `review_reasoning.py`、`ThreadPoolExecutor` 并发、单项 try/except 降级、tool_trace 诚实标 `mode`/`model`/`latency_ms`、synthesizer 标 `deterministic_merge`、`review_skills.py` 保留为降级兜底）。`book_generation.py` 的 `import sys` 修了 `:1593-1594` 真实使用但缺导入的潜在 NameError；删 `finish_reason`/`raw_chars` 为行为中性死代码清理。

**修复两处「叙事 vs 真相」隐患（本轮）**：
1. `_review_report_mode`（`orchestrator.py`）：env 配了但三子代理全失败时原会判 `heuristic_only` → summary 谎报「未配置 LLM」。新增 `llm_failed` 模式（凭 `degraded_reason` 区分「没配」与「配了全失败」），summary 改为「已配置 LLM，但全部子代理调用失败，已整体降级」。
2. `_parse_llm_issues`（`review_reasoning.py`）：原 `json.loads` 裸解析，模型把数组裹进代码块围栏即必失败→静默全降级。新增 `_strip_code_fence` + `_extract_first_json_array` 容错。

**验证**：`cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q` → **13 passed**（含新增 `test_file_review_parses_fenced_json_as_llm`、`test_file_review_reports_llm_failed_when_all_subagents_fail`）；`uv run ruff check app/domains/ide/ app/domains/book_runs/book_generation.py` → All checks passed。

**未联通 / 下一步**：真 LLM 端到端（带 `STORYFORGE_LLM_*` 凭据）未在本环境跑，仅 stub 覆盖（本机 uvloop 起服坑见 project_desktop_assistant，需 TestClient 探针）；`book_runs` 全套件未复跑（改动行为中性）；前端 file.review 触发链路与流式 UX 属阶段 2/3，未动。

记录时间戳：2026-06-20 +08:00。

---

# P0 项目真相与门禁复位（2026-06-20）

## 目标

- 把内部事实源从 2026-06-04 的“真实 3-5 万字长程仍未完成”更新为当前真实边界：30 章真实长程已跑完并导出制品，但人工通读退回重跑；当前不能宣称稳定生产级长篇质量。
- 修复根门禁里已知红灯：`pnpm.cmd lint` 被 `.cache/external/cherry-studio` 外部缓存项目绊住，Web `ide-page` phase1 转译缺少 `StoryForgeWorkbenchPrototype.mjs`。
- 保持事实源契约测试继续报警，但对齐新的 2026-06-20 边界。

## 交付物

- `eslint.config.mjs`：忽略 `.cache/`，并为 `apps/desktop/frontend/scripts/verify-*.mjs` 声明浏览器全局，避免验证脚本被 `no-undef` 误判。
- `apps/web/scripts/phase1-contract-test.mjs`：把 `components/ide/prototypes/StoryForgeWorkbenchPrototype.tsx` 加入临时转译列表，并补齐 import rewrite。
- `apps/web/app/settings/ProviderSettingsPanel.tsx`：把首次读取 localStorage 从 render 阶段读 ref 改为 `useState` 懒初始化，满足 React hooks refs 规则。
- `docs/internal/current-phase.md`、`docs/internal/TODO.md`、`docs/internal/PROJECT_SUMMARY.md`：同步 30 章长程退回、Desktop IDE Agent 当前能力、门禁状态和下一步优先级。
- `apps/api/tests/test_phase9_fact_sources.py`：把文档事实源契约从旧 6 月 4 日远端 E2E 快照，更新为 6 月 20 日真实长程整改 + Desktop IDE Agent 边界。

## 本地验证结果

- `pnpm.cmd lint`：通过；仍有 4 个非阻断 warning（IDE prototype/use-fetch hook warning、`home-page.test.tsx` 未使用变量）。
- `pnpm.cmd --filter @storyforge/web test -- settings-page ide-page`：11/11 passed。
- `pnpm.cmd --filter @storyforge/web test`：231/231 passed。
- `cd apps/api && uv run pytest tests/test_phase9_fact_sources.py -q`：13 passed。
- `cd apps/api && uv run ruff check tests/test_phase9_fact_sources.py`：All checks passed。
- `cd apps/api && uv run pytest`：609 passed，3 skipped，8 warnings。
- `cd apps/workflow && uv run pytest`：322 passed。
- `pnpm.cmd --filter @storyforge/shared test`：通过。
- `pnpm.cmd test`：通过；Web 231 passed，shared typecheck 通过，API 609 passed / 3 skipped / 8 warnings，Workflow 322 passed。
- `git diff --check`：通过。

## 未联通 / 说明

- 本轮没有重跑 `pnpm verify`、`pnpm e2e`、`pnpm openapi`，因为本次没有 API 路由/OpenAPI 契约变更；已用根 `pnpm.cmd lint` 与 `pnpm.cmd test` 覆盖 P0 门禁复位。
- 未跑真实 Tauri 桌面端到端；该项已列为下一步优先级：打开文件 -> Agent 审稿 -> 指定问题修订 -> diff 确认 -> 写回 -> 版本记录。
- 远端 E2E 仍只引用已记录的历史通过 run `26944063055`，不声明 2026-06-20 最新远端状态。

记录时间戳：2026-06-20 17:30:00 +08:00。

---

# Cursor for Fiction Phase 1 收口（2026-06-22）

## 目标

完成 `docs/superpowers/plans/2026-06-22-cursor-for-fiction-phase1.md`：StoryForge 第一阶段收口为面向本地小说项目的 Cursor-like Desktop IDE，覆盖本地文件编辑、Agent 多视角审稿、定向修订、proposed patch/diff 确认、真实写回和版本记录。

## 交付物

- P0 文档契约：`README.md`、`docs/architecture/ide-first-product-direction.md`、`docs/internal/current-phase.md`、`docs/internal/TODO.md` 明确 `StoryForge = Cursor for Fiction`、`apps/desktop` 是唯一主体验，BookRun 是 Agent tool / 后台重型引擎。
- P1/P5 桌面上下文：`project-context.ts` 约定 `正文/`、`大纲/`、`人物/`、`设定/`、`世界观/`、`时间线/`、`伏笔/`，生成轻量 context bundle；`ChatWindow.tsx` 使用稳定 Agent payload，包含 `project_path`、`current_file`、`content`、`selection`、`assistant_session_id` 和 context bundle。
- P2 审稿产品化：`file.review` 保持 plot / character / prose 三视角，issue 稳定 id，且每条 issue 包含 `category`、`severity`、`message`、`evidence`、`suggested_action`；前端渲染 issue 操作区，支持“只修此条”和按 category 修订。
- P3 proposed patch：`file.revise` 只返回 `kind=file_revision` 的 proposed patch，包含 `before`、`after`、`file_path`、`requires_confirmation`；前端确认写回走本地 accept event，不重新触发 revise。
- P4 Tauri 写回与版本记录：真实 Tauri smoke 注入 proposed patch，验证未确认前磁盘不变；确认后磁盘内容变化、Editor 刷新、`.storyforge/versions` 有写回前快照和 Agent 来源/摘要 meta、`.storyforge/author-loop` 有本次 Agent 修订来源记录。
- P6 BookRun 工具化：`bookrun.start` 继续复用 command registry，返回 tool trace/audit id，并在 Agent 摘要中说明章节计划和预算，不抢主界面。

## 本地验证结果

- `npm --prefix apps/desktop/frontend run typecheck`：通过。
- `npm --prefix apps/desktop/frontend run test`：15 passed。
- `npm --prefix apps/desktop/frontend run verify:smoke`：Desktop frontend smoke passed。
- `npm --prefix apps/desktop/frontend run verify:agent-conversation`：通过；验证 Agent payload 携带当前项目、当前文件、正文内容、人物上下文摘录，并验证“只修此条”发送 `selected_issue_ids=["character-1"]`。
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q`：17 passed。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过。
- `node apps/desktop/scripts/verify-tauri-smoke.mjs`：通过；真实 Tauri 端到端输出 `writebackPreview=# Chapter 1 ... Smoke content revised by Agent`，并在脚本内检查未确认不写盘、确认后磁盘写回、版本快照、版本 Agent meta 和作者闭环记录。

## 说明

- Tauri smoke 使用临时小说项目，目录含 `正文/`、`大纲/`、`人物/`，不污染用户项目。
- 浏览器版 `verify:agent-conversation` 使用受控 mock WebSocket 和 mock 文件系统验证 Desktop 前端 payload；真实写盘责任由 Tauri smoke 覆盖。
- Vite build 仍提示 Monaco chunk 体积较大，这是既有构建警告，不阻塞 Phase 1 闭环。

记录时间戳：2026-06-22 20:08:21 +08:00。

---

# Cursor for Fiction Phase 2 收口（2026-06-23）

## 目标

完成 `docs/superpowers/plans/2026-06-22-cursor-for-fiction-phase2.md`：在 Phase 1 本地写回闭环之上，把 Desktop IDE Agent 升级为可观察、可控、可追溯的日常协作体验；BookRun 继续作为 Agent tool / 后台引擎，不抢主界面。

## 交付物

- P1 事件流：`apps/api/app/domains/ide/router.py` 支持 opt-in `stream: true`，发送 `agent_run_started`、`agent_step`、`tool_trace`、最终 `agent_result` 和带 `run_id` 的 `error`；`apps/desktop/frontend/src/lib/api-client.ts` 支持 `onEvent`，最终只在 `agent_result` / `error` resolve。
- P2 上下文选择器：`project-context.ts` 增加 pinned files、预算、截断和 missing pins；`ChatWindow.tsx` 增加上下文摘要、项目文件选择、pin/unpin、预算展示和 `@文件` 缺失提示。
- P3 审稿问题工作流：review issue 卡片支持多选、category 过滤、修选中问题、只修本类问题；定向修订 payload 继续发送 `selected_issue_ids` / `included_categories` 并由后端回显 `applied_scope`。
- P4 Patch 审阅工作台：新增 `PatchReviewPanel`，展示 patch id、文件路径、增删行、模型、session、issue scope 和展开全文；Editor 接受前检测当前内容是否仍等于 `suggestion.before`，冲突时不写盘；拒绝不写正文。
- P5 BookRun 工具化：`bookrun.start` 改成预检/确认两段式，未确认时返回计划、预算、风险和 `confirmation_action`；确认后返回 `book_run_id` / `events_url`，前端订阅 run events 并展示轻量进度。
- P6 追溯闭环：`assistant-suggestions.ts`、`versions.ts`、`author-loop.ts` 透传 patch id、assistant session id、issue ids、context files；版本面板支持来源筛选并展示 Agent meta。
- P7 验证：`verify-agent-conversation.mjs` 覆盖流式事件、上下文 pin/budget 和 issue 多选；`verify-tauri-smoke.mjs` 覆盖拒绝不写盘、旧 patch 冲突保护、确认写回、版本 meta 和 author-loop meta。

## 本地验证结果

- `npm --prefix apps/desktop/frontend run typecheck`：通过。
- `npm --prefix apps/desktop/frontend run test`：20 passed。
- `npm --prefix apps/desktop/frontend run verify:smoke`：Desktop frontend smoke passed。
- `npm --prefix apps/desktop/frontend run verify:agent-conversation`：Agent conversation verification passed；验证流式 step 在最终回复前出现、pinned context 进入 payload、`context_bundle.budget.pinned_file_count >= 1`、多选 issue 发送 `selected_issue_ids=["character-1"]`。
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_ide_run_events.py -q`：24 passed。
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q`：20 passed。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过。
- `node apps/desktop/scripts/verify-tauri-smoke.mjs`：通过；真实 Tauri smoke 验证未确认不写盘、拒绝不写盘、旧 patch 内容冲突被阻止、确认后磁盘写回、`.storyforge/versions` 含 Agent/patch/session/issue/context meta、`.storyforge/author-loop` 含同源 meta。

## 说明

- 后端当前中间 step/tool 事件由编排结果投影生成，协议、前端状态推进和 smoke 已成立；真正逐 token / 逐工具实时事件可作为 Phase 2 之后增强。
- 本轮没有改变 `apps/web` 退场结论，也没有把 BookRun 控制台重新设为主产品入口。
- 本轮不证明真实 3-5 万字长程质量验收通过；该项仍按 `docs/internal/TODO.md` 的长程整改优先级推进。
- Tauri smoke 构建仍提示 Monaco chunk 体积较大，命令退出码为 0，不阻塞验收。

记录时间戳：2026-06-23 00:33:51 +08:00。

---

# Agent Runtime 控制平面基座（2026-06-23）

## 目标

执行 `docs/architecture/agent-runtime-control-plane-plan.md` 的首批后端闭环：新增 AgentRun 统一控制平面事实源，让 IDE Agent WebSocket 用户请求创建或续接 AgentRun，并把计划、工具轨迹、子代理结果、权限请求和 artifact 写入同一套事件存储。

## 交付物

- 新增 `apps/api/app/domains/agent_runs/`：`AgentRun`、`AgentRunEvent`、`SubagentRun`、`AgentArtifact` 模型，service 和 REST/SSE 读取接口。
- 新增 `apps/api/alembic/versions/20260623_0001_add_agent_runs.py`：创建四张控制平面表和索引。
- `apps/api/app/domains/ide/router.py`：WebSocket `user_message` 改为调用 AgentRun runtime service；保留现有 `agent_result` 返回形状和 stream 兼容事件。
- `apps/api/app/domains/ide/router.py`：新增 `approve_permission`、`deny_permission`、`pause_run`、`resume_run`、`stop_run` 控制消息事件化；携带 `run_id` 的 `command` 结果也写入 `tool_trace`。
- `apps/api/app/domains/book_runs/router.py`：BookRun create/start/pause/resume/stop/retry/progress 均投影到 `bookrun-{id}` long-running AgentRun，checkpoint 写入 `bookrun_checkpoint` artifact。
- `apps/api/app/domains/agent_runs/service.py`、`router.py`：新增 Skills v1 静态清单与 `/api/agent-runs/skills`，Root Agent 在 `agent_plan_created` 事件中记录 `selected_skill`、`skill_version` 和 skill plan template。
- `apps/api/app/domains/runtime_tools/service.py`、`schemas.py`：Runtime Tool Registry 补充 `permission_level`、`requires_confirmation`、`read_only`、`event_store_required`、`origin` 和 MCP 元数据；MCP v1 仅注册 `mcp.project.search`、`mcp.context.inspect` 两个只读分析工具。
- `packages/shared/src/contracts/storyforge.openapi.json`、`packages/shared/src/generated/api-types.ts`：刷新 AgentRun REST 契约和 TypeScript 类型。
- `apps/api/tests/test_agent_runs.py`：覆盖 AgentRun 元数据、WebSocket 事件持久化、review artifact、proposed_patch 权限事件、SSE 回放、Skills v1 catalog、selected skill 和 404。
- `apps/api/tests/test_runtime_tools.py`：覆盖内部工具权限元数据和 MCP v1 只读工具注册。
- `.codex/context-summary-agent-runtime-control-plane.md`、`.codex/operations-log.md`：补充本轮上下文和操作留痕。

## 本地验证结果

- `cd apps/api && uv run ruff check app/domains/agent_runs app/domains/runtime_tools app/domains/ide/router.py app/domains/book_runs/router.py tests/test_agent_runs.py tests/test_runtime_tools.py alembic/versions/20260623_0001_add_agent_runs.py`：All checks passed。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_runtime_tools.py -q`：13 passed。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_book_runs.py tests/test_ide_agent_orchestrator.py -q`：53 passed，1 个既有 FastAPI/Starlette 422 deprecation warning。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_runtime_tools.py tests/test_api_surface.py tests/test_alembic_heads.py tests/test_ide_agent_orchestrator.py tests/test_ide_run_events.py tests/test_assistant_tool_calls.py tests/test_book_runs.py -q`：71 passed，2 个既有 warning。
- `pnpm.cmd openapi`：通过，已生成 OpenAPI 契约。
- `pnpm.cmd --filter @storyforge/shared generate:types`：通过，已生成 shared API types。
- `pnpm.cmd --filter @storyforge/shared test`：通过。
- `git diff --check`：通过。

## 未联通 / 说明

- 本轮实现的是控制平面基座、IDE Agent 单轮请求事件化、WebSocket 控制消息事件化、BookRun 路由级快照投影、Skills v1 选择记录和 MCP v1 只读注册骨架；workflow 后台内部逐章增量广播和真实 MCP 执行仍未实现。
- 文件写回仍保持 proposed patch + Desktop PatchReviewPanel 确认路径，未新增任何绕过作者确认的写盘能力。
- MCP v1 当前只暴露只读/分析工具定义，不执行外部 MCP；写入、联网或高成本 MCP 仍必须先进入 Permission Gate 并写 AgentRunEvent。
- SSE 端点当前回放已有 AgentRunEvent 快照，不做后台长连接增量推送；后续可在 event store 写入时扩展增量广播。
- `cd apps/api && uv run pytest -q` 全量运行结果：617 passed / 3 skipped / 3 failed / 8 warnings。3 个失败均为本轮控制平面之外的相邻事实源或探针断言：`tests/test_phase9_fact_sources.py` 仍要求 2026-06-21 文档措辞，而当前文档生成时间为 2026-06-23；`tests/test_real_llm_connectivity_probe_script.py::test_ten_chapter_wrapper_probe_only_passes_with_local_provider` 未在 wrapper 输出中看到 `chat_probe: ok`。本轮未扩大范围修改这些历史事实源/探针脚本。
- `pnpm.cmd lint` 当前失败于桌面前端既有 React 规则与脚本 DOM 全局问题（如 `react-hooks/set-state-in-effect`、`react-hooks/refs`、`EventTarget` 未定义），不由本轮 API 控制平面改动引入；本轮仍以 API ruff、pytest 和 shared typecheck 覆盖增量。

记录时间戳：2026-06-23 02:49:00 +08:00。

---

# Agent Role Catalog v1 与控制平面收口提交（2026-06-24）

## 目标

在 2026-06-23 Agent Runtime 控制平面基座之上落地 OpenCode 启发的 Agent Role Catalog v1，并把累计未提交的控制平面工作收口提交。本轮同时明确产品定位为 Cursor for Fiction（作者辅助 IDE），BookRun 维持后台 Agent tool 角色。

## 交付物

- 新增 `apps/api/app/domains/agent_runs/role_catalog.py`：静态 Agent Role 目录（root_agent 唯一 primary + 9 个 subagent），含 @剧情/@人物/@文风/@伏笔/@设定/@修复/@BookRun/@探索/@资料 别名解析、只读角色禁止绑定写入工具的不变式校验、Desktop role hint/mention 归一化。
- `apps/api/app/domains/agent_runs/schemas.py`：新增 `AgentRoleRead`。
- `apps/desktop/frontend/src/lib/agent-roles.ts` 与 `tests/agent-roles.test.ts`：前端 role 目录消费与 @mention 解析。
- `docs/architecture/agent-runtime-*.md` 系列设计计划文档（控制平面、v1 gap、runtime facade、post-facade master plan、next-session 实施指南、desktop control plane、role consumption）。

## 本地验证结果

- `cd apps/api && uv run ruff check`（agent_runs/runtime_tools/ide.router/book_runs.router/main/models/相关测试/迁移）：自动修复 `book_runs/router.py` 1 处 import 排序后 All checks passed。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_runtime_tools.py -q`：29 passed（含 Agent Role Catalog v1 角色目录、别名解析、只读角色写入工具禁用断言）。
- `git check-ignore apps/api/app/domains/agent_runs/__pycache__/`：确认 `__pycache__` 已被忽略，收口提交不含编译缓存。

## 未联通 / 说明

- `pnpm.cmd lint` 当前 28 errors + 4 warnings（exit 1），全部为桌面前端既有组件违反新版 react-hooks 规则（refs / set-state-in-effect / immutability / exhaustive-deps），跨 App/ChatWindow/CommandPalette/Composer/DynamicIDELayout/Editor/FileTree/ResourceExplorer 8 个文件。经逐项核对，本批改动未引入新 lint error：ChatWindow 唯一 error 位于既有 line 618 ref 赋值，本批新增的是事件处理器内 setState。该 react-hooks 债务为独立前端清理任务，本轮按“禁止顺手重构无关代码”未一并处理。
- 文件写回、MCP 写入边界与 6-23 记录一致，未新增绕过作者确认或写入型 MCP 能力。

记录时间戳：2026-06-24（控制平面收口提交）。

---

# 桌面前端 lint 门禁转绿（2026-06-24）

## 目标

清理桌面前端 `pnpm lint` 门禁的两层既有债务，使根 lint 真正 exit 0。

## 背景

`pnpm lint` = `eslint . && prettier --check ...`。此前 eslint 直接以 28 个 error 退出，`&&` 短路使 prettier 从未执行，长期掩盖了底层 prettier 债务。本轮 eslint 转绿后该层才浮现。

## 交付物

- **eslint 层（28 error → 0）**：
  - `eslint.config.mjs`：为 `verify-*.mjs` 补 `EventTarget`/`Event`/`MessageEvent`/`CloseEvent` globals，消除 4 个 `no-undef`。
  - `react-hooks/refs`（12，ChatWindow/Composer/Editor）：render 期 latest-ref 赋值移入无依赖 `useEffect`（这些 ref 仅被 Monaco/WebSocket 等异步回调读取，行为等价、零回归）。
  - `react-hooks/set-state-in-effect`（11）+ `react-hooks/immutability`（1）：均为「输入变化→同步重置派生 state」或定时器回调，属 React18 合法模式（项目未上 React Compiler），逐处 `eslint-disable-next-line` + 中文理由，规则仍约束新代码。
- **prettier 层**：`prettier --write` 桌面前端 `src/**` 既有未格式化文件（30 个，含本轮编辑的 8 个组件），统一代码风格。

## 本地验证结果

- `npx eslint .`（JSON 统计）：err=0 warn=4（4 warning 为既有 `react-hooks/exhaustive-deps`×3 + `@typescript-eslint/no-unused-vars`×1，不阻塞门禁）。
- `pnpm.cmd run lint`：exit 0，eslint 0 error + “All matched files use Prettier code style!”。
- `npm --prefix apps/desktop/frontend run typecheck`：通过。
- `npm --prefix apps/desktop/frontend run test`：25 passed / 0 failed（refs 移 effect 与格式化均零回归）。

## 说明

- 12 个 compiler-readiness 规则按用户确认采用「分而治之」：refs 真改代码，set-state-in-effect/immutability 精准豁免，待未来上 React Compiler 再统一处理。
- 余下 4 个 warning 不阻塞门禁，本轮按最小范围未一并处理。

记录时间戳：2026-06-24（lint 门禁转绿）。

# 桌面前端 exhaustive-deps 三处收口（2026-06-24，lint 门禁转绿续）

## 目标

逐个评估并清理上一轮明确推迟的 3 个 `react-hooks/exhaustive-deps` 警告（非阻塞），按 effect 意图区分「真漏依赖」与「有意省略」，不机械补全。

## 交付物

- **DynamicIDELayout.tsx（:69 & :102，缺 `clampComposerWidth`）—— 真修复**：
  - `clampComposerWidth` 原为每次渲染重建的普通函数，两个 effect 闭包调用却未列入依赖；直接塞进 deps 会因「每帧新函数」导致 effect 每次渲染重跑。改用 `useCallback` 包裹（deps：`mainWidth`/`minComposerWidth`/`minRightWidth`/`resizerWidth`）稳定引用，两个 effect 依赖改为该稳定引用，`import` 补 `useCallback`。
  - 顺带修正手写 deps 漏掉的真实 prop 依赖 `minRightWidth`（此前 `minRightWidth` 变化不会重新夹紧 composer 宽度，属潜在 bug）。
  - 不会循环：`clampComposerWidth` 不读 `composerWidth`，`setComposerWidth` 用 functional update，故 `useCallback` 不因 `composerWidth` 变化重建、effect 不自触发。
- **Editor.tsx（:204，缺 `editorFontSize` + `loadedContent`）—— 有意省略，精确 disable**：
  - 该 effect 为挂载期一次性创建 Monaco 实例（空 deps 刻意为之），仅取二者初始值作种子。列入依赖会在改字号/换内容时销毁重建整个编辑器，丢失光标、滚动与撤销历史。
  - 二者后续变化已分别由 `:206`（`updateOptions({ fontSize })`）与 `:226`（`setValue(loadedContent)`）两个专门 effect 接管。
  - 处理：`eslint-disable-next-line react-hooks/exhaustive-deps` + 中文理由，规则仍约束新代码。

## 本地验证结果

- `npx eslint DynamicIDELayout.tsx Editor.tsx`（JSON 全量）：`CLEAN: 0 problems`（三处 exhaustive-deps 全消，`resizerWidth` 未被判 unnecessary，无新警告）。
- `npx eslint .`（全仓 JSON 统计）：`err=0 warn=0 — ALL CLEAN`（连同上一轮已清的 `no-unused-vars`，桌面前端 eslint 现零 error 零 warning）。
- `npm --prefix apps/desktop/frontend run typecheck`：通过（exit 0）。
- `npm --prefix apps/desktop/frontend run test`：25 passed / 0 failed（零回归）。

## 说明

- 至此桌面前端 `react-hooks` 三类规则全部收口：refs 真改、set-state-in-effect/immutability 精准豁免、exhaustive-deps 一真修复（DynamicIDELayout）一有意豁免（Editor）。
- 真修复 vs 豁免按 effect 意图逐个判定，未盲目补依赖（盲目补全可能引入多余重渲染、循环或销毁重建）。

记录时间戳：2026-06-24（exhaustive-deps 三处收口）。

---

# Writing Run seam 收口验证（2026-06-25）

## 目标

继续推进统一 `Writing Run / 写作任务` seam（决策见 `docs/architecture/writing-run-seam-decision.md`），确认 Agent / IDE 控制面已全部通过 `writing_runs.service` 间接驱动 BookRun，且无新调用点直连 BookRun lifecycle。

## 现状核对

- seam 本体完整：`app/domains/writing_runs/{schemas,service}.py` + `adapters/bookrun_full_book.py`，v1 仅放行 `scope=full_book, mode=managed`，`writing_run_id == book_run_id`。
- IDE 控制面：`ide/service.py` 的 `bookrun.*` 兼容命令（start/pause/resume/stop/retry）全部转交 `writing_runs.service`，返回 canonical `writing_run` + 兼容 `book_run` 字段。
- Agent runtime：`agent_runs/service.py`、`runtime.py` 的长程控制与快照均走 seam helper（`writing_run_payload` / `full_book_writing_run_event_data`）。
- 前端产品层干净：`writingRunIdFromResult` 先读 `writing_run_id` 再 fallback `book_run_id`；`bookrun.start` 仅作 legacy command id，文案为「启动写作任务」；无用户可见 BookRun 命名。
- 护栏达标：`grep` 确认 seam/legacy-REST 之外无任何 `create_book_run/pause_book_run/resume_book_run/stop_book_run/retry_book_run_from_checkpoint` 直接调用点。

## 本轮改动

- `ide/service.py`：ruff `--fix` 清掉 seam 接入后已无引用的 legacy import（`create_book_run` 等 5 个 lifecycle 函数 + `BookRunCreate/BookRunRead`），并将 `writing_runs` import 归位。佐证 IDE 层已彻底不直连 BookRun lifecycle。

## 本地验证结果

- `uv run pytest tests/test_writing_runs.py tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_ide_commands.py tests/test_ide_run_events.py -q` → 60 passed。
- `uv run pytest tests/test_book_runs.py -q` → 25 passed（seam 重度依赖 BookRun，确认无回归）。
- `uv run pytest tests/test_ide_commands.py tests/test_ide_agent_orchestrator.py tests/test_ide_run_events.py -q`（import 清理后复跑）→ 31 passed。
- `npm --prefix apps/desktop/frontend run test` → 27 passed（含 story-navigator、chat-window writing-run 投影）。
- `uv run ruff check app/domains/writing_runs app/domains/ide/service.py app/domains/agent_runs tests/test_writing_runs.py` → All checks passed。

## 未联通 / 暂不做

- 仍保留 `writing_run_id` 与 `book_run_id` 双字段，未迁表、未新增 `/api/writing-runs` 公共路由（按决策护栏，需第二个真实 adapter 或 inline 引擎落地后再做）。
- `mode=inline` 仍为类型预留，未实现短任务 run 引擎。
- 未瘦身 `book_runs/service.py` 内部实现（决策要求 seam 稳定后再议）。

记录时间戳：2026-06-25（Writing Run seam 收口验证）。

---

# 桌面 Agent 审稿→修订→写回闭环：首次真实 Tauri + 真模型人工端到端（2026-06-25）

## 背景与目标

此前 Cursor-for-Fiction Phase 1/2 的 Tauri 写回闭环仅由 `verify-tauri-smoke.mjs` 自动注入 proposed patch（mock WS / 注入补丁）验证；CLAUDE.md 仍把「真实 Tauri 桌面端到端写回确认链路」列为不能宣称完成。本轮目标：先硬化首次真实运行最易翻车的缝，再用真实 LLM（DeepSeek）在真实运行的 Tauri 窗口里**由人工**完整跑通 审稿 → 指定修订 → diff → 接受 → 写回 → 版本记录。

## 交付物（A1 跑前硬化）

- **EOL/CRLF 冲突门归一化** `apps/desktop/frontend/src/components/Editor.tsx`：`handleAcceptSuggestion` 的 `getValue() === suggestion.before` 冲突门、写回前快照判断、`handleSave` 快照判断三处统一 `normalizeEol`（按 LF 归一比较）。修因：ChatWindow 经 `TauriFileSystem.readFile` 读磁盘原文（Windows CRLF）做 `before`，Monaco `getValue()` 可能为 LF，EOL 差异会被误判「内容已变化」挡写回；归一仅作用于比较，不影响真实内容变更检测。
- **审稿/修订前 flush 编辑器缓冲** `lib/assistant-events.ts`（新增可 await 的 `flushActiveEditorToDisk`，带 2s 超时放行）+ `Editor.tsx`（监听 `REQUEST_SAVE_ACTIVE_FILE_EVENT`，active 且 dirty 才 `handleSave` 后回 done）+ `ChatWindow.tsx`（读盘前 `await flushActiveEditorToDisk(file)`）。修因：审稿读磁盘，`autoSave` 默认关 + 900ms debounce 有竞态，未保存编辑会被审旧内容。
- **前端 Agent WS 超时对齐后端** `lib/api-client.ts`：`sendAgentUserMessage` 默认超时 120s → `DEFAULT_AGENT_TIMEOUT_MS=360_000`（≥ 后端 `_call_llm` 300s 默认），超时文案提示模型慢可调大。修因：后端 300s / 前端 120s 倒挂，慢模型会在后端还没返回时被前端误判超时。
- **审稿降级可见性** `ChatWindow.tsx`：`reviewReportSummary` 增加「审稿来源」行（`reviewSourceLine`），读 review_report 的 `mode` / `agent_findings.degraded_reason`，`llm` 正向标注、`mixed`/`llm_failed` ⚠ 明示降级+原因、`heuristic_only` 标未配模型。修因：真模型未按 JSON 输出而静默退启发式时，前端原样把启发式结果当真审稿展示。
- **两条确认路径审计**（只读结论）：文件修订写回确认走本地 `PatchReviewPanel` 接受；WS `approve_permission`/pause/resume/stop 服务长 run 控制；流式 `permission_required` 仅在步骤树加「等待确认」步，无并行写回分支。记一个 Phase B UX 冗余：文件修订时步骤树的「批准」按钮对 file_revision 不触发写回（真正写回在右侧 diff 面板）。

## 真实运行暴露并修复的 bug

- **`context_bundle.budget` 契约错配** `apps/api/app/domains/assistant/schemas.py`：前端 context_bundle 携带 `budget`（file_count/char_count/truncated 等展示元数据），后端 `AssistantContextBundle` 为 `extra="forbid"` 且无该字段，`file.revise` 构造 `AssistantReviseRequest` 时 422（`file.review` 走原始 dict 不校验故无碍）。修法：给 `AssistantContextBundle` 加宽松 `budget: dict[str, Any] | None = None`（与既有 `summary: dict[str, Any]` 一致），REST 与 agent 两路同时修好。

## 真实 Tauri + 真模型人工端到端结果

- 环境：真实运行的 Tauri 窗口（`pnpm desktop:dev`，Docker postgres/redis/minio + 迁移 + uvicorn 全栈）；后端 LLM = DeepSeek `deepseek-v4-flash`（OpenAI 兼容，`STORYFORGE_LLM_*` 走本机 gitignored `.env.local`；`/models` 实测仅 `deepseek-v4-flash` / `deepseek-v4-pro`，旧 `deepseek-chat` 已退役）。
- 审稿（`file.review`）：四视角真模型并发返回，tool_trace 实测 `模型 deepseek-v4-flash`、plot 1886ms / character 1407ms / prose 2786ms；在 8 行目录说明文件上正确返回 0 结构问题。
- 修订（`file.revise`）：指令「润色并删除多余字符」→ `deepseek-v4-flash` 11002ms 返回 proposed patch；右侧 `PatchReviewPanel` 显示 `+6/-6`、patch id、session、`deepseek-v4-flash`、before/after，「建议后」正确删除多余字符并逐行润色。
- 接受写回（人工点「接受」）：**无误报「内容已变化」**（A1a 验证）、磁盘文件更新为润色后内容、状态「已接受并写入…闭环记录已保存」、`历史` 面板新增 source=Agent 版本记录（A1d flush 的未保存编辑也正确进入了本轮）。三点均由用户人工确认通过。

## 本地验证结果

- `npm --prefix apps/desktop/frontend run typecheck`：用户经 `!` 运行，`tsc --noEmit` 无报错（成功静默）。
- 真实端到端：如上，真实 Tauri 窗口 + 真 DeepSeek + 人工点击，审稿 / 修订 / 接受 / 写回 / 版本全程跑通。

## 未联通 / 待办

- 本轮因 Claude Code Bash 分类器临时不可用，**未由 AI 侧运行** `npm ... run test`、`pnpm.cmd lint`；typecheck 由用户代跑确认。test/lint 待补。
- 改了请求 schema（`AssistantContextBundle` 加 budget），**`pnpm openapi` 未刷新**契约快照，CI / 契约 diff 会报漂移；待跑（只影响契约，不影响运行时）。
- A1c「审稿来源」行渲染未经用户显式确认（数据层已由 tool_trace 的 `deepseek-v4-flash` 佐证 mode=llm）；建议下次纯审稿时核对该行。
- 仅在 8 行目录说明文件上跑通机制；真实正文章节（`正文/`）的有料三视角审稿 + 长章修订未跑，建议作为下一步。
- 左下「模型服务未检测」为 `App.tsx:958` 写死占位标签（非真实健康检查），与实际可用状态不符，记为 Phase B 待修。
- 区别于 Phase 1/2 的 `verify-tauri-smoke.mjs`（注入补丁 / mock WS）：本轮是真实 LLM 生成 + 人工点击的真实端到端，二者互补。

记录时间戳：2026-06-25（首次真实 Tauri + 真模型人工端到端）。

---

# 桌面 Agent 审稿→修订→写回闭环：静态门禁收口（2026-06-26）

## 背景与目标

承接 2026-06-25 那轮——真实 Tauri + 真模型人工端到端已由人工跑通，但「未联通 / 待办」明确遗留三项静态门禁未由 AI 侧补齐：`npm ... run test`、`pnpm.cmd lint` 未跑；`pnpm openapi` 未刷新（`AssistantContextBundle` 加了 `budget`，契约会漂移）。本轮只做这批静态收口与回归守卫，不重复人工端到端。

## 交付物

- **lint 转绿（修 2 处 `react-hooks/exhaustive-deps` 回归 + 格式）** `apps/desktop/frontend/src/components/Editor.tsx`、`src/lib/patch-hunks.ts`：
  - HEAD 上 `Editor.tsx` lint 本为零警告（`git stash` 对照确认），本轮工作树引入 2 处警告，均为本批改动的回归。
  - `:396` 那处 `eslint-disable react-hooks/exhaustive-deps` 经判定为 **unused**——该 effect 引用的 `handleSave` 只读 ref/import/setter，eslint-plugin-react-hooks v7 的响应式分析判其稳定、本不报警；`eslint --fix` 已删除该冗余 disable。
  - `ACCEPT_CURRENT_FILE_SUGGESTION_EVENT` 那处 effect 报缺 `handleAcceptSuggestion`：根因是本批把 `handleAcceptSuggestion` 内联逻辑抽成局部函数 `writeAcceptedSuggestion`，v7 因其调用未 memo 的局部函数而判 `handleAcceptSuggestion` 不稳定。按 `157d44b` 既定房规（逐 effect 判「真漏」/「有意省略」）判为**有意省略**：该 effect 为挂载期一次性注册窗口监听，`handleAcceptSuggestion` 经 ref 读待写回补丁/文件路径、闭包不读旧值，列入依赖会每渲染重挂监听——加精确 `eslint-disable-next-line` + 中文理由，与同文件 Monaco 挂载 effect 一致。
  - 两文件 prettier 格式问题由 `lint:fix` 一并修正。
- **OpenAPI 契约刷新** `packages/shared/src/contracts/storyforge.openapi.json`：`pnpm openapi` 重生，diff 仅 `AssistantContextBundle` 新增 `budget`（`anyOf: [object(additionalProperties:true), null]`），与 `schemas.py` 改动一一对应，无其它漂移。
- **后端 `budget` 回归守卫** `apps/api/tests/test_assistant_revise.py` 新增 `test_revise_accepts_context_bundle_budget_metadata`：POST `/api/assistant/revise` 携带带 `budget` 的 `context_bundle`，断言 200。固定该契约——`AssistantContextBundle` 原 `extra=forbid`（契约里仍是 `additionalProperties:false`），放宽前带 `budget` 会 422，此前仅有前端「snake_case 序列化」测试覆盖发送侧、无后端接收侧守卫。

## 本地验证结果（均由 AI 侧实跑）

- `npm --prefix apps/desktop/frontend run typecheck`：通过（`tsc --noEmit` 静默）。
- `npm --prefix apps/desktop/frontend run test`：**31 passed / 0 failed**（含新增 `patch-hunks`、`tauri-fs` 缓存合流/失效、`budget` snake_case、provider 连接态四组）。
- `pnpm.cmd -w run lint`：`eslint .` 零 error 零 warning；`prettier --check` 全部符合。
- `pnpm.cmd --filter @storyforge/shared test`：通过（`tsc --noEmit`）。
- `pnpm.cmd -w run openapi`：重生成成功，契约 diff 仅 `budget`（见上）。
- `cd apps/api && uv run pytest tests/test_assistant_revise.py -q`：6 passed；`uv run ruff check tests/test_assistant_revise.py`：All checks passed。
- `cd apps/api && uv run pytest -q`（全量）：**643 passed / 3 skipped**，7m46s——additive `budget` 字段对全后端零回归。

## 未联通 / 待办（沿用上轮，本轮未触）

- 真实正文章节（`正文/`）有料三视角审稿 + 长章修订、真模型「审稿来源」行的人工核对——仍未跑，作为下一步。
- 左下 provider 卡片：上轮「模型服务未检测」写死占位本轮已由 `App.tsx` 改为按 `describeProviderConnection(settings.provider)` 显示真实连接态（`app-icons` 测试已断言「缺少密钥引用」、否定旧占位），但仍非真实健康探针。
- `pnpm e2e`（真实 HTTP 契约回归）需 docker 全栈，本轮未起；契约 diff 已用 `pnpm openapi` 静态核对仅 `budget`。

记录时间戳：2026-06-26（静态门禁收口：lint 转绿 + OpenAPI 刷新 + budget 后端回归守卫）。

---

# Provider 真实健康探针（Desktop IDE 设置→测试连接）（2026-06-27）

## 背景与目标

桌面 provider 卡片此前是写死/静态状态：`describeProviderConnection(settings.provider)` 只看 localStorage 里用户填的 `kind/baseUrl/model/apiKeyRef`，并不真的连接任何模型服务；验证报告两次标为 Phase B 待修。本轮补一个**真实**健康探针。

关键架构事实（已核实）：桌面 localStorage 的 provider 设置**当前并不驱动后端真实 LLM 调用**——`apps/desktop/src-tauri/src/main.rs` 只把 API 通道（base_url/api_key）注入前端，不注入 `STORYFORGE_LLM_*`；后端 `revise`/`review` 真正用 `resolved_llm_env()`（进程环境 + pydantic settings，`book_generation.py:138`）。因此探针探的是**后端实际使用的那份配置**，回答「我的 Agent 现在真能连上模型吗」。用户拍板：**只在设置页加「测试连接」按钮**、**只打 GET `/models`**（免费、快）。

## 交付物

- **后端新端点 `GET /api/assistant/provider-health`**（始终 200 返回结构化诊断，不抛 HTTP 错误、不回显凭据）：
  - `schemas.py`：新增 `ProviderHealthResponse`（status: ok/unreachable/unauthorized/misconfigured、reachable、base_url、model、latency_ms、model_count、detail、missing_env）。
  - `service.py`：新增 `probe_provider_health()` + 可注入 `_fetch_provider_models(source,*,timeout)`。复用现成件不加依赖：`missing_book_generation_env()`（缺环境变量直接 misconfigured，**不发网络**）、`resolved_llm_env()`、`_llm_request_headers()`（鉴权）、`_required_env`/`_env_value`/`_optional_float`，并镜像 `_call_llm` 的 `urllib` + 错误处理。timeout 取 `min(STORYFORGE_LLM_TIMEOUT_SECONDS, 15)`。映射：2xx→ok（带 model_count/latency）、401/403→unauthorized、其它 HTTP/连接失败/超时→unreachable。
  - `router.py`：注册端点；无 `SessionDependency`（不读库），鉴权/限流走全局中间件。
- **前端「测试连接」UI**：
  - `provider-config.ts`：新增 `ProviderHealth` 类型 + 纯函数 `describeProviderHealth()`（status→{tone,label}）。
  - `api-client.ts`：新增 `probeProviderHealth()`，镜像既有 GET 模式（`getApiConfig()` + `X-StoryForge-API-Key` + `readErrorDetail`），snake→camel 映射。
  - `SettingsView.tsx`：模型服务卡片底部加 `ProbeRow`（按钮 + idle/检测中/可达/鉴权失败/不可达/未配置 实时态，`data-testid=provider-health-probe|provider-health-status`），文案明确「探后端实际配置，可能与上方刚填字段不同」。
- **安全**：密钥只在请求头、绝不进响应体；`detail` 截断（≤500），`base_url` 可回显（无密钥）。有一条「不泄密」测试固定该不变量。

## 本地验证结果（均 AI 侧实跑）

- 后端 `uv run pytest tests/test_assistant_provider_health.py -q`：**5 passed**（ok / misconfigured 不发网络 / unauthorized / unreachable / 不泄密）；`uv run ruff check tests + app/domains/assistant`：All checks passed。
- 前端 `npm run typecheck`：通过；`npm run test`：**34 passed / 0 failed**（含新增 3 个 `describeProviderHealth` 用例）。
- `pnpm.cmd -w run lint`：eslint 零 error 零 warning + prettier 全绿。
- `pnpm.cmd -w run openapi`：契约 diff **纯增 109 行 / 0 删**——仅 `/api/assistant/provider-health` path + `ProviderHealthResponse` schema，无其它漂移。
- 全量 API 回归 `uv run pytest -q`：复跑 **648 passed / 3 skipped / 0 failed**（= 原 643 + 本轮新增 5）。首跑曾偶发 1 例失败 `test_book_generation_parallel.py::...defaults_to_precommit_revision_dependency`，核为**既有并发计时 flaky**：该用例断言并发 runner 逐章提交交错顺序 `committed_before_generate == {1:0,2:1,3:2}`，重负载下线程抢占即失败；单测隔离稳过、仓库无 pytest-randomly 故新增测试文件不改既有用例相对顺序、本轮改动均为 assistant 域纯增量未触 book_generation 并发 runner；同序复跑即全绿。判为无关 flaky，按「不顺手改无关代码」未动该用例，仅在此留痕。

## 不做 / 诚实边界

- 不改常驻侧栏 provider 卡片（仍静态 `describeProviderConnection`）；不做自动探/缓存。
- 不打 chat/completions（只验可达+鉴权+列模型，不验模型名真能生成）。
- 不把 localStorage provider 设置接进后端真实调用链路（更大的独立改动）；探针只探后端 env 配置。
- 未跑真机 Tauri 手动点按（需真 provider）；机制由单测 + 契约覆盖，真机点按建议下次随真实审稿一并核对。

记录时间戳：2026-06-27（Provider 真实健康探针：后端 /provider-health + 设置页测试连接）。

---

# 剧情分支画布（Source Control Graph for Fiction）Phase 1

## 做了什么

把桌面 IDE 现有「每文件、扁平、按时间倒序」的版本快照（`.storyforge/versions/<相对文件>/<时间戳>.snapshot.md`）升级为**可分支的树/图**，给作者「平行宇宙」上帝视角。纯桌面本地，不动后端、不改 OpenAPI 契约。

- **血缘进 meta**（`src/lib/versions.ts`）：`VersionEntry`/`VersionSnapshotMetadata` 增 `parentId`/`branchId`/`branchLabel`；`snapshotBeforeWrite` 落盘这三字段并改为返回 `{ path, timestamp }`（e2e 未消费旧返回值，安全）。
- **分支清单与血缘工具**（新 `src/lib/branches.ts`）：每文件一份 `.storyforge/versions/<相对文件>/branches.json`（activeBranchId + branches[id,label,color,baseNodeId,headNodeId]）；`loadBranchManifest`/`saveBranchManifest`/`createBranch`/`setActiveBranch`/`setBranchHead`/`getActiveBranch`/`buildGraph`。缺清单/旧线性快照按 timestamp 顺序回退为单条主线，不伪造数据。
- **画布视图**（新 `src/components/BranchCanvas.tsx`）：按 branchId 分泳道的 git-graph 式列表，节点显示时间/来源/摘要；选中后出「恢复到编辑器 / 从此开分支 / 对比父版本」，对比复用 `patch-hunks.ts` 的 `buildPatchHunks`。
- **接线**（`src/components/Editor.tsx`）：编辑器持 per-file `branchManifest`；`handleSave` 与 `writeAcceptedSuggestion`（既有规范写回路径）落快照时带 `branchId=活动分支`、`parentId=分支当前 head`，写盘后推进 `branches.json` 的 head；`VersionHistory` 面板加「列表 / 分支图」切换；「从此开分支」「checkout」复用既有 `handleRestore`（载入标脏、由作者确认保存）。

## 本地验证结果（均 AI 侧实跑）

- `npm --prefix apps/desktop/frontend run typecheck`：通过（0 error）。
- `npm --prefix apps/desktop/frontend run test`：**42 passed / 0 failed**（含新增 8 个 `branches.test.ts` 用例：建分支、活动分支切换、tip 推进、normalize 保 main、buildGraph 旧线性回退、显式血缘分泳道、缺清单回退、清单写盘往返）。
- `pnpm.cmd lint`：**exit 0**，eslint 0 error + prettier 全绿；仅余 1 条**既有非阻断** warning（`Editor.tsx` `onRequestSave` effect 的 `handleSave` 缺依赖，经 `git show HEAD` 核实为改动前即存在，非本轮引入）。

## 不做 / 诚实边界

- **单章文件粒度**：分支是某一章正文的平行修订线；跨章节「整条剧情线」的故事级时间线留 Phase 2。
- **节点即真实保存快照**：节点按保存时的活动分支着色与连线，是对真实保存的如实表达，非内容寻址的完美 git fork；从某节点开分支后的首次保存仍快照当时磁盘内容。
- **未接 AI 生成分支**：Phase 1 只做手动开分支 + 导航/回放/对比；让 AI 写一条替代分支留 Phase 2（接 assistant/ide 修订端点 + 登记 AgentRun）。
- **Fact-Ledger 级 diff / auto-merge** 留 Phase 2（作后端业务判定）。
- 未跑真机 Tauri 手动点按；机制由单测覆盖，真机走查（打开章 → 历史 → 分支图 → 从某版本开分支 → 编辑保存 → 确认新节点挂新分支、主线不受影响 → checkout 回主线）建议下次随真实审稿一并核对。

记录时间戳：2026-06-27（剧情分支画布 Phase 1：单章版本分支图，纯桌面本地）。

---

# 真机审稿通读 端到端走查（2026-06-27 起，证据骨架）

## 背景与目标

兑现 CLAUDE.md 8.1 下一步第 1 项 + 第 8 节诚实边界「不能宣称真实 Tauri 桌面端到端写回确认链路已经完成」。
本节是**待填证据骨架**：AI 侧已做完链路走通性预检（下表），真机点按 + 真模型审稿 + 人工通读由作者在本机执行后回填「待填」处。一次干净的闭环跑完即可把上述边界翻成「已完成」。

## AI 侧预检结论（2026-06-27，只读核实，未改码）

工作树 `master@b1706db` 干净；provider 探针（PR #11）在位。逐环核实链路已接通：

| 环节 | 实现位置 | 状态 |
| --- | --- | --- |
| 打开文件 | 文件树 + Monaco | ✓ 已接 |
| 触发三视角审稿 | CommandPalette「审查当前文件」/ 聊天框 / `@剧情 @人物 @文风 @伏笔` → `emitReviewCurrentFile` → 后端 Agent Orchestrator | ✓ 已接（CLAUDE.md 8.1.4 列为待做，实为文档滞后） |
| 审稿来源诚实标注 | `ChatWindow.reviewSourceLine`：真模型三视角 / 混合 / 全失败降级 / 启发式 四态 | ✓ 已接 |
| 指定问题修订 | 按视角「只修剧情问题」+ 按 issue id（`reviseReviewIssue` / `extractIssueScopeFromInstruction`） | ✓ 已接 |
| diff 确认 | `PatchReviewPanel`，hunk 级接受（`applyPatchHunk`） | ✓ 已接 |
| 写回落盘 | `writeAcceptedSuggestion` → `TauriFileSystem.writeFile` | ✓ 已接 |
| 版本记录 | 写回前 `snapshotBeforeWrite`（存 `.storyforge/versions/`）+ `advanceBranchHead`（#12 血缘）；侧栏「版本记录」可还原 | ✓ 已接 |

## 配置前提（最易踩空的坑）

设置页 provider 卡只存 localStorage，**不驱动后端真实 LLM**。后端审稿走 `resolved_llm_env()`，只认 4 个必填环境变量；`resolved_llm_env` 会读根目录 `.env.local`（已 gitignore，凭据不入库），故不必手动 export。漏配任意一项 → 审稿**静默降级为启发式关键词检查**，本轮通读作废。

```
STORYFORGE_LLM_PROVIDER=...      # 任意非空，标识用途
STORYFORGE_LLM_BASE_URL=...      # OpenAI 兼容 base（含 /v1）
STORYFORGE_LLM_MODEL=...         # 要测的模型
STORYFORGE_LLM_API_KEY=...       # 真密钥（仅本机 .env.local）
```

必填项来源：`apps/api/app/domains/book_runs/book_generation.py:55` `REQUIRED_REAL_LLM_ENV`。

## 走查清单（真机，按序回填 [x]）

- [ ] 1. `.env.local` 写好上述 4 项
- [ ] 2. `pnpm dev`（Windows `pnpm.cmd dev`）起 API + 迁移 + Tauri 窗口
- [ ] 3. 设置 → 模型服务 → **测试连接**，看到 `✓ 后端模型服务可达 · {model} · {ms} · {n} 个模型`（非 `✓` 则停下修 env）
- [ ] 4. 打开一篇真实 `正文/` 章节（首轮建议 3000–6000 字，勿一上来 3 万字）
- [ ] 5. 「审查当前文件」→ 等三视角报告
- [ ] 6. 确认审稿来源行为「真实模型三视角」（降级/启发式 → 本轮作废，回第 3 步）
- [ ] 7. 挑一个具体 issue → 定向修订（或「只修剧情问题」）
- [ ] 8. `PatchReviewPanel` 逐 hunk 看 diff → 接受
- [ ] 9. 写回 → 回编辑器看新正文 → 侧栏「版本记录」确认快照生成 + 可还原
- [ ] 10. 人工通读修订后章节：修订是否真解决 issue、有无引入新崩坏/文风跑偏

## 待填结果（作者本机执行后回填）

- 执行人 / 时间：（待填）
- 模型（base/model）：（待填，base_url 可记，**密钥不入此报告**）
- 测试连接探针结果：（待填，如 `ok · {model} · {ms} · {n}`）
- 受测章节 / 字数：（待填）
- 审稿来源行原文：（待填，须为「真实模型三视角」方为有效）
- 三视角 issue 数（剧情/人物/文风/连续性）：（待填）
- 选中定向修订的 issue id 与指令：（待填）
- diff 是否逐 hunk 合理：（待填）
- 写回是否成立（新正文落盘）：（待填）
- 版本记录是否生成 + 可还原：（待填）
- **人工通读结论**（修订是否真解决问题 / 有无新崩坏 / 通过 or 退回）：（待填）

## 诚实边界

- 一次干净闭环**能翻**：第 8 节「不能宣称真实 Tauri 桌面端到端写回确认链路已经完成」→ 已完成。
- **不能翻**：真实 3-5 万字**长程**质量验收（属 30 章重跑那条，单独事项）；也不等于「自动审计 = 人工通读」。
- 本节结果为「待填」时，上述边界**维持原状不得宣称**。

记录时间戳：2026-06-27（真机审稿通读证据骨架；AI 侧预检完成，真机点按 + 人工通读待作者回填）。

---

# 真机审稿通读 执行结果（2026-06-27，作者本机实跑 + AI 协查）

## 环境

- 真机 Tauri 桌面端，真模型 `deepseek-v4-flash`，凭据经根目录 `.env.local`（gitignore）注入后端 `resolved_llm_env`。
- 设置→模型服务→测试连接探针返回 `ok`，审稿全程子代理均标 `模型 deepseek-v4-flash`、审稿来源行为「真实模型三视角」，确认走真模型而非降级。
- `pnpm dev` 首次启动撞 `spawn EINVAL`（Windows + Node 22 对 `.cmd` shim 收紧），已由 PR #15 修复后方可起栈。

## 跑了两轮

**轮 1（对象错，已回滚）**：作者误把 `.codex` 目录当项目根打开，审/改的是 `.codex/导出/20260627-033920-book.md`——一份旧 BookRun 导出制品，非 `正文/` 源章节。对单条 prose 指令，`file.revise` 把整篇 841 行连同导出头/frontmatter 全量重写（`+835/-842`）。已 AI 侧从写回前快照逐字节还原该导出，并清除误写入证据目录的 `.codex/.storyforge/` 整棵树（snapshot/meta/branches.json/author-loop 共 4 文件）。

**轮 2（机制跑通，独立文件 `D:\testsf\test.md`）**：真模型三视角审稿 → `file.revise`（scope 到 prose-1..5）→ judge 自检(0) → PatchReviewPanel diff → 接受 → 写回落盘 → 写回前版本快照生成。AI 比对快照与改后文件：确实只压缩了点名的雾气意象与旧伤细节（如「撕开浓雾／像被雾水泡胀的铜钟」删减、「颜色比周围皮肤浅／疤痕表面微微发紧」删除），净缩约 2%；`+394/-394` 是中文整行计差噪声而非全篇重写。

## 暴露的真 bug

1. **意图误路由（已修，PR #16）**：审稿报告「只修此条／修选中问题／只修剧情·文风」三个修订按钮的话术含「问题/节奏/结构」，恰是后端 `_detect_intent` 的 `file.review` 关键词且 review 判定先于 revise，导致点修订按钮恒被判成再次审稿、出不了补丁；轮 1 能改纯属 issue 文本碰巧含「保存」。修复让前端显式传 `intent=file.revise`（后端 `orchestrator.py:776` 早已支持显式 intent 覆盖关键词）。轮 2 的 workaround 是在聊天框打含「改写」、避开审稿关键词的话术，手动触发 `file.revise`。
2. **`file.revise` 范围越界（已缓解 + 可见，PR #18）**：接口是「整文件进→整文件出」，模型即便拿到窄指令也倾向重写——轮 1 单条指令重写全篇（含 metadata），轮 2 虽方向对但「其余别动」未严格守住（顺手删了与指令无关的「手绘」等词）。**根因**：service 层修订契约只说「只输出修订后的完整正文」，无「未点名处逐字照抄」约束；且 narrow 检测有洞——轮 2 那条「…其余别动」既无 review_report 又不匹配 `别改X` 正则，scope 完全没生效、原样进模型。**修复（live 路径 `agent_runs/runtime.py`）**：① 除非指令显式要求全文重写（全文/通篇/整体重写…），否则一律按 narrow 处理，向指令注入**最小改动契约**（未点名段落/标题/frontmatter 逐字保留）；② 落地后按行级前后缀裁剪算改动比例，narrow 但改动 >50% 即在 `agent_result.scope_warning`、`tool_trace` 与 summary 里挂越界提醒；③ service 系统提示加一句默认最小改动。前端把 `scope_warning` 透到 `PatchReviewPanel`，引导逐 hunk 复核（hunk 闸 PR #12 已具备）。**诚实边界**：这是「降低概率 + 越界可见」的软约束，非结构化硬保证——仍可能漂移，故保留逐 hunk 接受作为最终闸；未上 search/replace 结构化协议（中端模型可靠性差、违反小步）。`ide/orchestrator.py` 内同名 legacy 实现仅 `legacy.orchestrator` 工具可达、file.revise 不路由到它，本次未改（既有重复逻辑，未顺手去重）。
3. **审稿非确定性（观察）**：同一 `test.md` 连审三次，剧情视角问题数 1→6→0 来回跳，且首轮 `plot-agent` 降级为启发式预扫。`deepseek-v4-flash` 在当前温度下 run-to-run 漂移明显，issue id 不跨轮稳定（故「修选中 plot-1…」可能指向已失效的旧 id）。

## 里程碑状态与诚实边界

- **端到端写回确认链路（开文件→真模型审稿→定向修订→diff→接受→写回→版本记录）这次在真机/真模型/真磁盘上完整执行成立**，含写回前快照。
- 但有两个星号：经聊天 workaround 触发（修订按钮在 PR #16 前坏，**修后经按钮路径的复跑尚未做**）；受测对象是合成 smoke 草稿 `test.md` 而非真实 `正文/` 章节项目。范围越界 bug#2 已在 PR #18 缓解 + 可见（软约束，非硬保证）。
- 因此 CLAUDE.md 第 8 节「不能宣称真实 Tauri 端到端写回确认链路已经完成」**是否改写，留待作者确认**——本报告只记录链路已演示，不擅改上位规范。
- **仍不能宣称**：真实 3-5 万字长程质量验收；真实 `正文/` 章节的人工通读结论（test.md 非真稿，且修订质量判断仍是作者待办）；也不等于「judge 给 0 = 人工通读通过」。

## 验证（AI 侧实跑）

- PR #16 修复：前端 `typecheck` + `verify-unit` **43 测试**（含新增 api-client intent 转发断言）+ `pnpm.cmd -w run lint` 全绿；后端 `test_ide_agent_orchestrator` **21 passed**（含新增 `_detect_intent` 显式 intent 覆盖关键词单测）。
- PR #15 修复 `spawn EINVAL`：同机 `spawnSync('npm.cmd')` `shell=false→EINVAL`、`shell=true→status 0`。

记录时间戳：2026-06-27（真机审稿通读执行结果：机制端到端跑通于 `D:\testsf\test.md`；发现并修复意图误路由 PR #16，范围越界与审稿非确定性待办；真实 `正文/` 人工通读未完成）。

# file.revise 范围越界收口（bug#2，2026-06-27，PR #18）

承接上节 bug#2。**只改 live 路径**：定位发现桌面 WS 修订实际由 `apps/api/app/domains/agent_runs/runtime.py::_file_revise` 服务（`ide/orchestrator.py` 仅 `legacy.orchestrator` 工具可达，file.revise 不路由到它，是死路）；故修复落在 runtime，未动 legacy 死路（既有重复逻辑未顺手去重）。

## 改动

- `agent_runs/runtime.py`
  - `_resolve_revise_scope`：新增 `narrow` 判定 + `_is_broad_revise`。有显式 scope 信号（selected_ids/included/excluded/constraints）或指令非「全文/通篇/整体重写…」即视为 narrow。补上轮 2「…其余别动」那类自由窄指令的洞。
  - `_scoped_revise_instruction`：narrow 时无条件注入**最小改动契约**（未点名段落/句子/标题/空行逐字保留，不动 frontmatter/导出头，未点名处与原文逐字一致）——即使无 review_report。
  - 新增 `_revise_drift_ratio`（按行裁前后缀，与前端 diff 同口径）+ `_scope_warning`（narrow 且改动 >50% → 返回含 message/drift_ratio/changed_lines 的提醒）。
  - `_file_revise` 落地后挂 `scope_warning` 到 output、`tool_trace.output_summary` 与 summary；chapter_polish 结果装配处透到 `agent_result.scope_warning`。
- `assistant/service.py`：`_REVISE_SYSTEM_PROMPT` 加一句默认最小改动、不扩大范围（直连 `/api/assistant/revise` 也受益）。
- 前端：`assistant-suggestions.ts` 加 `scopeWarning` 字段并写入 note；`ChatWindow.tsx` 导出 `scopeWarningFromAgentResult` 并传入 suggestion；`PatchReviewPanel.tsx` 在 summary 下渲染 ⚠ 范围提醒，引导逐 hunk 复核。

## 诚实边界

- 软约束 + 越界可见，**非结构化硬保证**：模型仍可能漂移，逐 hunk 接受（PR #12）是最终闸。未上 search/replace 结构化协议（中端模型可靠性差、违反小步推进）。
- 仅 live 路径已修；legacy `ide/orchestrator.py` 同名实现未改（死路）。
- 未在真机/真模型复跑按钮路径（需作者本机），本轮为 AI 侧代码 + 单测收口。

## 验证（AI 侧实跑）

- 后端 `cd apps/api && uv run pytest -q` → **656 passed, 3 skipped**（全量回归）。新增 7 例：narrow 自由指令注入最小改动契约 / 全文重写跳过 / drift ratio 小改与全改 / scope_warning 仅 narrow+大改触发 / WS narrow 挂警告 + summary + tool_trace / WS broad 不挂警告。
- `uv run ruff check app/domains/agent_runs/runtime.py app/domains/assistant/service.py tests/test_ide_agent_orchestrator.py` → All checks passed。
- 前端 `npm --prefix apps/desktop/frontend run typecheck` 干净；`run test` → **46 测试全过**（+3：`scopeWarningFromAgentResult` 提取、suggestion note 含/不含范围提醒）。
- `pnpm.cmd -w run lint` 全绿；`pnpm.cmd -w run openapi` → 快照零 diff（未动路由签名；`scope_warning` 走 WS agent_result 自由字段，不入 OpenAPI）。

记录时间戳：2026-06-27（bug#2 file.revise 范围越界收口：runtime 最小改动契约 + narrow 检测补洞 + 行级 drift scope_warning + 前端补丁面板提醒；软约束非硬保证，逐 hunk 闸保留；按钮路径真机复跑仍待作者）。

---

## 2026-06-27 架构优雅化整改 · 第 1 刀 + 计划文档

**范围**：`agent_runs/runtime.py`（live Agent 路径，1696 行 god-file）零行为变更结构拆分；并把后续 backlog 落成计划文档。

- 抽出 `agent_runs/revise_scope.py`（file.revise 范围/指令解析纯函数：最小改动契约、scope 解析、类别/序号识别、drift 越界 `scope_warning`）+ `agent_runs/_text.py`（通用文本原语）。
- `runtime.py` 改为 import，**1696 → 1412 行（−293）**；`test_ide_agent_orchestrator.py` 被测函数 import 指向新模块。
- 纯文件级移动，无逻辑/签名/契约变更；确认未触碰仍被 live 引用的 legacy `ide/orchestrator.py`。

**验证**：
- `uv run ruff check app/domains/agent_runs/ tests/test_ide_agent_orchestrator.py` → All checks passed。
- `uv run pytest test_ide_agent_orchestrator.py test_agent_runs.py test_assistant_revise.py` → **60 passed**。
- `uv run pytest test_ide_commands.py test_ide_context_snapshot.py test_ide_run_events.py test_runtime_tools.py` → **16 passed**。
- `uv run python -c "import app.main"` → OK。
- 行尾纠偏：runtime.py 统一为 LF（与仓库主流一致），消除 CRLF↔LF 噪声，diff 收敛为 −293/+9。

**产出**：PR #19（拆分）、PR #20（计划文档 `docs/internal/refactor-elegance-plan.md`，分级 backlog A-F + 执行原则 + 推荐顺序 + 验证门禁）均已合入 master。

---

## 2026-06-27 架构优雅化整改 · A3 + A1

**目标**：执行 `docs/internal/refactor-elegance-plan.md` 的 A3、A1，小步继续收敛 live `agent_runs/runtime.py`。

**范围**：
- A3：抽出 `agent_runs/bookrun_summary.py`，承载 bookrun 章节计划、预算摘要、结构化预算、风险摘要 helper。
- A1：抽出 `agent_runs/intent.py`，承载 intent 识别、消息参数解析、角色 hints/mentions 解析 helper。
- `runtime.py` 改为 import 新模块，保留 `SUPPORTED_INTENTS` re-export 兼容；未触碰 `apps/web`，未改 legacy `ide/orchestrator.py`。

**交付物映射**：
- `apps/api/app/domains/agent_runs/bookrun_summary.py`：A3 纯函数簇。
- `apps/api/app/domains/agent_runs/intent.py`：A1 纯函数簇。
- `apps/api/app/domains/agent_runs/runtime.py`：删除本地重复定义，行数约 **1412 → 1315**。
- `apps/api/tests/test_agent_runs.py`：新增 live Agent Runtime intent、role hint、bookrun summary 直接覆盖。
- `.codex/context-summary-refactor-elegance-a1-a3.md`、`.codex/operations-log.md`、`.codex/verification-report.md`：证据链留痕。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py` → All checks passed。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **59 passed**。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_assistant_revise.py tests/test_ide_commands.py tests/test_ide_context_snapshot.py tests/test_ide_run_events.py tests/test_runtime_tools.py -q` → **81 passed, 1 warning**。
- `cd apps/api && uv run python -c "import app.main; print('OK')"` → OK。
- `git diff --check -- apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/intent.py apps/api/app/domains/agent_runs/bookrun_summary.py apps/api/tests/test_agent_runs.py` → 通过。
- `rg` 复核：A1/A3 目标函数已不在 `runtime.py` 内定义。

**风险与边界**：
- `test_assistant_revise.py` 仍有既有 `HTTP_422_UNPROCESSABLE_ENTITY` deprecation warning，不阻断本轮。
- `intent.py` 复用 `AgentOrchestrationError`，通过 `import app.main` 验证无 import 环。
- 这是零行为变更结构拆分，不包含 A2/A4，也不处理 legacy `ide/orchestrator.py` 收口。

**评分**：
- 代码质量：95/100。纯函数簇外移，runtime facade 更薄，未引入新抽象。
- 测试覆盖：93/100。新增直接单测并跑相邻 runtime/IDE/assistant 测试；未跑 API 全量，因本轮只触 agent runtime 纯拆分。
- 规范遵循：95/100。遵循小步、零行为变更、不碰 web、证据链回填。
- 需求匹配：96/100。完成计划推荐顺序中的 A3 与 A1。
- 架构一致：95/100。沿用 `revise_scope.py` 同款模块深ening 手法。
- 风险评估：94/100。主要风险为 import 环与 legacy/live 测试语义混淆，均已验证或规避。

综合评分：95/100。

明确建议：通过。下一刀建议按计划继续 A2（多视角审稿报告构建簇），但需先确认 `SubagentExecutor`/`AgentToolTrace` import 边界避免循环。

---

## 2026-06-27 架构优雅化整改 · A2

**目标**：执行 `docs/internal/refactor-elegance-plan.md` 的 A2，把多视角审稿报告构建簇从 live `runtime.py` 外移。

**范围**：
- 新增 `apps/api/app/domains/agent_runs/review_report.py`，承载 `_build_multi_agent_review_report_with_executor`、review subagent handlers、report mode/finding/summary helpers。
- 新增 `apps/api/app/domains/agent_runs/trace.py`，承载 `AgentToolTrace`，避免 `review_report.py` 反向 import runtime。
- `_compact_text` 下沉到 `agent_runs/_text.py`，供 runtime 与 review_report 共用。
- `runtime.py` 改为 import review report helper，继续保留 runtime facade/tool 注册职责。
- `service.py` 改为直接从 `trace.py` import `AgentToolTrace`；`AgentRuntime` 仍从 runtime import。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py` → All checks passed。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **59 passed**。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_assistant_revise.py tests/test_ide_commands.py tests/test_ide_context_snapshot.py tests/test_ide_run_events.py tests/test_runtime_tools.py -q` → **81 passed, 1 warning**。
- `cd apps/api && uv run python -c "import app.main; print('OK')"` → OK。
- `git diff --check -- apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/review_report.py apps/api/app/domains/agent_runs/trace.py apps/api/app/domains/agent_runs/_text.py apps/api/app/domains/agent_runs/service.py apps/api/tests/test_agent_runs.py` → 通过。
- `rg` 复核：A2 目标函数定义仅在 `review_report.py`，`AgentToolTrace` 定义仅在 `trace.py`。

**结果**：
- `runtime.py` 行数约 **1315 → 1018**，从第一刀后的 1412 行继续收敛为更薄的 Runtime facade。
- 多视角审稿相关行为路径未改，已有 heuristic/llm/mixed/llm_failed 测试保持通过。

**风险与边界**：
- `test_assistant_revise.py` 仍有既有 422 deprecation warning，不阻断本轮。
- 本轮为必要解环只抽 `AgentToolTrace`，未提前执行 A4 的 `ToolDefinition` / `ToolRegistry` / `PermissionGate` / `SubagentExecutor` 全量下沉。
- 未触碰 legacy `ide/orchestrator.py`。

**评分**：
- 代码质量：95/100。审稿报告构建 locality 明显提升，runtime 职责更清。
- 测试覆盖：94/100。复用现有多模式审稿测试，覆盖 A2 主要分支。
- 规范遵循：96/100。小步、零行为变更、不碰 web、证据链完整。
- 需求匹配：96/100。完成计划 A2，并用 trace 解环控制风险。
- 架构一致：95/100。沿用 agent_runs 内薄模块拆分方式。
- 风险评估：94/100。主要风险 import 环已由 `import app.main` 和 focused tests 验证。

综合评分：95/100。

明确建议：通过。下一刀可进入 A4，但 A4 涉及 runtime 工具/权限骨架，应单独审计 import 边界后再动。

---

## 2026-06-27 架构优雅化整改 · A4

**目标**：执行 `docs/internal/refactor-elegance-plan.md` 的 A4，把 Agent Runtime tool/permission 脚手架下沉到独立模块。

**范围**：
- 新增 `apps/api/app/domains/agent_runs/tooling.py`，承载 `ToolDefinition`、`ToolResult`、`ToolExecutionContext`、`PermissionDecision`、`SubagentDefinition`、`ToolRegistry`、`PermissionGate`、`SubagentExecutor`、`ToolHandler`。
- `runtime.py` 改为 import tooling 类型并继续负责 facade、tool 注册、执行与事件记录。
- `EventSink` 保留在 `runtime.py`，不扩大 A4 范围。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py` → All checks passed。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **59 passed**。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_assistant_revise.py tests/test_ide_commands.py tests/test_ide_context_snapshot.py tests/test_ide_run_events.py tests/test_runtime_tools.py -q` → **81 passed, 1 warning**。
- `cd apps/api && uv run python -c "import app.main; print('OK')"` → OK。
- `git diff --check` → 通过。
- `rg` 复核：A4 目标类定义只在 `tooling.py`。

**结果**：
- A 区完成：A3、A1、A2、A4 均落地。
- `runtime.py` 从计划时 **1412 行** 收敛到约 **920 行**；若从 PR #19 前 1696 行计，累计收敛约 776 行。
- live Agent 路径仍保留原工具注册和执行流程，未改 OpenAPI/路由/前端。

**风险与边界**：
- `test_assistant_revise.py` 仍有既有 422 deprecation warning，不阻断本轮。
- 本轮未执行 B/E/C 等审计型条目；按计划后续应先做 E1 或大文件范围审计。
- 未触碰 legacy `ide/orchestrator.py`。

**评分**：
- 代码质量：96/100。tooling locality 提升，runtime facade 显著变薄。
- 测试覆盖：94/100。权限、子代理、WebSocket、审稿/修订、runtime tools 相邻链路均通过 focused regression。
- 规范遵循：96/100。小步拆分、零行为变更、不碰 web、证据链完整。
- 需求匹配：97/100。完成 A 区推荐顺序全部条目。
- 架构一致：96/100。遵循前几刀同款薄模块拆分方式，未引入新框架。
- 风险评估：95/100。import 环与权限/子代理行为已由 import smoke 和相关测试验证。

综合评分：96/100。

明确建议：通过。`agent_runs/runtime.py` 已从最大 live god-file 收敛为 Runtime facade + tool 注册骨架；下一阶段按计划进入 E1 legacy 边界审计或 C1/B1 范围审计。

---

## 2026-06-27 架构优雅化整改 · E1（审计型，零代码改动）

**目标**：执行 `docs/internal/refactor-elegance-plan.md` 第 E 区 E1，画出 legacy `ide/orchestrator.py`（1389 行 / 53KB）内部「live 被引用」与「仅 legacy 兜底分支可达」的边界，作为 E2 的前提。

**范围**：
- 新增审计文档 `docs/internal/e1-ide-orchestrator-boundary.md`（跨边界符号表、路由边界、函数级 live/死集分区、漂移风险、E2 落点建议）。
- 未改任何 `.py`；orchestrator.py 与 agent_runs 源码原样保留。

**核心结论**：
- 跨边界进 live 的符号仅两个：`AgentOrchestrationError`（恒被 runtime/service/intent/review_report/tooling 5 处引用）、`orchestrate_agent_message`（仅 `chapter.review`/`chapter.repair` 落 `else` 分支时经 `legacy.orchestrator` 工具触发）。
- live runtime 已直接接管 `chat.explain`/`file.review`/`file.revise`/`bookrun.start`；对应的 4 个 `_orchestrate_*` 入口及其独占 helper 簇（multi-agent 审稿、revise-scope 解析、bookrun 摘要）经 live 路径**恒不可达**。
- legacy 实际仍在服务的净资产只有 `chapter.review`/`chapter.repair` 两条 `judge.run`/`judge.repair` 编排。
- 发现行为漂移：live `intent.py._detect_intent` 比 legacy 多一条 `_has_reviewer_role_hint → file.review` 分支，两份判定已不等价（不改变本轮可达集，但是 E2 必须对账的风险）。

**本地验证（佐证边界，非行为变更验证）**：
- `cd apps/api && uv run python -c "import app.main"` → `import ok`（无 import 环、文件可载）。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **59 passed（60.89s）**，覆盖 live 分流、`legacy.orchestrator` fallback monkeypatch、legacy `_detect_intent` 语义。
- 全仓 `rg 'ide\.orchestrator|orchestrate_agent_message'`：live 引用仅 `agent_runs/{runtime,service,intent,review_report,tooling}.py` + 测试；`ide/router.py`、`ide/service.py` 不引用 orchestrator。

**风险与边界**：
- 「死集」指经 live 运行路径不可达，仍可能被测试或未来直接调用方触达，删除须随 E2 一并评估，本条目不删任何代码。
- 行号以当前 master（A 区合并后）为准；plan 中 E1 原列的 runtime.py:30/624/809 是 A 区前旧行号，已漂移，本审计采用当前行号。

**结果**：E1 完成，产出 `docs/internal/e1-ide-orchestrator-boundary.md`，为 E2 提供可执行的迁移顺序（先迁 `AgentOrchestrationError` 解 5 处依赖 → 再迁 `chapter.*` 编排收缩 fallback → 死集随迁随删）。

**明确建议**：通过。E1 为审计型条目，零行为变更、证据链完整；E2 涉及对外行为收缩，按 plan 须单独评审后再动刀。
