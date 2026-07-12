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

## B1 重构验证（2026-06-28）

**条目**：Wave 1 B1 — book_generation.py evidence/metrics 簇提取（零行为变更）

**执行刀**：
1. 新建 book_generation_metrics.py，迁入 17 个纯函数（_result_summary、_evidence_summary、_artifact_*、_per_chapter_*、_latency_*、_aggregate_cost_breakdown 等）及 MARKDOWN_CHAPTER_HEADING_RE。
2. book_generation.py 顶层 facade re-export 全部 17 符号（宪法第 4/5/6 条）。
3. 删除 book_generation.py 内重复定义（原 1654-1879 行）。

**验证门禁**：
- uv run ruff check app/domains/book_runs/book_generation*.py → 通过
- uv run pytest tests/test_book_generation*.py tests/test_multi_round_repair.py tests/test_phase1_context_optimization_verify.py tests/test_book_run_start.py -v → 65 passed, 1 skipped (真实 LLM 测试，与重构无关)

**import 环验证**：import app.domains.book_runs.book_generation as generation → book_generation_parallel.py 通过 generation.name 访问的 30+ 符号全部可达。

**monkeypatch 目标验证**：
- tests/test_book_generation.py 直接 import _evidence_summary → 通过 facade 可达
- .codex/run-real-llm-long-direct.py import _artifact_text, _evidence_summary → 通过 facade 可达
- tests/test_book_generation_long_wrapper.py monkeypatch module._artifact_text → wrapper 模块内的符号，非 book_generation 命名空间，不受影响

**行为变更**：无（零行为变更，纯移动 + facade re-export）。风险高（import 拓扑复杂）但实际落地零破坏。

## E2-1 重构验证（2026-06-28）

**条目**：第 3 层 E2-1 — `AgentOrchestrationError` 迁移到 `agent_runs/errors.py`（零行为变更）

**背景**：E1 审计发现 `AgentOrchestrationError` 是跨 legacy/live 边界的 5 处 live 引用根节点，且「薄模块反向依赖胖模块」的环点。E2-1 是低风险首刀，解除反向依赖。

**执行刀**：
1. 新建 `agent_runs/errors.py`（上一轮已创建），承载 `AgentOrchestrationError` 单类。
2. 5 处 live import 切源：`agent_runs/{tooling,intent,review_report,service,runtime}.py` 全部从 `from app.domains.ide.orchestrator import AgentOrchestrationError` 改为 `from app.domains.agent_runs.errors import AgentOrchestrationError`。
3. runtime.py 同时保留 `from app.domains.ide.orchestrator import orchestrate_agent_message`（legacy fallback，E2-3 时再迁）。
4. `ide/orchestrator.py` 删除本地类定义，改为 `from app.domains.agent_runs.errors import AgentOrchestrationError` re-export（宪法第 5 条兼容契约）。

**验证门禁**：
- `cd apps/api && uv run ruff check ...` → 6 个 I001 import 排序错误，`--fix` 一次性修齐后 All checks passed。
- `cd apps/api && uv run python -c "import app.main"` → OK（无 import 环）。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **59 passed**。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_assistant_revise.py tests/test_ide_commands.py tests/test_ide_context_snapshot.py tests/test_ide_run_events.py tests/test_runtime_tools.py -q` → **81 passed, 1 warning**（422 deprecation，既有，非本轮引入）。

**identity 验证**：`orchestrator.AgentOrchestrationError is errors.AgentOrchestrationError is tooling.AgentOrchestrationError` → 全部 `True`，facade re-export 完整保留 monkeypatch/测试 import 可达性。

**行为变更**：无（纯文件级移动 + facade re-export）。

**影响**：解除 agent_runs 薄模块对 ide/orchestrator 胖模块的反向依赖；为 E2-2（live/legacy `_detect_intent` 对账）、E2-3（迁 chapter.review/chapter.repair 入 live）、E2-4（删死集收尾）铺路。

## B1 LLM cluster 重构验证（2026-06-28）

**条目**：Wave 1 B1 — book_generation.py LLM 簇提取 + errors.py 共享叶子底座（零行为变更）

**执行刀**：
1. 新建 `book_runs/errors.py`，迁入 `BookGenerationError`/`BookGenerationPreflightError` 两个异常类，作为共享叶子底座（避免 LLM/metrics 子模块反向依赖 god-file）。
2. 新建 `book_generation_llm.py`，迁入 LLM 调用辅助函数簇：
   - 正则常量：`THINK_BLOCK_RE`/`THINK_OPEN_RE`/`THINK_CLOSE_RE`
   - 函数：`_strip_reasoning_leak`、`_call_llm`、`_llm_request_headers`、`_token_usage`、`_cost_breakdown`、`_total_cost_estimate`、`_env_value`、`_required_env`、`_optional_int`、`_optional_float`
3. `book_generation.py` 顶层 facade re-export 全部符号（宪法第 4/5/6 条），包括 metrics 簇 16 符号 + LLM 簇 14 符号 + errors 2 符号。
4. 删除 `book_generation.py` 内所有重复定义（异常类 2 个 + 常量 4 个 + 函数 25 个）。
5. 清理遗留 orphan imports（`hashlib`/`urllib.error`/`urllib.request`/`re`）。

**验证门禁**：
- `uv run ruff check app/domains/book_runs/book_generation*.py app/domains/book_runs/errors.py` → All checks passed。
- `uv run python -c "import app.main"` → OK（无 import 环）。
- 42 个符号经 `generation.<name>` 属性访问全部可达（含 `book_generation_parallel.py` 的 20+ 私有符号）。
- `uv run pytest tests/test_book_generation*.py tests/test_multi_round_repair.py tests/test_phase1_context_optimization_verify.py tests/test_book_run_start.py -q` → **65 passed, 1 skipped**（skip 是真实 LLM 测试）。

**import 拓扑验证**：
- `book_generation.py`（facade）→ imports `book_generation_metrics.py`（叶子）+ `book_generation_llm.py`（叶子）+ `errors.py`（叶子）
- `book_generation_llm.py` → imports `book_generation_metrics.py`（仅 `_float_value`）+ `errors.py`
- 无反向依赖，无环。

**monkeypatch 目标验证**：
- `tests/test_multi_round_repair.py` 直接 import `_judge_and_repair_loop`、`MAX_REPAIR_ROUNDS`、`REPAIR_THRESHOLD` → 仍在 god-file，可达。
- `tests/test_book_generation.py` 直接 import 多个符号 → 通过 facade 可达。

**行为变更**：无（纯文件级移动 + facade re-export）。1871 行 → 1484 行 god-file + 264 行 metrics + 192 行 llm + 15 行 errors。

## B1 Judge cluster 重构验证（2026-06-28）

**条目**：Wave 1 B1 — `book_generation.py` Judge & Repair 簇提取（零行为变更）

**执行刀**：
1. 修正并接入 `book_generation_judge.py`，承载 Judge & Repair 深模块：
   - 常量：`REPAIR_THRESHOLD` / `MAX_REPAIR_ROUNDS` / `WORD_COUNT_CEILING_RUNAWAY_FACTOR`
   - 内部评分表：`_SEVERITY_PENALTY` / `_CATEGORY_DIMENSION` / `_SEVERITY_ORDER`
   - 类型：`_JudgeRunResult`
   - 函数：`_judge_and_repair_loop`、`_apply_word_count_floor`、`_run_real_judge`、`_fast_judge_enabled`、`_quality_score`、`_build_judge_payload`、`_book_id_for_scene`、`_maybe_repair`、`_record_summary_judge`
2. `book_generation.py` 顶层 facade re-export 上述符号，保留旧 import 路径和 `generation.<name>` 属性访问。
3. 删除 `book_generation.py` 内重复 Judge & Repair 实现；`book_generation.py` 当前约 1018 行，`book_generation_judge.py` 约 342 行。
4. 保持 `book_generation_parallel.py` monkeypatch/属性访问契约不变。

**验证门禁**：
- `cd apps/api && uv run ruff check app/domains/book_runs/book_generation*.py app/domains/book_runs/errors.py` → All checks passed。
- `cd apps/api && uv run python -c "import app.main; import app.domains.book_runs.book_generation as generation; import app.domains.book_runs.book_generation_judge as judge; assert generation._judge_and_repair_loop is judge._judge_and_repair_loop; assert generation._apply_word_count_floor is judge._apply_word_count_floor; assert generation.REPAIR_THRESHOLD == 70; assert generation.MAX_REPAIR_ROUNDS == 3; print('book_generation_judge_facade_ok')"` → `book_generation_judge_facade_ok`。
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_multi_round_repair.py tests/test_phase1_context_optimization_verify.py tests/test_book_run_start.py -q` → **65 passed, 1 skipped**。

**命令纠偏**：
- `uv run pytest tests/test_book_generation*.py ...` 在 Windows/pytest 参数中未展开，返回 “file or directory not found”；已改为显式文件列表重跑并通过。

**import 拓扑验证**：
- `book_generation.py`（facade）→ imports `book_generation_judge.py` / `book_generation_llm.py` / `book_generation_metrics.py` / `errors.py`。
- `book_generation_judge.py` → imports `book_generation_llm.py`（仅 `_env_value`），不反向 import `book_generation.py`。
- 无反向依赖，无环。

**行为变更**：无（纯文件级移动 + facade re-export）。`tests/test_multi_round_repair.py` 继续从 `book_generation` import `_judge_and_repair_loop`、`REPAIR_THRESHOLD`、`MAX_REPAIR_ROUNDS` 并通过。

## E2-2 对账验证（2026-06-28）

**条目**：第 3 层 E2-2 — live/legacy `_detect_intent` 与 chapter helper 对账（不改码）

**目标**：为 E2-3 迁移 `chapter.review` / `chapter.repair` 入 live 前确认两份实现的行为差异，避免把 `runtime.py` 中的半成品 helper 原样转活造成隐性行为变更。

**对账范围**：
- live intent：`apps/api/app/domains/agent_runs/intent.py::_detect_intent`
- legacy intent：`apps/api/app/domains/ide/orchestrator.py::_detect_intent`
- live chapter helper：`apps/api/app/domains/agent_runs/runtime.py::_judge_run_args_from_scene_packet` 及 `_string_list` / `_dict_list` / `_style_rules`
- legacy chapter helper：`apps/api/app/domains/ide/orchestrator.py::_judge_run_args_from_scene_packet` 及同名 helper

**结论**：
- `SUPPORTED_INTENTS` 集合一致，显式 intent、bookrun args、issue_id、file review/revise 关键词、scene_packet_id、章节审阅关键词等样例分类一致。
- intent 唯一已确认漂移：live 在 `has_file_context + reviewer role hint/mention + 中性话术` 时会返回 `file.review`，legacy 返回 `chat.explain`。这来自 live 新增的 `_has_reviewer_role_hint(args)` 分支。
- `_judge_run_args_from_scene_packet` 主体源码一致：同样查询 `ScenePacket -> Scene -> Chapter`，同样校验 packet 存在和 scene content 非空，同样返回 `scene_id`、`scene_packet_id`、`content`、`required_facts`、`style_rules`、`evidence_links`。
- chapter helper 依赖的三个小 helper 不一致：
  - live `_string_list` 保留原字符串空白与空字符串；legacy 会 `strip()` 并丢弃空字符串。
  - live `_style_rules` 只透传字符串列表；legacy 额外支持 `{"rule": "..."}` dict 项并做 strip/空值过滤。
  - `_dict_list` 在可观测返回上等价，源码形态不同但样例输出一致。

**本地验证（对账 smoke）**：
- `cd apps/api && @'...intent sample matrix...'@ | uv run python -` → 12 个样例中仅 reviewer role hint/mention 漂移，其余 OK。
- `cd apps/api && @'...helper source/output compare...'@ | uv run python -` → `_judge_run_args_from_scene_packet` 为 `IDENTICAL`；`_string_list` / `_style_rules` 漂移样例复现。
- `cd apps/api && uv run ruff check app/domains/book_runs/book_generation*.py app/domains/book_runs/errors.py` → All checks passed（本轮同步复验 B1 touched files）。
- `cd apps/api && uv run python -c "...judge facade identity..."` → `judge facade identity OK`（本轮同步复验 B1 facade identity）。
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_multi_round_repair.py tests/test_phase1_context_optimization_verify.py tests/test_book_run_start.py -q` → **65 passed, 1 skipped**（本轮同步复验 B1 focused regression）。
- `git diff --check -- docs/internal/refactor-master-plan.md .codex/verification-report.md apps/api/app/domains/book_runs/book_generation.py apps/api/app/domains/book_runs/book_generation_judge.py` → 通过（修复上一轮 CRLF/尾随空白噪声）。

**E2-3 约束**：
- 迁 `chapter.review` / `chapter.repair` 入 live 时不能直接把 `runtime.py` 现有 `_style_rules` 转活，否则会丢失 legacy 对 dict 风格规则的支持，并改变字符串 trim/空值过滤。
- 建议 E2-3 先把 legacy chapter helper 语义迁入 `agent_runs/chapter_review.py`，再用 `tests/test_ide_agent_orchestrator.py` 端到端锁定 `judge.run` / `judge.repair` payload。

**行为变更**：无。本条为审计/验证记录，仅更新文档和验证报告。

## B1 Preflight cluster 重构验证（2026-06-28）

**条目**：Wave 1 B1-next — `book_generation.py` env/preflight 簇提取（零行为变更）

**范围审计结论**：
- 选择下沉 `resolved_llm_env` / `missing_book_generation_env` / `_assert_preflight` / `REQUIRED_REAL_LLM_ENV` / `LLM_SETTINGS_ENV_KEYS`，因为该簇被 book generation、assistant、IDE review reasoning、parallel runner、CLI wrapper 共同引用，是真实复用点。
- 暂不拆 pause/failure 记账、CLI `main()`、章节落库/断点重建。它们仍与 `run_book_generation` / `resume_book_generation` 主循环强耦合，贸然外移容易形成浅模块。

**执行刀**：
1. 新建 `apps/api/app/domains/book_runs/book_generation_preflight.py`，承载：
   - `REQUIRED_REAL_LLM_ENV`
   - `LLM_SETTINGS_ENV_KEYS`
   - `resolved_llm_env`
   - `missing_book_generation_env`
   - `_assert_preflight`
2. `book_generation.py` 顶层 facade re-export 上述符号，保持旧路径：
   - `from app.domains.book_runs.book_generation import resolved_llm_env`
   - `from app.domains.book_runs.book_generation import _assert_preflight`
   - `generation.<name>` 属性访问
3. 删除 `book_generation.py` 内重复 env/preflight 定义；`book_generation.py` 当前约 **928 行**，`book_generation_preflight.py` 约 **102 行**。
4. 补 `apps/api/tests/conftest.py` 的测试隔离：autouse fixture 现在清理完整 `STORYFORGE_LLM_*` 配置组，避免 `.codex/run-real-llm-long-direct.py` 测试调用 `main()` 后把 `STORYFORGE_LLM_TIMEOUT_SECONDS=300` 泄漏到 assistant settings fallback 测试。

**验证门禁**：
- `cd apps/api && uv run ruff check app/domains/book_runs/book_generation*.py app/domains/book_runs/errors.py tests/conftest.py` → All checks passed。
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`。
- `cd apps/api && uv run python -c "from app.domains.book_runs import book_generation as generation; from app.domains.book_runs import book_generation_preflight as preflight; assert generation.resolved_llm_env is preflight.resolved_llm_env; assert generation.missing_book_generation_env is preflight.missing_book_generation_env; assert generation._assert_preflight is preflight._assert_preflight; assert generation.REQUIRED_REAL_LLM_ENV is preflight.REQUIRED_REAL_LLM_ENV; print('preflight facade identity OK')"` → `preflight facade identity OK`。
- `cd apps/api && uv run pytest tests/test_assistant_revise.py::test_revise_uses_settings_llm_config_when_env_not_exported -q` → **1 passed**（确认 settings fallback 可读到 monkeypatch 后的 `17.0`）。
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_multi_round_repair.py tests/test_phase1_context_optimization_verify.py tests/test_book_run_start.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py tests/test_ide_agent_orchestrator.py -q` → **104 passed, 1 skipped, 1 warning**（warning 为既有 422 deprecation）。
- `git diff --check -- docs/internal/refactor-master-plan.md .codex/verification-report.md apps/api/app/domains/book_runs/book_generation.py apps/api/app/domains/book_runs/book_generation_preflight.py apps/api/app/domains/book_runs/book_generation_judge.py apps/api/tests/conftest.py` → 通过。

**测试污染发现**：
- 宽回归首次失败在 `test_revise_uses_settings_llm_config_when_env_not_exported`：期望 `STORYFORGE_LLM_TIMEOUT_SECONDS=17.0`，实际读到 `300`。
- 根因不是 preflight 拆分行为变化，而是长跑 wrapper 测试调用 `.codex/run-real-llm-long-direct.py::main()`，该函数直接写 `os.environ["STORYFORGE_LLM_TIMEOUT_SECONDS"] = str(args.timeout_seconds)`；测试夹具此前只清理 API key/base URL，未清理同组 timeout/model/provider 等变量。
- 修复测试隔离后同一宽回归通过。

**import 拓扑验证**：
- `book_generation.py`（facade）→ imports `book_generation_preflight.py` / `book_generation_judge.py` / `book_generation_llm.py` / `book_generation_metrics.py` / `errors.py`。
- `book_generation_preflight.py` → imports `book_generation_llm._env_value` + `errors.py`，不反向 import `book_generation.py`。
- assistant/service 与 ide/review_reasoning 仍从旧 facade 路径 import，identity 验证通过。

**行为变更**：无（纯移动 + facade re-export）。测试隔离修复只影响 pytest 进程，防止跨用例环境污染。

## B1 Progress/CLI cluster 重构验证（2026-06-28）

**条目**：Wave 1 B1-next — `book_generation.py` pause/progress 与 CLI 壳提取（零行为变更）

**范围审计结论**：
- `pause/failure/budget` 三个状态转移函数是一组真实 BookRun 进度写回能力，依赖 `apply_book_run_progress` 与 `BookRunProgressUpdate`，可以作为叶子模块下沉。
- CLI `main()` 是清晰外壳：参数解析、preflight、session_factory、runner 调用、摘要输出。为保持旧默认签名（`runner=run_book_generation`）和测试 monkeypatch 习惯，`book_generation.py::main` 保留薄包装，实际委派到 `book_generation_cli.main`。
- 章节生成、章节落库、断点重建、串行指标仍与主编排强耦合，本轮不拆。

**执行刀**：
1. 新建 `book_generation_progress.py`，迁入：
   - `_pause_by_failure`
   - `_pause_by_interrupt`
   - `_pause_by_budget`
2. 新建 `book_generation_cli.py`，迁入 CLI 参数解析、preflight、runner 调用、summary 输出逻辑。
3. `book_generation.py` 顶层 facade re-export `_pause_*`；`main()` 保留旧签名薄包装并委派到 CLI 模块。
4. 删除 `book_generation.py` 内重复 pause/CLI 实现；`book_generation.py` 当前约 **816 行**，`book_generation_cli.py` 约 **77 行**，`book_generation_progress.py` 约 **69 行**。

**验证门禁**：
- `cd apps/api && uv run ruff check app/domains/book_runs/book_generation*.py app/domains/book_runs/errors.py tests/conftest.py` → All checks passed。
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`。
- `cd apps/api && uv run python -c "from app.domains.book_runs import book_generation as generation; from app.domains.book_runs import book_generation_progress as progress; from app.domains.book_runs import book_generation_preflight as preflight; assert generation._pause_by_failure is progress._pause_by_failure; assert generation._pause_by_interrupt is progress._pause_by_interrupt; assert generation._pause_by_budget is progress._pause_by_budget; assert generation._assert_preflight is preflight._assert_preflight; assert callable(generation.main); print('progress/preflight facade OK')"` → `progress/preflight facade OK`。
- `cd apps/api && uv run pytest tests/test_book_generation_parallel.py::test_book_generation_parallel_runner_defaults_to_precommit_revision_dependency -q` → **1 passed**（单独复跑）。
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_multi_round_repair.py tests/test_phase1_context_optimization_verify.py tests/test_book_run_start.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py tests/test_ide_agent_orchestrator.py -q` → 首次出现 1 个并发 SQLite `refresh` 抖动失败，单测复跑通过；随后全套复跑 **104 passed, 1 skipped, 1 warning**。
- `git diff --check -- docs/internal/refactor-master-plan.md .codex/verification-report.md apps/api/app/domains/book_runs/book_generation.py apps/api/app/domains/book_runs/book_generation_preflight.py apps/api/app/domains/book_runs/book_generation_progress.py apps/api/app/domains/book_runs/book_generation_cli.py apps/api/tests/conftest.py` → 通过。

**import 拓扑验证**：
- `book_generation.py`（facade）→ imports `book_generation_progress.py`；`book_generation_progress.py` 只依赖 `schemas.py` + `service.py`，不反向 import `book_generation.py`。
- `book_generation.py::main` 局部 import `book_generation_cli.main`，避免 CLI 模块在导入期反向绑定 `run_book_generation`。
- `book_generation_cli.py` 只依赖 metrics/preflight/errors 与标准库，不反向 import `book_generation.py`。

**行为变更**：无（纯移动 + facade re-export/薄包装）。CLI 测试继续从旧 `book_generation.main` 调用并通过。

## B1 Records/Serial Metrics cluster 重构验证（2026-06-28）

**条目**：Wave 1 B1-next — `book_generation.py` 证据落库与串行集成指标提取（零行为变更）

**范围审计结论**：
- `draft scene` / `ModelRun` / `ScenePacket` / 最终批准写回是一组真实证据落库能力，既被串行主循环复用，也被 `book_generation_parallel.py` 通过 `generation.<name>` 旧路径调用，适合下沉到叶子模块但必须 facade re-export。
- 串行直跑集成指标 `_serial_integration_metrics` 及三个 helper 已无主流程顺序依赖，适合单独下沉。
- `run_book_generation` / `resume_book_generation`、建书/蓝图、章节生成、断点重建继续留在 `book_generation.py`：它们承载主流程顺序，且 `_default_planning_arcs` / `_generate_chapter` 等仍是测试和并发 runner 的 monkeypatch 硬契约，继续机械外移会制造浅模块。

**执行刀**：
1. 新建 `book_generation_records.py`，迁入：
   - `MODEL_RUN_SUMMARY_MAX_CHARS`
   - `_persist_draft_scene`
   - `_finalize_scene_decision`
   - `_record_model_run`
   - `_model_run_summary_text`
   - `_record_scene_packet`
2. 新建 `book_generation_serial_metrics.py`，迁入：
   - `_serial_integration_metrics`
   - `_direct_memory_recall_budget_used`
   - `_arc_completion_rate`
   - `_chapter_generation_time_p50`
3. `book_generation.py` 顶层 facade re-export 上述符号，保持旧 import 路径和 `generation.<name>` 属性访问。
4. 补回 `BookBlueprint` facade re-export：并发 runner 的 `_arc_consistency_barrier_from_blueprint` 仍通过 `generation.BookBlueprint` 取 ORM 类，这是旧命名空间兼容契约。
5. 删除 `book_generation.py` 内重复实现；`book_generation.py` 当前约 **714 行**，`book_generation_records.py` 约 **139 行**，`book_generation_serial_metrics.py` 约 **75 行**。

**验证门禁**：
- `cd apps/api && uv run ruff check app/domains/book_runs/book_generation*.py app/domains/book_runs/errors.py tests/conftest.py` → All checks passed。
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`。
- `cd apps/api && uv run python -c "...records/serial facade identity..."` → `records/serial facade OK`。
- `cd apps/api && uv run python -c "...BookBlueprint facade identity..."` → `BookBlueprint facade OK`。
- `cd apps/api && uv run pytest tests/test_book_generation_parallel.py -q` → **11 passed**（覆盖并发 runner 旧 facade 访问）。
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_multi_round_repair.py tests/test_phase1_context_optimization_verify.py tests/test_book_run_start.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py tests/test_ide_agent_orchestrator.py -q` → **104 passed, 1 skipped, 1 warning**（warning 为既有 422 deprecation）。

**失败-修复记录**：
- 首次 `tests/test_book_generation.py tests/test_book_generation_parallel.py -q` 出现 5 个并发测试失败：`generation.BookBlueprint` 不可达。
- 根因是本刀移走串行指标后删除了 `BookBlueprint` 顶层 import，破坏了 `book_generation_parallel.py` 的旧 facade 属性访问。
- 修复：恢复 `from app.domains.blueprints.models import BookBlueprint  # noqa: F401  facade re-export`；并发测试与宽回归随后通过。

**import 拓扑验证**：
- `book_generation.py`（facade）→ imports `book_generation_records.py` / `book_generation_serial_metrics.py`。
- `book_generation_records.py` → imports `book_generation_judge.REPAIR_THRESHOLD`、`book_generation_llm._required_env`、ORM/schema/service 叶子依赖，不反向 import `book_generation.py`。
- `book_generation_serial_metrics.py` → imports `BookBlueprint` / `BookRun`，不反向 import `book_generation.py`。

**行为变更**：无（纯移动 + facade re-export）。B1 到达当前合理边界：剩余主循环/蓝图/章节生成/断点重建保留在 facade，避免浅模块和 monkeypatch 契约漂移。

## Wave 0 前端护栏验证（2026-06-28）

**条目**：G1/G2/G3 — C1/C2/C3 拆分前置测试护栏（不改运行时代码）

**执行刀**：
1. G1 新增 `apps/desktop/frontend/tests/editor.test.tsx`：
   - `renderToStaticMarkup` 覆盖 Editor 空状态、项目提示、历史按钮、导出按钮。
   - 源文本护栏覆盖 `recordRevisionLoop`、`emitAuthorLoopResult`、`editor-save-btn`、`editor-export-btn` 与已知 `data-testid`，为 C3 拆分时“壳层必须保留可见引用”提前报警。
2. G2 扩展 `apps/desktop/frontend/tests/chat-window.test.ts`：
   - 主外壳静态渲染覆盖 ConversationHeader、新会话标题、当前文件摘要、context summary。
   - 无项目状态覆盖 composer 禁用提示。
   - 既有 Writing Run mock SSE 投影测试继续保留。
3. G3 新增 `apps/desktop/frontend/tests/app.test.tsx`：
   - `renderToStaticMarkup` 覆盖 desktop shell、WelcomeWorkspace、项目库入口、新增项目按钮。
   - 源文本护栏镜像 `ide-shell.spec.ts` 依赖的壳层结构符号，并确认不残留 Web legacy 路由入口。

**验证门禁**：
- `npm --prefix apps/desktop/frontend run test` → **59 passed**。
- `npm --prefix apps/desktop/frontend run typecheck` → 通过。
- 测试输出存在 React SSR `useLayoutEffect` warning，来自 Editor 静态渲染护栏触发的既有客户端 effect 警告；未阻断测试，未改运行时代码。

**行为变更**：无。Wave 0 第一层前端护栏已完成，C1/C2/C3 可进入拆分，但每刀仍需继续跑桌面 test/typecheck 并按风险补行为特征测试。

## AS 前置护栏验证（2026-06-28）

**条目**：Wave 1 AS — `agent_runs/service.py` 拆分前补 record/SSE 底层契约测试（不改运行时代码）

**执行刀**：
1. 在 `apps/api/tests/test_agent_runs.py` 新增 `_seed_agent_run` 测试辅助，用最小 `AgentRun` 直接覆盖底层事件函数。
2. 新增 `test_record_agent_event_sequences_increment_from_existing_max`：
   - 先手工插入 `sequence=7` 的既有事件。
   - 连续调用 `record_agent_event` 两次，断言新增事件 sequence 为 8、9，并按 run 内顺序可重放。
3. 新增 `test_encode_agent_run_sse_event_is_stable_json_snapshot`：
   - 通过 `record_agent_event` 生成真实 `AgentRunEvent`。
   - 断言 SSE 文本包含稳定 `event: tool_trace`、唯一 `data:` 行、双换行结尾。
   - 解析 data JSON，锁定 `id/run_id/event_type/actor/message/payload/sequence/created_at` 投影。

**验证门禁**：
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_record_agent_event_sequences_increment_from_existing_max tests/test_agent_runs.py::test_encode_agent_run_sse_event_is_stable_json_snapshot -q` → **2 passed**。
- `cd apps/api && uv run ruff check app/domains/agent_runs/service.py app/domains/agent_runs/errors.py tests/test_agent_runs.py` → All checks passed。
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **33 passed**。

**行为变更**：无。AS 拆分前置护栏已补齐；后续拆 `event_encoders` / `event_sink` 时必须保持 `record_agent_event` 顺序语义、SSE 投影形状，以及 `AgentRuntime` 顶层 import monkeypatch 契约。

## AS event_encoders 重构验证（2026-06-28）

**条目**：Wave 1 AS — `agent_runs/service.py` SSE/WS 事件编码簇提取（零行为变更）

**执行刀**：
1. 新建 `apps/api/app/domains/agent_runs/event_encoders.py`，迁入：
   - `encode_agent_run_sse_event`
   - `websocket_started_event`
   - `websocket_control_event`
   - 私有纯 helper `_scope_string_list`
2. `agent_runs/service.py` 顶层 re-export 三个事件编码函数，保持旧 import 路径：
   - `from app.domains.agent_runs.service import encode_agent_run_sse_event`
   - `from app.domains.agent_runs.service import websocket_started_event`
   - `from app.domains.agent_runs.service import websocket_control_event`
3. 删除 service 内重复实现与不再需要的 `json` import；`service.py` 当前约 **1212 行**，`event_encoders.py` 约 **52 行**。

**验证门禁**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/service.py app/domains/agent_runs/event_encoders.py app/domains/agent_runs/errors.py tests/test_agent_runs.py` → All checks passed。
- `cd apps/api && uv run python -c "...agent event_encoders facade identity..."` → `agent event_encoders facade OK`。
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_encode_agent_run_sse_event_is_stable_json_snapshot tests/test_agent_runs.py::test_agent_run_sse_stream_replays_event_store tests/test_agent_runs.py::test_websocket_control_messages_are_persisted_as_agent_run_events -q` → **3 passed**。
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **33 passed**。

**import 拓扑验证**：
- `agent_runs/event_encoders.py` → imports only `agent_runs.models` + stdlib，绝不反向 import `service.py`。
- `agent_runs/service.py` → imports `event_encoders.py` for facade compatibility。
- `agent_runs/router.py` and `ide/router.py` can keep importing from `service.py` unchanged.

**行为变更**：无（纯移动 + facade re-export）。AS 剩余拆分入口：run_payloads、skill_catalog、event_sink（其中 skill_catalog 已在下一刀完成）。

## AS skill_catalog 重构验证（2026-06-28）

**条目**：Wave 1 AS — `agent_runs/service.py` Root Agent skill catalog 簇提取（零行为变更）

**执行刀**：
1. 新建 `apps/api/app/domains/agent_runs/skill_catalog.py`，迁入：
   - `_AGENT_SKILL_DEFINITIONS`
   - `list_agent_skills`
   - `_skill_by_name`
   - `_agent_plan_payload`
   - 私有选择 helper `_select_agent_skill` / `_has_scope_key` / `_scope_string_list`
2. `agent_runs/service.py` 顶层 re-export `list_agent_skills`、`_skill_by_name`、`_agent_plan_payload`、`_AGENT_SKILL_DEFINITIONS`，保持旧路径和内部调用兼容。
3. 本刀不移动 role catalog wrapper（`list_agent_roles`/`get_agent_role` 等），因为 `role_catalog.py` 已是独立模块，service 当前只保留兼容转发。
4. 删除 service 内重复 skill 定义和选择逻辑；`service.py` 当前约 **1085 行**，`skill_catalog.py` 约 **154 行**。

**验证门禁**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/service.py app/domains/agent_runs/event_encoders.py app/domains/agent_runs/skill_catalog.py app/domains/agent_runs/errors.py tests/test_agent_runs.py` → All checks passed。
- `cd apps/api && uv run python -c "...agent skill_catalog facade identity..."` → `agent skill_catalog facade OK`。
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_agent_skills_endpoint_exposes_skills_v1_catalog tests/test_agent_runs.py::test_websocket_user_message_persists_agent_run_events_and_artifacts tests/test_agent_runs.py::test_book_run_progress_is_projected_to_agent_run_event_store -q` → **3 passed**。
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **33 passed**。

**import 拓扑验证**：
- `agent_runs/skill_catalog.py` → imports only `role_catalog.DEFAULT_PERMISSION_PROFILE` + schemas/std typing，绝不反向 import `service.py`。
- `agent_runs/service.py` → imports `skill_catalog.py` for facade compatibility and internal plan payload calls。

**行为变更**：无（纯移动 + facade re-export）。AS 剩余拆分入口：run_payloads、event_sink。

## AS run_payloads 重构验证（2026-06-28）

**条目**：Wave 1 AS — `agent_runs/service.py` run/message/scope/bookrun payload helper 簇提取（零行为变更）

**执行刀**：
1. 新建 `apps/api/app/domains/agent_runs/run_payloads.py`，迁入：
   - `_message_text`
   - `_message_input_summary`
   - `_scope_summary`
   - `_budget_summary`
   - `_current_plan_step`
   - `_optional_string`
   - `_optional_positive_int`
   - `_has_event`
   - `_control_event_type`
   - `_control_event_message`
   - `_book_run_id_from_result`
   - `_book_run_budget`
   - `_book_run_snapshot_payload`
2. `agent_runs/service.py` 顶层 re-export 上述私有 helper，保持旧路径和 monkeypatch/调试访问兼容。
3. 本刀不移动 `_apply_book_run_control_if_needed`，因为它会调用 `record_book_run_snapshot` 和 writing-run 状态机，留在 service 可避免 run_payloads 反向依赖 service。
4. 删除 service 内重复 payload helper 实现；`service.py` 当前约 **856 行**，`run_payloads.py` 约 **128 行**。

**验证门禁**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/service.py app/domains/agent_runs/run_payloads.py app/domains/agent_runs/event_encoders.py app/domains/agent_runs/skill_catalog.py app/domains/agent_runs/errors.py tests/test_agent_runs.py` → All checks passed。
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`。
- `cd apps/api && uv run python -c "...agent run_payloads facade identity..."` → `agent run_payloads facade OK`。
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_websocket_user_message_persists_agent_run_events_and_artifacts tests/test_agent_runs.py::test_book_run_progress_is_projected_to_agent_run_event_store tests/test_agent_runs.py::test_agent_run_control_channel_updates_bound_bookrun_status -q` → **3 passed**。
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **33 passed**。

**import 拓扑验证**：
- `agent_runs/run_payloads.py` → imports only `agent_runs.models.AgentRun`、`role_catalog.normalize_agent_role_inputs`、`book_runs.models.BookRun`、`writing_runs.service.full_book_writing_run_event_data` and std typing；绝不反向 import `service.py`。
- `agent_runs/service.py` → imports `run_payloads.py` for facade compatibility and internal helper calls。

**行为变更**：无（纯移动 + facade re-export）。AS 剩余拆分入口：event_sink。

## AS event_sink 重构验证（2026-06-28）

**条目**：Wave 1 AS — `agent_runs/service.py` AgentRun Runtime event sink adapter 提取（零行为变更）

**执行刀**：
1. 新建 `apps/api/app/domains/agent_runs/event_sink.py`，迁入：
   - `_AgentRunEventSink`
   - `_record_orchestrator_result`
   - `_record_tool_trace_events`
   - `_record_result_artifacts`
   - `_record_permission_if_needed`
2. `agent_runs/service.py` 顶层 re-export 上述符号，保持旧路径和私有调试访问兼容。
3. `record_agent_event` / `record_agent_artifact` / `record_subagent_run` / `complete_agent_run` / `fail_agent_run` 持久化事实源继续留在 `service.py`。
4. `event_sink.py` 在方法执行时局部 import `service.py` 的写入函数，避免导入期形成 `service.py` ↔ `event_sink.py` 环。
5. 删除 service 内重复 event sink 实现；`service.py` 当前约 **618 行**，`event_sink.py` 约 **266 行**。

**验证门禁**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/service.py app/domains/agent_runs/event_sink.py app/domains/agent_runs/run_payloads.py app/domains/agent_runs/event_encoders.py app/domains/agent_runs/skill_catalog.py app/domains/agent_runs/errors.py tests/test_agent_runs.py` → All checks passed。
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`。
- `cd apps/api && uv run python -c "...agent event_sink facade identity..."` → `agent event_sink facade OK`。
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_websocket_user_message_persists_agent_run_events_and_artifacts tests/test_agent_runs.py::test_agent_run_records_permission_required_for_proposed_patch tests/test_agent_runs.py::test_hidden_compaction_system_job_runs_for_long_sessions tests/test_agent_runs.py::test_runtime_initialization_failure_marks_agent_run_failed -q` → **4 passed**。
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **33 passed**。
- `git diff --check -- docs/internal/refactor-master-plan.md .codex/verification-report.md apps/api/app/domains/agent_runs/service.py apps/api/app/domains/agent_runs/event_sink.py apps/api/app/domains/agent_runs/run_payloads.py apps/api/app/domains/agent_runs/event_encoders.py apps/api/app/domains/agent_runs/skill_catalog.py apps/api/app/domains/agent_runs/errors.py apps/api/tests/test_agent_runs.py` → 通过。

**import 拓扑验证**：
- `agent_runs/event_sink.py` → imports `models.AgentRun`、`run_payloads`、`skill_catalog._agent_plan_payload`、`trace.AgentToolTrace` at import time；不在导入期 import `service.py`。
- `event_sink.py` 方法体局部 import `service.py` 的持久化写入函数，保持写入事实源集中在 service，且 `import app.main` smoke 通过。
- `agent_runs/service.py` → imports `event_sink.py` for facade compatibility and runtime adapter construction。

**行为变更**：无（纯移动 + facade re-export）。AS 到达当前合理边界：`service.py` 留 AgentRun 生命周期、查询、持久化事实源和 BookRun 控制桥接；SSE/WS encoding、skill catalog、run payload helper、event sink adapter 均已外移并验证。

## C1 ChatWindow pure helpers 重构验证（2026-06-28）

**条目**：Wave 1 C1 — `ChatWindow.tsx` 纯 helper/type 簇提取（零行为变更）

**执行刀**：
1. 新建 `apps/desktop/frontend/src/components/chat-window/` 子目录，提取纯类型和 helper：
   - `types.ts`：ChatWindow props/state/view-model 类型、review/writing-run payload 类型。
   - `path-utils.ts`：`basename` / `relativePath` / `joinProjectPath` / `looksAbsolutePath` / `extractContextReferences`。
   - `agent-step-mapping.ts`：plan/tool trace 到 AgentStep 的映射。
   - `writing-run.ts`：`writingRunIdFromResult` / `applyWritingRunEventProjection`。
   - `review.ts`：review report issue 解析、scope warning、定向修订 scope 推断、review summary。
   - `request-payload.ts`：`buildStableAgentRequestPayload`。
   - `conversation-utils.ts`：conversation title、历史消息压缩、system job title 提取。
2. `ChatWindow.tsx` 继续作为旧导入路径和主组件壳层，re-export 测试与外部依赖的 named exports：
   - `applyWritingRunEventProjection`
   - `buildStableAgentRequestPayload`
   - `extractIssueScopeFromInstruction`
   - `reviewIssuesFromReport`
   - `scopeWarningFromAgentResult`
   - `writingRunIdFromResult`
   - `StableAgentRequestPayload`
3. 本刀不移动 `runAuthorAgent` 主闭环、不拆 JSX panels，避免同时改动状态机与展示结构。
4. `ChatWindow.tsx` 从约 **2145 行** 降到约 **1752 行**。

**验证门禁**：
- `npm --prefix apps/desktop/frontend run typecheck` → 通过。
- `npm --prefix apps/desktop/frontend run test` → **59 passed**。
- `git diff --check -- apps/desktop/frontend/src/components/ChatWindow.tsx apps/desktop/frontend/src/components/chat-window/types.ts apps/desktop/frontend/src/components/chat-window/path-utils.ts apps/desktop/frontend/src/components/chat-window/agent-step-mapping.ts apps/desktop/frontend/src/components/chat-window/writing-run.ts apps/desktop/frontend/src/components/chat-window/review.ts apps/desktop/frontend/src/components/chat-window/request-payload.ts apps/desktop/frontend/src/components/chat-window/conversation-utils.ts apps/desktop/frontend/tests/chat-window.test.ts` → 通过。

**测试输出说明**：
- 桌面单元测试仍有既有 React SSR `useLayoutEffect` warning，来源为 Editor 静态渲染护栏；未阻断测试，本刀未改 Editor。

**import 拓扑验证**：
- `chat-window/*` 子模块不反向 import `ChatWindow.tsx`。
- `ChatWindow.tsx` 继续维持 `App.tsx` 和 `tests/chat-window.test.ts` 的旧路径导入契约。

**行为变更**：无（纯移动 + barrel re-export）。C1 已进入进行中；剩余拆分入口：Composer/context panels/review issue actions/agent run controls 等展示子组件，`runAuthorAgent` 主闭环暂不抽。

## C1 ChatWindow panels/Composer 重构验证（2026-06-28）

**条目**：Wave 1 C1 — `ChatWindow.tsx` 展示组件簇提取（零行为变更）

**执行刀**：
1. 新建并接入展示模块：
   - `chat-window/display-utils.ts`：`contextBudgetText` / `selectedContextPreview` / `runStatusText` / `roleMentionQuery`。
   - `chat-window/Composer.tsx`：`ComposerBox` / `ComposerSurface`。
   - `chat-window/panels.tsx`：`ConversationHeader` / `MessageList` / `ReviewIssueActions` / `AgentRunControlBar` / `WritingRunProgressPanel` / `ContextSummaryPanel` / `MessageItem` / `EmptyConversation` / `LightweightStatus`。
2. `ChatWindow.tsx` 继续作为旧导入路径和主组件壳层，补回 `WritingRunProgressPanel` re-export，保持 `tests/chat-window.test.ts` 旧路径兼容。
3. 本刀仍不移动 `runAuthorAgent` 主闭环；壳层保留异步 orchestration、事件监听、状态组合和 `appendExplicitContextFiles`。
4. `ChatWindow.tsx` 当前约 **1031 行**；`panels.tsx` 约 **553 行**；`Composer.tsx` 约 **154 行**。

**验证门禁**：
- `npm --prefix apps/desktop/frontend run typecheck` → 通过。
- `npm --prefix apps/desktop/frontend run test` → **59 passed**。
- `git diff --check -- docs/internal/refactor-master-plan.md .codex/verification-report.md apps/desktop/frontend/src/components/ChatWindow.tsx apps/desktop/frontend/src/components/chat-window` → 通过。

**失败-修复记录**：
- 首次 panel 提取后测试失败：`ChatWindow` barrel 未 re-export `WritingRunProgressPanel`，而 `tests/chat-window.test.ts` 仍从旧路径导入该组件。修复：从 `ChatWindow.tsx` re-export `WritingRunProgressPanel`。
- 首次 typecheck 暴露旧 `runStatusText` 本地定义与新 import 冲突、`selectedContextPreview` 漏 import。修复后 typecheck/test 全绿。

**测试输出说明**：
- 桌面单元测试仍有既有 React SSR `useLayoutEffect` warning，来源为 Editor 静态渲染护栏；未阻断测试，本刀未改 Editor。

**import 拓扑验证**：
- `chat-window/Composer.tsx`、`panels.tsx`、`display-utils.ts` 不反向 import `ChatWindow.tsx`。
- `ChatWindow.tsx` 继续维持 `App.tsx` 与 `tests/chat-window.test.ts` 的旧路径导入契约。

**行为变更**：无（纯移动 + barrel re-export）。C1 到达当前合理边界：主文件保留 `runAuthorAgent`/事件监听/状态组合壳层，避免把最复杂异步闭环拆成浅 hook；后续只有在重写 Agent orchestration 时再评估深模块。

## C3 Editor decorations 重构验证（2026-06-28）

**条目**：Wave 2 C3 — `Editor.tsx` issue decoration helper 提取（零行为变更）

**执行刀**：
1. 新建 `apps/desktop/frontend/src/components/editor/decorations.ts`，迁入：
   - `ISSUE_SEVERITY_COLOR`
   - `normalizeIssueSeverity`
   - `locateEvidence`
   - `issueDecorationOptions`
2. `Editor.tsx` 改为从 `./editor/decorations` import `locateEvidence` / `issueDecorationOptions`。
3. 本刀不移动 `recordRevisionLoop`、`emitAuthorLoopResult`、`editor-save-btn`、`editor-export-btn` 或任何 toolbar JSX，保持 e2e/source-text 护栏依赖的可见引用。
4. `Editor.tsx` 当前约 **1016 行**，`decorations.ts` 约 **45 行**。

**验证门禁**：
- `npm --prefix apps/desktop/frontend run typecheck` → 通过。
- `npm --prefix apps/desktop/frontend run test` → **59 passed**。
- `git diff --check -- apps/desktop/frontend/src/components/Editor.tsx apps/desktop/frontend/src/components/editor/decorations.ts apps/desktop/frontend/tests/editor.test.tsx` → 通过。

**测试输出说明**：
- 桌面单元测试仍有既有 React SSR `useLayoutEffect` warning，来源为 Editor 静态渲染护栏；未阻断测试。

**import 拓扑验证**：
- `editor/decorations.ts` 只依赖 `monaco-editor` 与 `ReviewIssueMarker` 类型，不反向 import `Editor.tsx`。
- `Editor.tsx` 源文本护栏继续通过，关键符号与 `data-testid` 留在壳层。

**行为变更**：无（纯移动）。C3 已进入进行中；下一刀建议提取 `VersionHistory` 展示组件，继续保留工具栏与写回/导出主闭环在壳层。

## C3 Editor VersionHistory 重构验证（2026-06-28）

**条目**：Wave 2 C3 — `Editor.tsx` 版本历史/分支图侧栏提取（零行为变更）

**执行刀**：
1. 新建并接入 `apps/desktop/frontend/src/components/editor/VersionHistory.tsx`，迁入：
   - `formatTimestamp`
   - `VersionHistory`
   - 历史版本读取、source filter、列表/分支图切换、`BranchCanvas` 接线与版本恢复逻辑。
2. `Editor.tsx` 改为从 `./editor/VersionHistory` import `VersionHistory` / `formatTimestamp`，继续保留：
   - `handleRestore`
   - `handleCheckoutNode`
   - `handleBranchFromNode`
   - `handleSelectBranch`
   - 分支 manifest state/ref 与保存写回主闭环。
3. 清理 `Editor.tsx` 的旧本地 `VersionHistory` 实现与无用 import（`useMemo`、`listVersions`、`VersionEntry`、`buildGraph`、`BranchCanvas`）。
4. 调整 `apps/desktop/frontend/tests/editor.test.tsx` 的源文本护栏：壳层 `data-testid` 继续要求留在 `Editor.tsx`，`version-history` 标记改由 `VersionHistory.tsx` 承载，避免把已外移展示 Module 错绑回壳层。
5. `Editor.tsx` 当前约 **828 行**，`VersionHistory.tsx` 约 **195 行**。

**验证门禁**：
- `npm --prefix apps/desktop/frontend run typecheck` → 通过。
- `npm --prefix apps/desktop/frontend run test` → **59 passed**。
- `git diff --check -- apps/desktop/frontend/src/components/Editor.tsx apps/desktop/frontend/src/components/editor/VersionHistory.tsx apps/desktop/frontend/tests/editor.test.tsx` → 通过。

**失败-修复记录**：
- 首次测试失败：`editor.test.tsx` 仍要求 `data-testid="version-history"` 出现在 `Editor.tsx` 源文本。修复：将该护栏迁到 `VersionHistory.tsx` 源文本，壳层标记仍锁在 `Editor.tsx`。

**测试输出说明**：
- 桌面单元测试仍有既有 React SSR `useLayoutEffect` warning，来源为 Editor 静态渲染护栏；未阻断测试。

**import 拓扑验证**：
- `editor/VersionHistory.tsx` 只依赖 React hooks、`branches` / `versions` lib 与 `BranchCanvas`，不反向 import `Editor.tsx`。
- `Editor.tsx` 继续持有 Monaco 生命周期、保存/快照、AI 写回、导出、分支 manifest 和 e2e/source-text 护栏依赖的关键符号。

**行为变更**：无（纯移动 + 护栏位置校正）。C3 继续进行中；下一刀建议 `useBranchManifest` 或 `useSuggestionWriteback`，`useMonacoEditor` 最深，单独 PR。

## C3 Editor useBranchManifest 重构验证（2026-06-28）

**条目**：Wave 2 C3 — `Editor.tsx` 分支清单状态与落盘逻辑提取（零行为变更）

**执行刀**：
1. 新建并接入 `apps/desktop/frontend/src/components/editor/useBranchManifest.ts`，集中承载：
   - 当前文件 `BranchManifest` state/ref。
   - 打开文件时 `loadBranchManifest`，清空文件时回退 `emptyManifest`。
   - 活动分支读取、分支选择、从节点创建分支、保存后推进分支 head。
   - `saveBranchManifest` 落盘失败时保留既有 `console.error('写入分支清单失败:', err)` 行为。
2. `Editor.tsx` 改为调用 `useBranchManifest(projectPath, filePath)`，继续在壳层保留：
   - 保存/Agent 写回时 `snapshotBeforeWrite` 的 metadata 组装顺序。
   - `handleRestore` / `handleCheckoutNode` / `handleBranchFromNode` 的编辑器恢复语义。
   - Monaco 生命周期、AI 写回、导出、工具栏与 e2e/source-text 护栏依赖的关键符号。
3. 清理 `Editor.tsx` 的本地分支清单 effect、`branchManifestRef`、`handleSelectBranch` 与无用 branch helper imports。
4. `Editor.tsx` 当前约 **770 行**，`useBranchManifest.ts` 约 **93 行**。

**验证门禁**：
- `npm --prefix apps/desktop/frontend run typecheck` → 通过。
- `npm --prefix apps/desktop/frontend run test` → **59 passed**。
- `git diff --check -- apps/desktop/frontend/src/components/Editor.tsx apps/desktop/frontend/src/components/editor/useBranchManifest.ts apps/desktop/frontend/src/components/editor/VersionHistory.tsx apps/desktop/frontend/tests/editor.test.tsx` → 通过。

**测试输出说明**：
- 桌面单元测试仍有既有 React SSR `useLayoutEffect` warning，来源为 Editor 静态渲染护栏；未阻断测试。

**import 拓扑验证**：
- `editor/useBranchManifest.ts` 只依赖 React hooks 与 `lib/branches`，不反向 import `Editor.tsx`。
- `Editor.tsx` 继续持有 `snapshotBeforeWrite` 调用点，因此版本快照 metadata 的来源、summary、patch/session/issue/context、parentId/head 推进顺序保持在原写回壳层可见。

**行为变更**：无（纯移动）。C3 继续进行中；下一刀建议 `useSuggestionWriteback`，`useMonacoEditor` 最深，单独 PR。

## C3 Editor useSuggestionWriteback 重构验证（2026-06-28）

**条目**：Wave 2 C3 — `Editor.tsx` 建议补丁写回状态机提取（零行为变更）

**执行刀**：
1. 新建并接入 `apps/desktop/frontend/src/components/editor/useSuggestionWriteback.ts`，集中承载：
   - `APPLY_FILE_SUGGESTION_EVENT` 待写回补丁接收。
   - `SUGGESTION_RESULT_EVENT` 修订结果状态更新。
   - `ACCEPT_CURRENT_FILE_SUGGESTION_EVENT` 全局接受当前补丁。
   - 接受整块、接受 hunk、拒绝补丁、保存旁注。
   - Agent 写回前 `snapshotBeforeWrite` 与分支 head 推进。
   - 写回后的 `recordRevisionLoop` 闭环记录与 `emitAuthorLoopResult` 事件投影。
2. `Editor.tsx` 通过依赖注入传入 `recordRevisionLoop` / `emitAuthorLoopResult` / editor refs / 分支 helper，保持 e2e/source-text 护栏依赖的 `recordRevisionLoop` 与 `emitAuthorLoopResult` 可见引用仍在壳层。
3. `Editor.tsx` 继续保留手动保存、导出、Monaco 生命周期、当前文件加载、历史 checkout/restore、工具栏 JSX 与 `editor-save-btn` / `editor-export-btn`。
4. 文件切换和无文件状态通过 `resetSuggestionWriteback()` 保持原先清空 pending suggestion、status、revise loading 的语义。
5. `Editor.tsx` 当前约 **553 行**，`useSuggestionWriteback.ts` 约 **310 行**。

**验证门禁**：
- `npm --prefix apps/desktop/frontend run typecheck` → 通过。
- `npm --prefix apps/desktop/frontend run test` → **59 passed**。
- `git diff --check -- apps/desktop/frontend/src/components/Editor.tsx apps/desktop/frontend/src/components/editor/useSuggestionWriteback.ts apps/desktop/frontend/src/components/editor/useBranchManifest.ts apps/desktop/frontend/src/components/editor/VersionHistory.tsx apps/desktop/frontend/tests/editor.test.tsx` → 通过。

**失败-修复记录**：
- 首次 typecheck 失败：hook 调用早于 `originalContentRef` / `filePathRef` / `projectPathRef` 声明，且文件加载流程仍调用已迁走的 `setIsReviseLoading`。修复：将 refs 提前声明，并让 hook 暴露 `resetSuggestionWriteback()` 给加载流程复用。

**测试输出说明**：
- 桌面单元测试仍有既有 React SSR `useLayoutEffect` warning，来源为 Editor 静态渲染护栏；未阻断测试。

**import 拓扑验证**：
- `editor/useSuggestionWriteback.ts` 依赖 React hooks、assistant event 常量/types、author-loop types、patch hunk helper、versions/Tauri FS 与注入的壳层 adapter；不反向 import `Editor.tsx`。
- `Editor.tsx` 保留 `recordRevisionLoop` / `emitAuthorLoopResult` import 与传参，源文本护栏继续通过。

**行为变更**：无（纯移动 + 依赖注入）。C3 已接近当前合理装配壳边界；剩余 `useMonacoEditor` 涉及 Monaco 实例生命周期、命令注册、load/save effect，建议单独 PR 并补运行期集成护栏后再动。

## E2-3 重构验证（2026-06-28）

**条目**：第 3 层 E2-3 — 迁 `chapter.review` / `chapter.repair` 入 live AgentRuntime（行为变更）

**目标**：将 `chapter.review` 和 `chapter.repair` 从 legacy `ide/orchestrator.py` 的 `else` 分支 fallback 路径迁入 `agent_runs/runtime.py` 的 native AgentRuntime handler，复用 `_ide_command_tool` 工具工厂调用 `execute_ide_command_by_id`，并修复 E2-2 对账发现的 `_string_list` / `_style_rules` 语义漂移。

**修改范围**（仅 `runtime.py`）：
- 修复 `_string_list`：添加 `.strip()` + 空字符串过滤，对齐 orchestrator.py 语义
- 修复 `_style_rules`：额外支持 `{"rule": "..."}` dict 项，对齐 orchestrator.py 语义
- 添加 4 个 helper 函数：`_payload_list`、`_can_repair_issue`、`_first_patch_payload`（适配 ToolResult.output 路径）、`_proposed_patch_from_repair_patch`
- 重写 `_judge_run`：`mode="proposed_patch_smoke"` 保留 stub 行为（file.revise 路径轻量检查），其他 mode 委托 `_ide_command_tool("judge.run")` 走真实 judge service
- 添加 `_run_chapter_review` 方法：对应 orchestrator.py `_orchestrate_chapter_review`，用 `self._execute_tool("judge.run", ...)` + `self._execute_tool("judge.repair", ...)` 替代 `_execute_command_with_tool_audit`
- 添加 `_run_chapter_review_repair` 方法：对应 orchestrator.py `_orchestrate_chapter_repair`
- 添加 `"judge.repair"` 到 `_execute_tool` 权限门排除集合（其 `risk_level="write_pending"` 会在 pipeline 内调用时被拦截）
- 在 `run_user_message()` 添加 `chapter.review` / `chapter.repair` intent dispatch 分支

**orchestrator.py**：零修改。Legacy 代码原样保留至 E2-4。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime.py` → All checks passed
- `cd apps/api && uv run python -c "import app.main"` → Import OK（无环）
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q` → **28 passed**（含 `test_agent_user_message_chapter_review_calls_registry_and_waits_for_confirmation`）
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **33 passed**
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_agent_runs.py tests/test_assistant_revise.py tests/test_book_runs.py -q` → **92 passed**

**行为变更**：true。`_judge_run` 从 stub 变真实调用（非 smoke mode）；`runtime_mode` 从 `"legacy_adapter"` 变 `"agent_runtime"`；`_string_list` / `_style_rules` 清洗语义对齐 legacy（strip + 空值过滤 + dict rule 支持）。

**影响**：`chapter.review` / `chapter.repair` 不再走 `legacy.orchestrator` 工具 fallback，转为 AgentRuntime native handler；输出契约与 legacy 一致（同一测试通过）；为 E2-4 删除 legacy orchestrator 死代码铺路。

## E2-4 重构验证（2026-06-28）

**条目**：第 3 层 E2-4 — 删除 legacy orchestrator 死代码，下线 `legacy.orchestrator` 工具（零行为变更）

**目标**：E2-3 已将 `chapter.review` / `chapter.repair` 迁入 live AgentRuntime，所有 SUPPORTED_INTENTS 现在都有 native handler。删除 `runtime.py` 中的 `legacy.orchestrator` 工具注册、`_legacy_orchestrator` 方法和权限门排除；`else` 分支改为直接 raise `AgentOrchestrationError`。

**修改范围**（仅 `runtime.py`）：
- 删除 `_legacy_orchestrator` 方法（原 line 896-914）
- 删除 `legacy.orchestrator` 工具注册（原 line 707-709）
- 从 `_execute_tool` 权限门排除集合删除 `"legacy.orchestrator"`
- `else` 分支从调用 `self._execute_tool("legacy.orchestrator", ...)` 改为 `raise AgentOrchestrationError(f"暂不支持的 Agent intent：{intent}")`
- **保留** `from app.domains.ide.orchestrator import orchestrate_agent_message` 导入（`# noqa: F401`），因为 `test_agent_runs.py:390` 通过 monkeypatch 验证 `file.review` 不走 legacy 路径

**orchestrator.py**：零修改。Legacy 文件保留至后续评估整文件删除。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime.py` → All checks passed
- `cd apps/api && uv run python -c "import app.main"` → Import OK
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_agent_runs.py -q` → **61 passed**（28 + 33）

**行为变更**：false。所有 live intent 已有 native handler；`else` 分支原逻辑已不可达（`SUPPORTED_INTENTS` 全量覆盖），改为显式报错是防御性编程。

**影响**：`legacy.orchestrator` 工具下线；`AgentRuntime` 不再依赖 `orchestrate_agent_message` 做运行时 fallback；`orchestrator.py` 变为纯 dead code，可在后续评估整文件删除。

## B2 重构验证（2026-06-29，完成）

**条目**：Wave 2 B2 — 拆分 `book_runs/service.py`（1110 行）为多个薄模块（零行为变更）

**目标**：按重构总计划，提取叶子工具层 `_coerce.py`、Timeline 同步层 `timeline.py`、Longform context 门禁层 `gate.py`、Workflow dispatch 层 `dispatch.py`、Progression 层 `progression.py`，service.py 保留 Lifecycle facade + re-export。

**已完成步骤**：

1. **Step 1: 提取 `_coerce.py`（55 行）**
   - 迁入 `_string_list`、`_positive_int`、`_non_negative_int`、`_non_negative_float`、`_bounded_ratio`、`_nested_progress_int`、`_compact_text`、`_compact_text_list`
   - service.py re-export 全部 8 个函数（`# noqa: F401`），并补齐 `_nested_progress_int` 旧路径兼容

2. **Step 2: 提取 `timeline.py`（249 行）**
   - 迁入 `_sync_completed_chapter_timeline_events` 及 12 个 helper 函数
   - 从 `_coerce.py` import `_positive_int`、`_string_list`、`_nested_progress_int`
   - service.py re-export `_sync_completed_chapter_timeline_events`（唯一被外部调用的入口）
   - 删除 service.py 中 timeline 相关的 230+ 行

3. **Step 3: 提取 `gate.py`（137 行）**
   - 迁入 `_require_longform_context_ready` 及 10 个 helper 函数（含 `_explicit_volume_plan`、`_even_volume_plan`、`_single_volume_plan`）
   - 延迟 import `BookRunBlockedError` 避免循环依赖（在函数内从 service.py import）
   - service.py re-export `_require_longform_context_ready`、`_explicit_volume_plan`、`_even_volume_plan`、`_single_volume_plan`
   - 删除 service.py 中 gate 相关的 120+ 行

4. **Step 4: 提取 `dispatch.py`（259 行）**
   - 迁入 `build_book_run_workflow_dispatch`、`DEFAULT_ENTITY_BUDGET`、`DEFAULT_PHASE_POLICY` 与 dispatch/narrative plan helper 簇
   - 从 `_coerce.py` 和 `gate.py` 单向依赖叶子 helper，不反向 import `service.py`
   - service.py re-export dispatch 入口、常量与旧私有 helper，保持测试/跨模块旧路径兼容

5. **Step 5: 提取 `progression.py`（234 行）**
   - 迁入 `apply_book_run_progress`、`pause_book_run`、`resume_book_run`、`retry_book_run_from_checkpoint`、`stop_book_run`
   - 迁入预算、checkpoint、latency、controlled/sticky progress 合并 helper
   - 保持 `apply_book_run_progress` 的赋值顺序、预算暂停语义、timeline 同步时机和 commit/refresh 时点不变

6. **Step 6: 收敛 `service.py` facade（179 行）**
   - `service.py` 仅保留 BookRun lifecycle、startable/dispatched/background generation 壳层、异常类、常量和兼容 re-export
   - 补齐 dispatch/coerce/progression 私有 helper 的 facade 回引，避免纯移动刀收窄旧 interface

**当前文件尺寸**：
- `service.py`：179 行（原 1110 行，-931 行）
- `_coerce.py`：38 行
- `timeline.py`：221 行
- `gate.py`：112 行
- `dispatch.py`：259 行
- `progression.py`：234 行

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/book_runs/_coerce.py app/domains/book_runs/timeline.py app/domains/book_runs/gate.py app/domains/book_runs/dispatch.py app/domains/book_runs/progression.py app/domains/book_runs/service.py` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK（无环）
- `cd apps/api && uv run pytest tests/test_book_runs.py tests/test_book_run_workflow_dispatch.py tests/test_book_run_start.py tests/test_book_run_resume.py tests/test_book_run_budget.py -q` → **49 passed**, 1 existing deprecation warning
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_book_generation_long_wrapper.py tests/test_multi_round_repair.py -q` → **59 passed**
- `cd apps/api && git diff --check -- app/domains/book_runs/_coerce.py app/domains/book_runs/timeline.py app/domains/book_runs/gate.py app/domains/book_runs/dispatch.py app/domains/book_runs/progression.py app/domains/book_runs/service.py` → 通过

**行为变更**：false。纯文件级移动 + facade re-export；所有 import 路径保持不变（router、cross-domain、tests）。

**影响**：`book_runs/service.py` 已从 1110 行收敛为 179 行 facade；BookRun lifecycle 与后台 generation 触发留在 service，progress/timeline/gate/dispatch 进入各自深模块，测试继续跨旧 `service.py` interface 验证行为。

## B3 重构验证（2026-06-29，完成）

**条目**：Wave 2 B3 — 拆分 `judge/service.py`（约 974 行）为职责清晰的 Judge 深模块（零行为变更）

**目标**：把 Judge 的语义 LLM 评审、确定性规则、跨域一致性检测和文风指纹计算从单一 service 文件中拆出；`judge/service.py` 保留评审写库编排、Scene Packet 校验和旧 interface 兼容 re-export。

**已完成模块**：
1. `judge/types.py`
   - 承载 `JudgeInputError`、`DetectedIssue`、`SemanticJudgeOutcome`、`StyleFingerprint`、`JudgeProvider` 与 Judge 常量。
   - 作为叶子模块被其他 Judge 模块单向依赖。
2. `judge/semantic.py`
   - 承载 `semantic_judge`、`semantic_judge_with_status`、OpenAI 兼容请求、响应 JSON 解析、`_judge_llm_errors_total`。
   - `service.py` 保留 `httpx` facade import，现有 `monkeypatch.setattr(judge_service.httpx, "Client", ...)` 仍作用于同一个模块对象。
3. `judge/deterministic.py`
   - 承载 `deterministic_judge_fallback`、setting conflict 和 style drift 规则。
4. `judge/consistency.py`
   - 承载 Character Bible、Timeline、Style Fingerprint Drift 等跨域一致性检测。
5. `judge/style_fingerprint.py`
   - 承载 `compute_book_style_baseline`、`_style_fingerprint` 与轻量文风相似度计算。
6. `judge/service.py`
   - 保留 `create_judge_issues` 与 `_validate_scene_packet`。
   - re-export 外部旧路径需要的公开符号与私有 helper，包括 BookRun 生成路径使用的 `_detect_character_bible_violations`、`_detect_timeline_conflicts`、`_detect_style_fingerprint_drift`、`_style_fingerprint`、`compute_book_style_baseline`。

**子代理复核**：
- Explorer 子代理 Carson 做只读复核，结论：新模块不反向 import `judge.service`；BookRun 路径符号和 `httpx.Client` monkeypatch 契约保留；未发现阻断项。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/judge/` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `cd apps/api && uv run pytest tests/test_judge_semantic.py tests/test_judge_failure_marker.py tests/test_judge_character_consistency.py tests/test_judge_style_guard.py tests/test_judge_timeline_consistency.py tests/test_timeline_consistency.py tests/test_character_bible_guard.py tests/test_phase1_service_acceptance.py -q` → **16 passed**
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_book_generation_long_wrapper.py tests/test_multi_round_repair.py tests/test_prompt_assembly.py -q` → **69 passed**
- `cd apps/api && git diff --check -- app/domains/judge/service.py app/domains/judge/types.py app/domains/judge/semantic.py app/domains/judge/deterministic.py app/domains/judge/consistency.py app/domains/judge/style_fingerprint.py` → 通过

**行为变更**：false。纯文件级移动 + facade re-export；评审降级标记、确定性规则、语义 Judge 解析、文风指纹、跨域一致性检测与写库编排保持旧语义。

**影响**：`judge/service.py` 已收敛为约 130 行编排 facade；Judge 的测试 surface 仍可通过旧 `app.domains.judge.service` seam 验证，同时实现知识分布到语义、确定性、跨域一致性和文风指纹模块，locality 明显提升。

## B4 重构验证（2026-06-29，完成）

**条目**：Wave 3 B4 — 拆分 `story_memory/service.py`（733 行）为 Story Memory 深模块（零行为变更）

**目标**：把 Story Memory 的记忆事实 CRUD、伏笔生命周期、memory_extract 写入、场景召回/pgvector 候选排序和仲裁逻辑从单一 service 文件拆出；`story_memory/service.py` 退为旧 interface facade，继续作为所有调用方和测试的兼容 seam。

**已完成模块**：
1. `story_memory/errors.py`
   - 承载 `StoryMemoryInputError`、`ForeshadowLifecycleTransitionError`、`ForeshadowLifecycleConflictError`。
2. `story_memory/atoms.py`
   - 承载 `create_memory_atom`、`list_memory_atoms`、`get_active_memory_atoms`、`atoms_active_at_chapter`、MemoryAtom embedding 文本、默认排序、有效期判断和 ORM record 转换。
3. `story_memory/foreshadow_lifecycle.py`
   - 承载伏笔状态机常量、生命周期转换、历史读取、快照 dump/load、来源引用和状态迁移校验。
4. `story_memory/arbitration.py`
   - 承载 `detect_memory_conflicts`、`arbitrate_proposal`、`apply_arbitration_decision`，并保持 conflict_id sha1 截断与冲突排序语义。
5. `story_memory/extract.py`
   - 承载 `write_memory_extract_atoms` 与 chapter summary / character state / world fact / foreshadow ref 白名单抽取 payload 构建。
6. `story_memory/recall.py`
   - 承载 `recall_scene_memory_atoms`、pgvector 候选加载、召回排序、语义分数、关键词分数和环境变量候选数量配置。
7. `story_memory/service.py`
   - 收敛为约 75 行 facade，re-export 公开函数、常量与旧 private helper；旧 `app.domains.story_memory.service` 路径继续作为测试 surface。

**硬约束检查**：
- 旧 `service.py` 的 52 个类/函数名全部仍可从 facade 访问，包括 `_load_memory_atom_candidates`、`MemoryRecallScore` 和 pgvector 常量。
- `recall.py` 使用 `logging.getLogger("app.domains.story_memory.service")`，保持 `test_retrieval_pgvector.py` 的 caplog logger 契约。
- 未向 `story_memory/__init__.py` 添加 service 转导出，保持 `test_source_pruning.py` 约束。
- 新模块不反向 import `story_memory.service`；跨域调用方继续从旧 `service.py` import。

**子代理复核**：
- Explorer 子代理 Pascal 做 B4 只读复核，建议先拆 CRUD + extract，再拆 lifecycle，recall/vector 最后处理；实际落地按该顺序完成，未发现阻断项。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/story_memory/` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `cd apps/api && uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py tests/test_foreshadow_lifecycle.py tests/test_retrieval_pgvector.py tests/test_source_pruning.py -q` → **45 passed**
- `cd apps/api && uv run pytest tests/test_book_generation_parallel.py tests/test_scene_packet_context_compiler.py tests/test_scene_packet.py tests/test_prompt_assembly.py tests/test_ide_story_memory.py tests/test_phase2_memory_recall_fix.py -q` → **37 passed**
- `cd apps/api && git diff --check -- app/domains/story_memory/service.py app/domains/story_memory/errors.py app/domains/story_memory/atoms.py app/domains/story_memory/foreshadow_lifecycle.py app/domains/story_memory/arbitration.py app/domains/story_memory/extract.py app/domains/story_memory/recall.py` → 通过

**行为变更**：false。纯文件级移动 + facade re-export；MemoryAtom 写入、伏笔状态机、抽取 payload、pgvector fallback 日志、召回排序与仲裁规则保持旧语义。

**影响**：`story_memory/service.py` 已从 733 行收敛为约 75 行兼容 facade；Story Memory 的知识分布到 atoms、lifecycle、extract、recall 和 arbitration 深模块，locality 明显提升，旧调用路径与测试入口保持稳定。

## IS 重构验证（2026-06-29，完成）

**条目**：Wave 3 IS — 拆分 `ide/service.py`（738 行）为 IDE 工作台深模块（零行为变更）

**目标**：把 IDE command registry、Artifact Viewer、Workspace/Scene/Diagnostics 读取、Context Inspector、Story Memory Explorer 和 Run Panel SSE 投影从单一 service 文件拆出；`ide/service.py` 退为旧 interface facade，继续作为 router、live AgentRuntime、legacy orchestrator 和测试的兼容 seam。

**已完成模块**：
1. `ide/_coerce.py`
   - 承载 `_int_or_none`、`_string_or_none`、`_context_href`，作为 command registry 与 Artifact Preview 的叶子工具。
2. `ide/command_registry.py`
   - 承载 `IdeCommandDefinition`、`_BUILTIN_COMMANDS`、`execute_ide_command_by_id`、命令异常、Judge/Repair/Approve/BookRun WritingRun adapter 和 IDE 命令审计事件写入。
3. `ide/artifact_preview.py`
   - 承载 `get_artifact_preview`、预览格式识别、版本列表过滤和 BookRun/ModelRun/Judge/Approve 追溯链构建。
4. `ide/workspace_reads.py`
   - 承载 `get_workspace_tree`、`read_ide_scene`、`list_diagnostics_for_scene` 与诊断 severity 映射。
5. `ide/context_snapshot.py`
   - 承载 `get_context_snapshot` 与 `_context_block_ref`。
6. `ide/story_memory_query.py`
   - 承载 `query_story_memory`、章节有效期过滤、冲突 id 映射和 IDE Story Memory item/conflict 投影。
7. `ide/run_events.py`
   - 承载 `build_run_events`、`encode_sse_event` 与 token 剩余量投影。
8. `ide/service.py`
   - 收敛为约 51 行 facade，re-export 公开函数、异常、常量与旧 private helper；旧 `app.domains.ide.service` 路径继续作为测试 surface。

**硬约束检查**：
- 旧 `service.py` 的 35 个类/函数名全部仍可从 facade 访问。
- `execute_ide_command_by_id`、`IdeCommandNotFoundError`、`IdeCommandExecutionError` 仍从旧路径供 `ide/router.py`、live `agent_runs/runtime.py` 和 legacy `ide/orchestrator.py` import。
- 新模块不反向 import `ide.service`；共享 helper 下沉到 `ide/_coerce.py` 避免 command registry 与 Artifact Preview 互相依赖。
- `StoryForge IDE ??` 审计 workspace fallback 文案保持不变；`ide/router.py` 未修改。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/ide/` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `cd apps/api && uv run pytest tests/test_ide_workspace_tree.py tests/test_ide_diagnostics.py tests/test_ide_context_snapshot.py tests/test_ide_story_memory.py tests/test_ide_artifact_preview.py tests/test_ide_run_events.py tests/test_ide_command_registry.py tests/test_ide_commands.py tests/test_ide_agent_orchestrator.py -q` → **58 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **33 passed**
- `cd apps/api && git diff --check -- app/domains/ide/service.py app/domains/ide/_coerce.py app/domains/ide/command_registry.py app/domains/ide/artifact_preview.py app/domains/ide/context_snapshot.py app/domains/ide/run_events.py app/domains/ide/story_memory_query.py app/domains/ide/workspace_reads.py` → 通过

**行为变更**：false。纯文件级移动 + facade re-export；IDE 命令审计、Artifact workspace 过滤、Context Snapshot 空缺 404、Story Memory 冲突过滤、Run Events SSE 文本和 AgentRuntime command tool 路径保持旧语义。

**影响**：`ide/service.py` 已从 738 行收敛为约 51 行兼容 facade；IDE 工作台各读写面按深模块聚合，locality 明显提升，旧调用路径与测试入口保持稳定。

## B5 重构验证（2026-06-29，完成）

**条目**：Wave 3 B5 — 拆分 `studio/service.py`（763 行）为 Studio 工作台深模块（零行为变更）

**目标**：把 Studio 的 source reads、review reads、recovery reads、批准写回和主动章节审阅从单一 service 文件拆出；`studio/service.py` 退为旧 interface facade，继续作为 router、IDE command registry 和测试的兼容 seam。

**已完成模块**：
1. `studio/source_reads.py`
   - 承载 `list_studio_books`、`read_studio_chapter_goal`、`read_studio_scene_packet`、章节继承约束读取和 source read 异常。
2. `studio/review_reads.py`
   - 承载 `read_studio_judge_review`、`read_studio_repair_patches`、Judge 评分/状态投影、Repair Patch 投影和章节审阅输入异常。
3. `studio/recovery_reads.py`
   - 承载 `read_studio_recovery_summary`、checkpoint 摘要读取、失败节点解析和可恢复步骤投影。
4. `studio/approval.py`
   - 承载 `read_studio_approval_summary`、`approve_studio_writeback`、批准资格判断、Scene Packet / Repair Patch 写回、连续性记录写入和 book context cache 清理。
5. `studio/chapter_review.py`
   - 承载 `run_studio_chapter_review`、主动 Judge/Repair 编排、clean review 投影和 Scene Packet payload adapter。
6. `studio/service.py`
   - 收敛为约 53 行 facade，re-export 公开函数、异常和旧 private helper；旧 `app.domains.studio.service` 路径继续作为测试 surface。

**硬约束检查**：
- 旧 `service.py` 的 41 个类/函数名全部仍可从 facade 访问。
- router 需要的 8 个公开函数 + 7 个异常类保持旧路径。
- IDE `judge.approve` 仍可从旧路径导入 `StudioApprovalSummaryNotFoundError` / `approve_studio_writeback`。
- 新模块不反向 import `studio.service`；依赖方向为 source/review/recovery leaves → approval commit point → chapter_review orchestration。
- `approval.py` 是唯一执行 `session.commit()` 和 `clear_book_context_cache()` 的 Studio 模块；`_studio_repair_patch` 只有 `review_reads.py` 一个实现。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/studio/` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `cd apps/api && uv run pytest tests/test_studio_book_list_api.py -q` → **24 passed**
- `cd apps/api && uv run pytest tests/test_ide_commands.py tests/test_ide_agent_orchestrator.py tests/test_approval_writeback.py tests/test_chapter_approval_edges.py -q` → **46 passed**
- 旧符号兼容脚本（对比 `git show HEAD:apps/api/app/domains/studio/service.py`）→ **41 old symbols, missing []**

**行为变更**：false。纯文件级移动 + facade re-export；Studio source reads、Judge/Repair 摘要、主动章节审阅、批准写回、恢复摘要、cache 清理和旧 import path 保持旧语义。

**影响**：`studio/service.py` 已从 763 行收敛为约 53 行兼容 facade；Studio 工作台按读源、评审、恢复、批准和主动编排形成更深的 module，approval commit point 的 locality 明显提升。

## RT 重构验证（2026-06-29，完成）

**条目**：Wave 3 RT — 拆分 `retrieval/service.py` 与 `model_runs/service.py`（零行为变更）

**目标**：把 Retrieval 的评分、候选加载、索引写入和 Workbench 投影从搜索装配中分离；把 ModelRun 的真表写入和 Runs runtime diagnostics 从查询 seam 中分离。旧 `service.py` 路径继续承接 router、Story Memory、Scene Packet、workflow adapter 和测试的兼容 interface。

**已完成模块**：
1. `retrieval/scoring.py`
   - 承载 `RetrievalScore`、`_keywords`、`_score_chunk`、`_cosine_similarity`、rerank window 与 reranker adapter；性能护栏函数体保留 `inspect.getsource` 断言需要的字面片段。
2. `retrieval/candidate_loader.py`
   - 承载 `SearchCandidateLoad`、keyword prefilter、pgvector candidate order、候选上限环境变量和候选加载日志；logger 名称固定为 `app.domains.retrieval.service`。
3. `retrieval/indexing.py`
   - 承载 `RetrievalInputError`、资料源创建/列表、刷新运行、chunk 切分、embedding client 解析和 scope 校验。
4. `retrieval/workbench.py`
   - 承载 Workbench source/refresh/hit 投影和聚合查询。
5. `retrieval/service.py`
   - 收敛为约 137 行搜索装配 facade，保留 `search_retrieval` / `search_retrieval_workbench`，并 re-export 旧公开函数和 private helper。
6. `model_runs/recording.py`
   - 承载 `ModelRunError`、`create_model_run`、runtime completed/failed 记录、workflow payload adapter 和引用/payload 校验 helper。
7. `model_runs/runs_diagnostics.py`
   - 承载 Runs JobRun runtime diagnostics、provider/model usage/runtime tools 投影、checkpoint 和 retry 创建。
8. `model_runs/service.py`
   - 收敛为约 88 行查询/wrapper seam，保留 `list_model_runs`、`build_model_run_list_query`、字面 `def get_runs_job_run(` 和 `def record_workflow_model_run_payload(`。

**硬约束检查**：
- `retrieval.service` 旧 36 个类/函数名全部仍可访问；`model_runs.service` 旧 30 个类/函数名全部仍可访问。
- `search_retrieval` 继续在 `retrieval/service.py` 中通过旧模块全局 `_score_chunk` binding 调用评分函数，保持 `test_retrieval_embedding.py` monkeypatch seam。
- `_keywords`、`_score_chunk`、`_cosine_similarity` 的 `inspect.getsource` 性能护栏仍通过。
- `story_memory.recall` 私有导入 `app.domains.retrieval.service._cosine_similarity` 保持。
- `test_source_pruning.py` 直接读取 `model_runs/service.py` 要求的 `def get_runs_job_run(`、`runtime_diagnostics`、`def record_workflow_model_run_payload(` 字面证据保持。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/retrieval/ app/domains/model_runs/` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `cd apps/api && uv run pytest tests/test_retrieval_embedding.py tests/test_retrieval_workbench_api.py tests/test_retrieval_pgvector.py tests/test_scene_packet_embedding_wiring.py tests/test_scene_packet_context_compiler.py tests/test_story_memory_contract.py tests/test_model_runs.py tests/test_job_runtime_bridge.py tests/test_phase4_service_acceptance.py tests/test_source_pruning.py -q` → **73 passed**
- 旧符号兼容脚本（对比 `git show HEAD`）→ retrieval **36 old symbols, missing []**；model_runs **30 old symbols, missing []**
- `git diff --check -- apps/api/app/domains/retrieval/service.py apps/api/app/domains/retrieval/scoring.py apps/api/app/domains/retrieval/candidate_loader.py apps/api/app/domains/retrieval/indexing.py apps/api/app/domains/retrieval/workbench.py apps/api/app/domains/model_runs/service.py apps/api/app/domains/model_runs/recording.py apps/api/app/domains/model_runs/runs_diagnostics.py` → 通过
- `node scripts/run-e2e.mjs tests/e2e/phase5-runtime-diagnostics.spec.ts --continue-on-error` → OpenAPI refresh/drift passed；Phase 5 contract tests **5 passed / 1 failed**；API verification **65 passed**；workflow verification **69 passed**。失败项为既有 RuntimeToolRead 治理清单漂移：OpenAPI schema 现在包含 `event_store_required`、`mcp_server`、`mcp_tool_name`、`origin`、`permission_level`、`read_only`、`requires_confirmation` 等字段，而 e2e 期望仍是旧字段集。

**行为变更**：false。纯文件级移动 + 兼容 wrapper；Retrieval 搜索排序、pgvector fallback、candidate load 日志、Workbench 投影、ModelRun 写入、workflow payload adapter、Runs diagnostics 与 retry 行为保持旧语义。

**影响**：Retrieval 和 ModelRun 的高变化知识从两个 service 大文件中分离出来；搜索装配与 Runs 查询 seam 留在旧路径，关键测试/调用 interface 稳定，同时 scoring、candidate loading、indexing、recording 和 diagnostics 的 locality 更清晰。

## D4 重构验证（2026-06-29，完成）

**条目**：Wave 3 D4 — 拆分 workflow prompt builder/context（零行为变更）

**目标**：把 Prompt 构建的底层 render、section 组合和 GenerationState continuity budget 从两个大文件中拆出；`builder.py` 继续作为公开 prompt builder interface，`context.py` 继续作为 GenerationState → NarrativeContext adapter。

**已完成模块**：
1. `storyforge_workflow/prompts/_render.py`
   - 承载 `RETURN_PROSE`、`RETURN_STRUCTURED`、`RETURN_JSON`、`_clean`、`_section`、`_join_sections`。
2. `storyforge_workflow/prompts/_sections.py`
   - 承载作品策略、角色、创作准则、文风、叙事位置、场景质量、ChapterBeat、连续性、上文衔接和节奏 section 构建。
3. `storyforge_workflow/prompts/_continuity_budget.py`
   - 承载 continuity facts 的排序 key、POV/章节匹配、预算累计、token 估算和环境变量预算读取。
4. `storyforge_workflow/prompts/builder.py`
   - 保留全部公开 prompt builder 字面定义和关键字符串契约；旧 private render/section helpers 经 import 兼容回引。
5. `storyforge_workflow/prompts/context.py`
   - 保留 `narrative_context_from_state` 和 state adapter 主流程；continuity budget helpers 经 import 兼容回引。

**硬约束检查**：
- `builder.py` 旧 22 个函数名全部仍可访问；`context.py` 旧 20 个函数名全部仍可访问。
- `build_draft_prompt` 的 `length_line` 分支仍在 `builder.py`；`build_critique_prompt` / `build_revision_prompt` 字符串契约仍在 `builder.py`，满足 `test_source_pruning.py`。
- Critique `score_dimensions` 唯一性、ChapterBeat prompt 契约、revision strategy 契约和 style fingerprint targets 仍通过测试。
- continuity sort key 元组和 `_within_continuity_budget` 的预算累加分支仅移动到 `_continuity_budget.py`，语义保持不变。
- `prompts/__init__.py` 未修改，仍只转导出公开构建器，不转导出 prompt models。

**本地验证**：
- `cd apps/workflow && uv run ruff check storyforge_workflow/prompts/` → All checks passed
- `cd apps/workflow && uv run python -c "import storyforge_workflow.prompts; print('import ok')"` → Import OK
- `cd apps/workflow && uv run pytest tests/test_prompt_builder.py tests/test_generation_state_references.py tests/test_source_pruning.py tests/test_generation_graph.py -q` → **63 passed**
- 旧符号兼容脚本（对比 `git show HEAD`）→ builder **22 old functions, missing []**；context **20 old functions, missing []**
- `git diff --check -- apps/workflow/storyforge_workflow/prompts/builder.py apps/workflow/storyforge_workflow/prompts/context.py apps/workflow/storyforge_workflow/prompts/_render.py apps/workflow/storyforge_workflow/prompts/_sections.py apps/workflow/storyforge_workflow/prompts/_continuity_budget.py` → 通过

**行为变更**：false。纯文件级移动 + private compatibility re-export；prompt 文本、输出契约、continuity priority/budget 和 package public surface 保持旧语义。

**影响**：Prompt builder 的底层 render、section composition 和 continuity budget knowledge 分离，公开 builder/context seam 保持稳定，后续改 prompt 文案或 continuity 预算策略时 locality 更好。

## D3 重构验证（2026-06-29，完成）

**条目**：Wave 3 D3 — 拆分 workflow runtime Provider Gateway adapter（零行为变更）

**目标**：把 provider 错误分类、usage/cost 估算和 fallback provider 逻辑从 `provider_adapter.py` 中分离；旧 `storyforge_workflow.runtime.provider_adapter` 路径继续作为 runtime、测试和 monkeypatch 的兼容 interface。`provider_client.py` 本轮不动。

**已完成模块**：
1. `storyforge_workflow/runtime/provider_errors.py`
   - 承载 `ProviderErrorKind`、`ProviderError`、`ProviderTimeoutError`、HTTP 错误分类、Retry-After 解析和 HTTP error body 读取。
2. `storyforge_workflow/runtime/provider_usage.py`
   - 承载 `_estimate_token_count`、`_estimate_cost`、Chat Completion usage payload 解析和真实/估算 usage 归一。
3. `storyforge_workflow/runtime/provider_fallback.py`
   - 承载 `FallbackProviderAdapter`、fallback metadata 附着、默认 fallback observer、Sentry breadcrumb、OpenAI-compatible fallback 调用和畸形响应校验。
4. `storyforge_workflow/runtime/provider_adapter.py`
   - 收敛为约 362 行 Provider Gateway adapter facade，保留请求/响应快照、真实 client adapter、Mock adapter、默认 provider 装配和 parity harness；旧错误/usage/fallback 私有 helper 经 import 回引。

**硬约束检查**：
- `ProviderError` / `ProviderErrorKind` / `ProviderTimeoutError`、`FallbackProviderAdapter`、`build_default_provider_adapter` 等旧路径继续可从 `provider_adapter.py` 导入。
- `test_provider_adapter.py` monkeypatch 的 `provider_adapter_module.generate_chat_completion` 与 `provider_adapter_module.provider_config` 仍在旧模块命名空间，默认 factory 继续读取这些全局 binding。
- `test_source_pruning.py` 要求的 `def _estimate_token_count(`、`def _estimate_cost(` 字面 wrapper 仍在 `provider_adapter.py`，且 `_estimate_token_usage` 未回归。
- `ProviderParityCase`、`ProviderParityResult`、`ProviderParityHarness` 字面类定义依 source-pruning 护栏继续留在具体 `provider_adapter.py`；runtime 包级入口不转导出 parity harness。
- `provider_fallback.py` 仅在 `TYPE_CHECKING` 下引用 adapter 类型，运行期不反向 import `provider_adapter.py`，避免 import 环。

**本地验证**：
- `cd apps/workflow && uv run ruff check storyforge_workflow/runtime/provider_adapter.py storyforge_workflow/runtime/provider_errors.py storyforge_workflow/runtime/provider_fallback.py storyforge_workflow/runtime/provider_usage.py tests/test_provider_adapter.py tests/test_provider_fallback.py tests/test_provider_parity_harness.py tests/test_runtime_runner.py tests/test_model_run_token_tracking.py tests/test_source_pruning.py` → All checks passed
- `cd apps/workflow && uv run python -c "import storyforge_workflow.runtime; import storyforge_workflow.runtime.provider_adapter; import storyforge_workflow.runtime.provider_fallback; print('import ok')"` → Import OK
- `cd apps/workflow && uv run pytest tests/test_provider_adapter.py tests/test_provider_fallback.py tests/test_provider_parity_harness.py tests/test_runtime_runner.py tests/test_model_run_token_tracking.py tests/test_source_pruning.py -q` → **71 passed**
- `cd apps/workflow && uv run pytest -q` → **322 passed**
- `git diff --check -- apps/workflow/storyforge_workflow/runtime/provider_adapter.py apps/workflow/storyforge_workflow/runtime/provider_errors.py apps/workflow/storyforge_workflow/runtime/provider_fallback.py apps/workflow/storyforge_workflow/runtime/provider_usage.py apps/workflow/tests/test_provider_adapter.py` → 通过

**行为变更**：false。纯文件级移动 + 兼容回引；provider 错误分类、except 链、Retry-After、usage/cost 估算、fallback metadata、fallback response 校验、默认 factory 与 parity harness 行为保持旧语义。

**影响**：Provider Gateway 的 interface 保持稳定，错误分类、usage 观测和 fallback provider 知识各自形成更深的 module；`provider_adapter.py` 不再混装 HTTP 分类、usage 解析和备用端点细节，后续改 provider 观测或 fallback 策略时 locality 更好。

## C4 重构验证（2026-06-29，完成）

**条目**：Wave 3 C4 — 拆分 Desktop `api-client.ts` 与 `project-context.ts`（零行为变更 + 护栏补齐）

**目标**：把 Desktop 端 API client 的 REST、WebSocket、SSE、payload codec、错误详情读取与类型定义拆开；把 project context 的语义分类、索引构建、项目初始化、路径工具和 context bundle/cache 拆开。旧 `src/lib/api-client.ts` 与 `src/lib/project-context.ts` 路径继续作为调用方兼容 barrel。

**已完成模块**：
1. `src/lib/api/types.ts`
   - 承载 API config、revision、Agent socket、BookRun/WritingRun event、assistant session 等类型。
2. `src/lib/api/config.ts`
   - 承载 Tauri/preview API config 解析和 baseUrl trim helper。
3. `src/lib/api/errors.ts`
   - 承载 `readErrorDetail`，统一 JSON detail 与非 JSON fallback。
4. `src/lib/api/codecs.ts`
   - 承载 `toAssistantContextBundlePayload`，把 Desktop context bundle camelCase 映射为后端 snake_case。
5. `src/lib/api/assistant.ts`
   - 承载 `requestRevision`、`getAssistantSession`、`listAgentRoles`、`probeProviderHealth` 的 REST 调用与响应映射。
6. `src/lib/api/agent-socket.ts`
   - 承载 Agent WebSocket user/control message、socket URL 构建和 Agent socket type guards。
7. `src/lib/api/run-events.ts`
   - 承载 BookRun/WritingRun SSE 订阅。
8. `src/lib/project/types.ts`
   - 承载 SemanticFile、ProjectIndex、ContextBundle 等 project context 类型。
9. `src/lib/project/path.ts`
   - 承载 root/path normalization、relative path、project basename 和 pinned-file match normalization。
10. `src/lib/project/semantics.ts`
   - 承载 semantic kind label、canonical folder classification 和 empty counts。
11. `src/lib/project/index.ts`
   - 承载 project index 构建和 Tauri directory scan adapter。
12. `src/lib/project/initialize.ts`
   - 承载 canonical story project directory/readme 初始化。
13. `src/lib/project/context-bundle.ts`
   - 承载 context bundle selection、pinned file matching、TTL cache 和 excerpt 读取。
14. `src/lib/api-client.ts` / `src/lib/project-context.ts`
   - 收敛为旧路径 barrel，分别约 50 行与 15 行。

**护栏补齐**：
- `tests/api-client.test.ts` 新增 `requestRevision` payload/response 映射测试。
- 新增 JSON error detail 冒烟，锁定 `readErrorDetail` 对后端 `detail` 字段的透传。
- 新增 `probeProviderHealth` camelCase 映射与非 JSON 错误 fallback 测试。

**硬约束检查**：
- 旧 `../src/lib/api-client` 和 `../src/lib/project-context` import path 不变，组件与测试无需改调用路径。
- `toAssistantContextBundlePayload` 仍经 `api-client.ts` barrel 可用，`project-context.test.ts` 跨模块用法保持。
- `contextBundleCache` 单例完整迁到 `project/context-bundle.ts`，没有拆出第二份 cache。
- 子模块依赖叶子模块，不经 `api-client.ts` / `project-context.ts` barrel 回流，避免 import 环。

**本地验证**：
- `cd apps/desktop/frontend && npm run typecheck` → 通过
- `cd apps/desktop/frontend && npm run test -- api-client` → **7 passed**
- `cd apps/desktop/frontend && npm run test -- api-client project-context story-navigator chat-window app` → **26 passed**
- `cd apps/desktop/frontend && npm run test` → **62 passed**
- `git diff --check -- apps/desktop/frontend/src/lib/api-client.ts apps/desktop/frontend/src/lib/api apps/desktop/frontend/src/lib/project-context.ts apps/desktop/frontend/src/lib/project apps/desktop/frontend/tests/api-client.test.ts` → 通过

**行为变更**：false。纯文件级移动 + 测试护栏补齐；API config、REST headers/body、WebSocket payload、SSE event parsing、Provider Health 映射、project semantic classification、context bundle selection/cache 和 story project initialization 保持旧语义。

**影响**：Desktop client 的 API transport 与 project context 不再挤在两个大文件里；后续处理 generated OpenAPI types 或调整 context bundle 预算时，REST codec、socket transport、SSE、project semantic index 和 context cache 的 locality 更清楚。

## D1 重构验证（2026-06-29，完成）

**条目**：Wave 3 D1 — 拆分 workflow BookLoop 与 BookRun adapter（零行为变更）

**目标**：把整书循环的类型、预算、调度、结果投影，以及 BookRun adapter 的标量清洗、dispatch payload 和卷计划逻辑从两个主文件中拆出；`book_loop.py` 与 `book_run_adapter.py` 继续作为旧调用路径和主编排 seam。

**已完成模块**：
1. `storyforge_workflow/orchestrators/book_loop_types.py`
   - 承载 `BookLoopRequest`、`BookLoopResult`、`ChapterExecutionError`、`ChapterConsistencyReport` 和 BookLoop Callable 别名。
2. `storyforge_workflow/orchestrators/book_loop_budget.py`
   - 承载 token/time/chapter 预算累计、暂停原因、provider degradation/fallback 限制判断。
3. `storyforge_workflow/orchestrators/book_loop_scheduling.py`
   - 承载并行开关、预取窗口、并行 runtime tracker 和 integration metrics 投影。
4. `storyforge_workflow/orchestrators/book_loop_results.py`
   - 承载章节 progress、checkpoint entry、冲突阻断结果和 generated-but-uncommitted 投影。
5. `storyforge_workflow/orchestrators/book_run_adapter_types.py`
   - 承载 BookRun adapter request、ports、progress sink、卷计划数据类和测试 sink。
6. `storyforge_workflow/orchestrators/book_run_adapter_coerce.py`
   - 承载 dispatch payload 标量清洗 helper，保留各 helper 原有差异。
7. `storyforge_workflow/orchestrators/book_run_adapter_payload.py`
   - 承载 narrative plan、chapter dispatch map、planning refs 和 arc consistency barrier adapter。
8. `storyforge_workflow/orchestrators/book_run_adapter_volume.py`
   - 承载 volume plan 解析与 BookLoopResult → volume_progress 投影。
9. `book_loop.py` / `book_run_adapter.py`
   - 分别收敛为约 348 行与约 390 行，保留执行闭环与 skill runner 主编排，并回引旧路径符号。

**硬约束检查**：
- `ChapterConsistencyReport`、`BookLoopRequest`、`BookLoopResult`、`ConsistencyBarrier` 等旧 `book_loop.py` import path 继续可用。
- `BookRunChapterRange`、`BookRunVolumePlanItem`、`CallableProgressSink`、`CapturingProgressSink` 等旧 `book_run_adapter.py` import path 继续可用。
- `run_book_loop` 仍是 BookLoop 的测试 surface；顺序/并行执行、precommit、commit side effects、provider fallback pause 和 budget pause 顺序保持不变。
- `run_book_run_with_skill_runner` 的 NovelSkillRunner 生命周期仍留在 adapter 主文件，避免把章节执行闭包拆成浅模块。
- 两套相似标量 helper 没有合并，避免 `_int_value` / `_positive_int_or_zero` 等语义漂移。

**本地验证**：
- `cd apps/workflow && uv run ruff check storyforge_workflow/orchestrators/ tests/test_book_loop_three_chapters.py tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py` → All checks passed
- `cd apps/workflow && uv run pytest tests/test_book_loop_three_chapters.py tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py tests/test_arc_consistency.py tests/test_generation_graph.py tests/test_generation_state_references.py tests/test_novel_loop_single_chapter.py tests/test_source_pruning.py -q` → **65 passed**
- `cd apps/workflow && uv run pytest -q` → **322 passed**
- `git diff --check -- apps/workflow/storyforge_workflow/orchestrators/book_loop.py apps/workflow/storyforge_workflow/orchestrators/book_loop_types.py apps/workflow/storyforge_workflow/orchestrators/book_loop_budget.py apps/workflow/storyforge_workflow/orchestrators/book_loop_results.py apps/workflow/storyforge_workflow/orchestrators/book_loop_scheduling.py apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py apps/workflow/storyforge_workflow/orchestrators/book_run_adapter_types.py apps/workflow/storyforge_workflow/orchestrators/book_run_adapter_coerce.py apps/workflow/storyforge_workflow/orchestrators/book_run_adapter_payload.py apps/workflow/storyforge_workflow/orchestrators/book_run_adapter_volume.py` → 通过

**行为变更**：false。纯文件级移动 + 兼容回引；BookLoop 顺序/并行语义、预算暂停、provider degradation、章节 progress、卷计划 progress、memory/continuity side effects 和旧 import path 保持旧语义。

**影响**：BookLoop 的核心执行 interface 更集中，预算、调度和结果投影知识获得更好的 locality；BookRun adapter 的 payload/volume/type adapter 也不再挤在主闭包旁，后续处理 dispatch payload 或卷计划时测试 surface 更清楚。

## D2 重构验证（2026-06-29，完成）

**条目**：Wave 3 D2 — 拆分 workflow runtime checkpoint store（零行为变更）

**目标**：把 checkpoint 记录类型、ModelRun sink adapter、内存 store 与 SQLite store 从 `runtime/checkpoints.py` 中拆出；旧 `storyforge_workflow.runtime.checkpoints` 路径继续作为 runtime、测试和 monkeypatch 的兼容 interface。`runner.py` 本轮不拆。

**已完成模块**：
1. `storyforge_workflow/runtime/checkpoint_records.py`
   - 承载 `RuntimeRecord`、`RuntimeStateSnapshot`、`RuntimeModelRunRecord`、datetime 格式化/解析与 SQLite row → record/snapshot 投影。
2. `storyforge_workflow/runtime/model_run_sink.py`
   - 承载 `ModelRunPayload`、`ModelRunSink`、`ApiModelRunAdapter`、API JobRun id 校验和 observability 字段提升 helper。
3. `storyforge_workflow/runtime/memory_checkpoint_store.py`
   - 承载 `InMemoryRuntimeCheckpointStore` 显式测试替身和引用化 state 保存逻辑。
4. `storyforge_workflow/runtime/sqlite_checkpoint_store.py`
   - 承载 `RuntimeCheckpointStore`、SQLite schema/setup、连接复用、WAL/busy_timeout 配置、write-behind、flush、默认 sqlite path 与 env helper。
5. `storyforge_workflow/runtime/checkpoints.py`
   - 收敛为约 62 行 facade，回引旧公开/私有符号，并保留 `sqlite3` monkeypatch 入口。

**硬约束检查**：
- 旧 `checkpoints.py` 的 24 个顶层类/函数名全部仍可从 facade 访问，兼容脚本结果：`old symbols 24, missing []`。
- `RuntimeCheckpointStore`、`InMemoryRuntimeCheckpointStore`、`ModelRunPayload`、`ApiModelRunAdapter` 等旧 import path 不变，`runtime/__init__.py` 无需改调用面。
- `test_workflow_lifecycle` 的 `monkeypatch.setattr("storyforge_workflow.runtime.checkpoints.sqlite3.connect", ...)` 仍影响 `RuntimeCheckpointStore._connect()` 的真实连接。
- `_default_sqlite_path` 对应实现仍处在 `runtime/` 同层模块，`Path(__file__).parents[2]` 默认 `.runtime/workflow-runtime.sqlite3` 路径不漂移。
- `runner.py` 的 `execute_provider_text` monkeypatch surface 未改动；失败回写收敛没有混进本轮纯移动。

**本地验证**：
- `cd apps/workflow && uv run ruff check storyforge_workflow/runtime/checkpoints.py storyforge_workflow/runtime/checkpoint_records.py storyforge_workflow/runtime/model_run_sink.py storyforge_workflow/runtime/memory_checkpoint_store.py storyforge_workflow/runtime/sqlite_checkpoint_store.py tests/test_workflow_lifecycle.py tests/test_runtime_runner.py tests/test_model_run_token_tracking.py tests/test_generation_state_references.py tests/test_source_pruning.py` → All checks passed
- `cd apps/workflow && uv run pytest tests/test_workflow_lifecycle.py tests/test_runtime_runner.py tests/test_model_run_token_tracking.py tests/test_generation_state_references.py tests/test_source_pruning.py -q` → **51 passed**
- `cd apps/workflow && uv run python -c "import storyforge_workflow.runtime; import storyforge_workflow.runtime.checkpoints; print('import ok')"` → Import OK
- 旧符号兼容脚本（对比 `git show HEAD:apps/workflow/storyforge_workflow/runtime/checkpoints.py`）→ **24 old symbols, missing []**；`checkpoints.py` 约 **62 行**
- `cd apps/workflow && uv run pytest -q` → **322 passed**
- `git diff --check -- apps/workflow/storyforge_workflow/runtime/checkpoints.py apps/workflow/storyforge_workflow/runtime/checkpoint_records.py apps/workflow/storyforge_workflow/runtime/model_run_sink.py apps/workflow/storyforge_workflow/runtime/memory_checkpoint_store.py apps/workflow/storyforge_workflow/runtime/sqlite_checkpoint_store.py docs/internal/refactor-master-plan.md .codex/verification-report.md` → 通过

**行为变更**：false。纯文件级移动 + 兼容回引；checkpoint record 写入、ModelRun runtime 记录、API ModelRun payload 映射、state 引用化、SQLite schema、连接复用、WAL 配置、write-behind flush 和旧 monkeypatch path 保持旧语义。

**影响**：`checkpoints.py` 不再同时承载记录类型、ModelRun adapter、内存替身和 SQLite 实现；checkpoint store 的 interface 保持稳定，records/sink/memory/sqlite 四个深 module 的 locality 更清楚，后续优化 runner 失败回写时可以单独评审。

## C2 重构验证（2026-06-29，完成）

**条目**：Wave 2 C2 — 拆分 Desktop `App.tsx` 根壳层（零行为变更）

**目标**：把 App 根组件中的窗口栏、项目库、欢迎/Agent 工作台、右侧编辑工作台、布局状态机、项目/文件 recent state 和 Tauri menu bridge 下沉到 `components/app/`；`App.tsx` 保留根壳层装配、命令 wiring 和静态源文本护栏。

**已完成模块**：
1. `src/components/app/helpers.ts`
   - 承载路径 basename/join、Markdown 文件名归一、recent storage key 和 project assistant session 存取。
2. `src/components/app/WindowMenu.tsx`
   - 承载顶部窗口栏和 Tauri window action adapter。
3. `src/components/app/CodexSidebar.tsx`
   - 承载项目库、项目会话展开、provider settings 入口和 project 初始化按钮。
4. `src/components/app/WelcomeWorkspace.tsx`
   - 承载 WelcomeWorkspace、AgentWorkspace、AgentComposerHome 和顶部工具区。
5. `src/components/app/RightWorkspace.tsx`
   - 承载 StoryNavigator + Editor 工作台、文件树宽度拖拽和 floating composer。
6. `src/components/app/icons.tsx`
   - 承载 App 壳层使用的展示图标。
7. `src/components/app/useShellLayout.ts`
   - 承载 workspace/editor/composer/layout mode 状态机，以及 restore/focus/toggle/apply composer mode 等语义动作。
8. `src/components/app/useProjectWorkspace.ts`
   - 承载 recent projects/files 恢复与写入、active project/current file、project assistant session mapping。
9. `src/components/app/useTauriMenuBridge.ts`
   - 承载 Tauri menu event listeners、smoke API ready data attribute、unlisten 清理和错误状态。
10. `src/App.tsx`
   - 收敛为约 333 行根壳层，继续持有 Settings/CommandPalette、新建文件、初始化项目和子模块 wiring。

**硬约束检查**：
- `app.test.tsx` 依赖的 `data-testid="desktop-shell"`、`WindowMenu`、`CodexSidebar`、`AgentWorkspace`、`RightWorkspace`、`DynamicIDELayout`、`data-testid="assistant-panel"` 仍在 `App.tsx` 源文本可见。
- `RightWorkspace.tsx` 继续持有 `data-testid="editor-panel"` 与 `data-testid="file-tree-panel"`，满足 e2e 静态源文本护栏。
- `window.prompt('新建文件名', 'untitled.md')`、`window.confirm('文件已存在，是否直接打开？')`、新建失败 `window.alert` 文案保留在 `App.tsx` 命令层。
- Tauri menu bridge 仍注册 `menu:open-project`、`menu:new-file`、`menu:save`、`menu:close`、`menu:toggle-sidebar`、`smoke:reset-panels`，并继续维护 `data-smoke-api-ready`。
- App 不重新引入 Web legacy 路由入口；`apps/web` 未触碰。

**本地验证**：
- `cd apps/desktop/frontend && npm run typecheck` → 通过
- `cd apps/desktop/frontend && npm run test -- app app-icons` → **6 passed**
- `cd apps/desktop/frontend && npm run test` → **62 passed**（保留既有 Editor SSR `useLayoutEffect` warning，未阻断）
- `git diff --check -- apps/desktop/frontend/src/App.tsx apps/desktop/frontend/src/components/app/useTauriMenuBridge.ts apps/desktop/frontend/src/components/app/useShellLayout.ts apps/desktop/frontend/src/components/app/useProjectWorkspace.ts` → 通过

**行为变更**：基本为纯文件级移动 + hooks 下沉（项目打开/选择、文件 recent 更新、新建文件、项目初始化、布局切换、CommandPalette wiring、Tauri menu bridge 行为保持旧语义）。**一处有意行为变更**：`useTauriMenuBridge.ts` 把 `data-smoke-api-ready` 从 HEAD 的"进入 Tauri 运行时即同步置 true"改为 `probeApiRuntimeHealth()`（`GET /health/ready`）异步探针门控的真实就绪信号（runtime-health 新能力的前端侧）。属预期增强，已由 `app.test.tsx` 覆盖；但 e2e smoke 若依赖该属性置 true，需保证探针期间 API `/health/ready` 可达。2026-06-29 验收按"确认保留"处理。

**影响**：`App.tsx` 已从约 498 行进一步收敛到约 333 行根壳层；布局、项目工作区和 Tauri menu bridge 三个状态机各自形成更深的 module，后续调整桌面壳层交互时 locality 更好。

## C3 重构验证（2026-06-29，完成）

**条目**：Wave 2 C3 — 拆分 Desktop `Editor.tsx` Monaco/file lifecycle（零行为变更）

**目标**：把 Editor 的文件加载与 Monaco 实例生命周期从主壳层中拆出；`Editor.tsx` 继续保留保存、导出、历史恢复、分支操作、工具栏 JSX 和 e2e 依赖的源文本 marker。

**已完成模块**：
1. `src/components/editor/decorations.ts`
   - 承载 evidence 定位、issue decoration options 和 severity color 归一。
2. `src/components/editor/VersionHistory.tsx`
   - 承载版本历史列表、分支图侧栏、版本读取、列表筛选、BranchCanvas 接线和 `formatTimestamp`。
3. `src/components/editor/useBranchManifest.ts`
   - 承载分支清单加载、选择、创建分支、推进 head 与 manifest 落盘。
4. `src/components/editor/useSuggestionWriteback.ts`
   - 承载建议补丁接收、接受/分块接受、旁注保存、修订结果事件监听、Agent 写回快照与闭环记录。
5. `src/components/editor/useEditorFileLoader.ts`
   - 承载文件加载请求序号、loaded state、加载错误、切换文件时清理 issue decorations/suggestion/history/dirty 状态。
6. `src/components/editor/useMonacoEditor.ts`
   - 承载 Monaco 创建/销毁、font size update、smoke editor controller、dirty 状态更新、auto-save timer、Ctrl/Cmd+S 和 gutter issue click。
7. `src/components/Editor.tsx`
   - 收敛为约 458 行装配壳，保留保存/快照/分支推进、导出、历史恢复/checkout/branch from node、工具栏和源文本护栏。

**硬约束检查**：
- `Editor.tsx` 源文本仍包含 `recordRevisionLoop`、`emitAuthorLoopResult`、`editor-save-btn`、`editor-export-btn`，满足 `editor.test.tsx` 与 e2e 静态断言。
- `Editor.tsx` 仍持有 `data-testid="editor-root"`、`editor-empty`、`editor-export-btn`、`editor-history-btn`、`editor-container`。
- 文件切换仍先清 issue decorations，并重置 suggestion/history/dirty/loading state。
- Monaco change listener 继续 `setIsDirty(dirty)`；auto-save 与 Ctrl/Cmd+S 通过 ref 调用最新 `handleSave`，避免把 handleSave 放入 mount-only Monaco effect 依赖导致重建编辑器。
- `useMonacoEditor` 仍注册 smoke editor controller，Vite smoke 覆盖空编辑器挂载与布局展开路径。

**本地验证**：
- `cd apps/desktop/frontend && npm run typecheck` → 通过
- `cd apps/desktop/frontend && npm run test -- editor app` → **12 passed**（保留既有 Editor SSR `useLayoutEffect` warning，未阻断）
- `cd apps/desktop/frontend && npm run test` → **62 passed**（同上 warning）
- `cd apps/desktop/frontend && npm run verify:smoke` → `Desktop frontend smoke passed: http://localhost:5173/`
- `git diff --check -- apps/desktop/frontend/src/components/Editor.tsx apps/desktop/frontend/src/components/editor/useEditorFileLoader.ts apps/desktop/frontend/src/components/editor/useMonacoEditor.ts` → 通过

**行为变更**：false。纯文件级移动 + lifecycle hooks 下沉；文件加载、Monaco 初始化/销毁、dirty/auto-save、保存快照、导出、issue gutter click、版本历史和旧源文本护栏保持旧语义。

**影响**：`Editor.tsx` 已从约 553 行收敛为约 458 行装配壳；文件加载和 Monaco lifecycle 的 locality 更集中，后续若要改真实编辑器行为，可以围绕 hook interface 补更细运行期护栏，而不是在主组件里追状态。

## T1-1 重构验证（2026-06-29，完成）

**条目**：T1 Context/ScenePacket/Retrieval 边界固化第一刀 — Scene Packet contract + retrieval/context blocks 拆分（零行为变更）

**目标**：把 Scene Packet 裸 `packet` dict 的真实 interface 显式化，并把 `retrieval_bridge.py` 的出站检索 query 与 Context Compiler block 构建拆成深模块；旧 `retrieval_bridge.py` 路径继续兼容测试和调用方。

**已完成模块**：
1. `app/domains/scene_packets/packet_contract.py`
   - 新增 `ScenePacketBody` TypedDict，显式记录中文顶层键、可选 context/debug 键、基础 key order、context key order 和 required keys。
2. `app/domains/scene_packets/budget.py`
   - `build_packet()` 返回类型标注为 `ScenePacketBody`，基础 packet 字面量顺序不变。
3. `app/domains/scene_packets/context_pipeline.py`
   - `SceneContextAssembly.packet` 标注为 `ScenePacketBody`，并直接依赖新 `retrieval_query.py` / `context_blocks.py`。
4. `app/domains/scene_packets/retrieval_query.py`
   - 承载 `build_retrieval_query()` 出站检索 query 组合。
5. `app/domains/scene_packets/context_blocks.py`
   - 承载 `attach_compiled_context()`、`build_context_blocks()`、memory/retrieval/asset/continuity context block 构建和 retrieval hit metadata。
6. `app/domains/scene_packets/retrieval_bridge.py`
   - 收敛为约 23 行 facade，re-export 旧 8 个函数名。
7. `tests/test_scene_packet.py`
   - 新增 Scene Packet base key order / context key order / required keys golden 断言，复用现有 API fixture。

**硬约束检查**：
- 旧 `retrieval_bridge.py` 的 8 个函数名全部仍可从旧路径访问，兼容脚本结果：`old functions 8, missing []`。
- 顶层 packet key order 保持：`章节目标`、`活跃角色`、`关系状态`、`未回收伏笔`、`风格规则`、`必须包含事实`、`必须规避事实`、`用户意图`、`证据链接`、`上一章摘要`、`章节摘要`、`检索片段`，后续 context keys 按既有写入顺序出现。
- `ScenePacketRead.packet` 仍是 API 响应里的宽松 dict；本刀只增强内部 contract 和测试护栏，不改变 OpenAPI 输出。
- 预算行为不变：硬约束与活跃角色不被 retrieval snippets 挤掉，超预算只裁剪 `检索片段` 并置 `truncated=True`。
- Explorer 子代理 Lagrange 只读确认了 packet 写入点、测试覆盖和必须保留的错误语义；本轮未改文件。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/scene_packets/ tests/test_scene_packet.py tests/test_scene_packet_context_compiler.py tests/test_scene_packet_retrieval_upgrade.py tests/test_scene_packet_pacing_directive.py tests/test_context_compiler_memory_injection.py tests/test_context_compiler_persistence.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_scene_packet.py tests/test_scene_packet_context_compiler.py tests/test_scene_packet_retrieval_upgrade.py tests/test_scene_packet_pacing_directive.py tests/test_context_compiler_memory_injection.py tests/test_context_compiler_persistence.py tests/test_scene_packet_embedding_wiring.py tests/test_phase1_context_optimization_verify.py tests/test_ide_context_snapshot.py -q` → **22 passed, 1 skipped**
- `cd apps/api && uv run python -c "import app.main; import app.domains.scene_packets.retrieval_bridge as rb; print('import ok', hasattr(rb, 'retrieval_context_blocks'))"` → Import OK / `True`
- 旧符号兼容脚本（对比 `git show HEAD:apps/api/app/domains/scene_packets/retrieval_bridge.py`）→ **8 old functions, missing []**
- `git diff --check -- apps/api/app/domains/scene_packets/packet_contract.py apps/api/app/domains/scene_packets/budget.py apps/api/app/domains/scene_packets/context_pipeline.py apps/api/app/domains/scene_packets/retrieval_bridge.py apps/api/app/domains/scene_packets/retrieval_query.py apps/api/app/domains/scene_packets/context_blocks.py apps/api/tests/test_scene_packet.py` → 通过

**行为变更**：false。类型 contract + facade split + golden test；Scene Packet 输出、Context Compiler 注入/裁剪、retrieval metadata、pacing directive、Story Memory 注入、错误语义和旧 import path 保持旧语义。

**影响**：Scene Packet body 的 interface 不再只靠调用方记忆；retrieval query 与 context block 编译获得独立 locality。本刀之后的 `assemble_scene_context` 写入整理与预算对账 golden 已在 T1-2 单独完成。

## T1-2 重构验证（2026-06-29，完成）

**条目**：T1 Context/ScenePacket/Retrieval 边界固化收口 — `assemble_scene_context` 写入 helper 化 + 预算双口径 golden（零行为变更）

**目标**：把 `assemble_scene_context` 末段的 Scene Packet context 写入从内联字典操作收口为命名 helper，并用 golden 断言固化 `BudgetStatistics` 与 packet 内 `上下文预算` 两套口径当前保持一致；本刀只固化现状，不统一预算模型。

**已完成模块**：
1. `app/domains/scene_packets/context_pipeline.py`
   - 新增 `attach_memory_context()`、`attach_pacing_directive()`、`attach_retrieval_hits()`，分别承载 Story Memory、pacing directive、retrieval hit metadata 写入。
   - `assemble_scene_context()` 保持原写入顺序：`memory_context` → optional `pacing_directive` → optional `检索命中` → compiled context。
2. `tests/test_scene_packet_context_compiler.py`
   - 在 compiled context debug 测试中新增预算双口径断言：`BudgetStatistics.token_budget` 与 packet `上下文预算.token_budget` 一致，used tokens 不超过各自 budget，并锁定 packet `上下文预算` 当前 5 个键。

**硬约束检查**：
- `pacing_directive` 仍只在有效 pacing tag 存在时写入；无 directive 时不新增空键。
- `检索命中` 仍只在自动检索命中存在时写入；手工 `检索片段` 不触发该键。
- Story Memory payload 仍由 `memory_context_payload()` 统一 `model_dump()`，没有改变序列化形状。
- 预算语义不变：本刀只锁定 `BudgetStatistics` 与 packet debug budget 的现状一致性，不合并两套预算模型。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/scene_packets/ tests/test_scene_packet.py tests/test_scene_packet_context_compiler.py tests/test_scene_packet_retrieval_upgrade.py tests/test_scene_packet_pacing_directive.py tests/test_context_compiler_memory_injection.py tests/test_context_compiler_persistence.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_scene_packet.py tests/test_scene_packet_context_compiler.py tests/test_scene_packet_retrieval_upgrade.py tests/test_scene_packet_pacing_directive.py tests/test_context_compiler_memory_injection.py tests/test_context_compiler_persistence.py tests/test_scene_packet_embedding_wiring.py tests/test_phase1_context_optimization_verify.py tests/test_ide_context_snapshot.py -q` → **22 passed, 1 skipped**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `git diff --check -- apps/api/app/domains/scene_packets/packet_contract.py apps/api/app/domains/scene_packets/budget.py apps/api/app/domains/scene_packets/context_pipeline.py apps/api/app/domains/scene_packets/retrieval_bridge.py apps/api/app/domains/scene_packets/retrieval_query.py apps/api/app/domains/scene_packets/context_blocks.py apps/api/tests/test_scene_packet.py apps/api/tests/test_scene_packet_context_compiler.py docs/internal/refactor-master-plan.md .codex/verification-report.md` → 通过

**行为变更**：false。命名 helper 提取 + 对账 golden；Scene Packet 输出顺序、可选键写入条件、compiled context、retrieval metadata、Story Memory 注入、预算裁剪和错误语义保持旧语义。

**影响**：T1 已到当前合理边界。Scene Packet 的 packet contract、retrieval/query/context block locality、context 写入顺序与预算双口径现状都有测试和验证报告护栏；后续预算统一、证据链统一或共享契约消费应进入 T4/T5 独立评审。

## E2 计划校准验证（2026-06-29）

**条目**：对齐 `docs/internal/refactor-master-plan.md` 与当前 E2 实现状态（文档校准，无运行时代码变更）

**目标**：复核 E2-3/E2-4 是否已真实落地，避免 master plan 继续把已完成的 `chapter.review`/`chapter.repair` native migration 标为待办。

**复核结论**：
- `agent_runs/runtime.py` 已在 `run_user_message()` native dispatch `chapter.review` / `chapter.repair`，unsupported intent 直接抛 `AgentOrchestrationError`。
- `_run_chapter_review()` / `_run_chapter_review_repair()` 已走 live Tool Registry 的 `judge.run` / `judge.repair`。
- `_execute_tool()` 权限门排除集合不再包含 `legacy.orchestrator`。
- `ide/orchestrator.py` 仍保留旧实现代码和旧 import path surface；当前测试仍从旧路径 import `SUPPORTED_INTENTS`、`_detect_intent`、`AgentOrchestrationError`，runtime 也保留 `orchestrate_agent_message` 可见名作为 monkeypatch 契约。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/ app/domains/ide/orchestrator.py tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **61 passed**
- `git diff --check -- docs/internal/refactor-master-plan.md .codex/verification-report.md` → 通过

**行为变更**：false。本条只校准文档；E2-3 的行为变更与 E2-4 的 runtime fallback 删除已在 2026-06-28 对应验证段记录。

**影响**：E2 runtime 收口不再作为待办；剩余的 `ide/orchestrator.py` 整文件收缩/删除是兼容性 refactor，需要先替代旧 import 与 monkeypatch surface，单独评审。

## E2-5 重构验证（2026-06-29，完成）

**条目**：T3/E2 收尾 — `ide/orchestrator.py` 冻结实现收缩为兼容 facade

**目标**：删除不再由 live runtime 执行的 legacy IDE Agent 编排副本，同时保留旧 import path 和外部直调的最低兼容面。

**已完成模块**：
1. `app/domains/ide/orchestrator.py`
   - 从 1300+ 行 legacy 编排冻结副本收缩为约 31 行 compatibility facade。
   - re-export `AgentOrchestrationError`、`SUPPORTED_INTENTS`、`_detect_intent` 和 `orchestrate_agent_message`。
   - `orchestrate_agent_message()` 懒加载 `run_agent_user_message()` 并返回 `.result` dict，避免与 `agent_runs.runtime` 的旧 monkeypatch import 形成导入环。
2. `tests/test_ide_agent_orchestrator.py`
   - 新增 facade 契约测试：旧路径符号 identity 指向 live `agent_runs` contract，`agent_runs.runtime` 仍暴露 `orchestrate_agent_message` 供 monkeypatch。
   - 新增旧函数直调转发测试，锁定懒加载 delegate 到 `run_agent_user_message()`。

**硬约束检查**：
- `SUPPORTED_INTENTS` / `_detect_intent` / `AgentOrchestrationError` 旧 import path 保持可用。
- `agent_runs.runtime.orchestrate_agent_message` 仍存在，`test_agent_runs.py` 的 monkeypatch 契约不变。
- live WebSocket 路径仍通过 `run_agent_user_message()` → `AgentRuntime.run_user_message()`；旧函数即使被外部直调，也转发到同一 live seam。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/ide/orchestrator.py app/domains/agent_runs/runtime.py app/domains/agent_runs/intent.py tests/test_ide_agent_orchestrator.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_agent_runs.py -q` → **63 passed**
- `cd apps/api && uv run python -c "import app.main; import app.domains.ide.orchestrator as o; import app.domains.agent_runs.runtime as r; print('import ok', o.SUPPORTED_INTENTS is r.SUPPORTED_INTENTS, hasattr(r, 'orchestrate_agent_message'))"` → Import OK / `True True`

**行为变更**：live runtime false；旧 direct-call implementation changes from frozen legacy implementation to live AgentRuntime delegate. This is an intentional compatibility refactor after E2-3/E2-4 made AgentRuntime the only supported execution seam.

**影响**：T3/E2 不再有 large dead legacy body。`ide/orchestrator.py` now earns its keep as a tiny compatibility module; Agent intent and execution knowledge has one home in `agent_runs`.

## T2 重构验证（2026-06-29，完成）

**条目**：T2 Workflow runtime adapter 收口 — 合并逐字一致的 workflow orchestrator 标量 helper（零行为变更）

**目标**：把 BookLoop budget 与 BookRun adapter 中完全等价的「正数 int/float，否则归零」helper 收口到共享叶子模块；保留所有语义不同的 bool/string/optional coercion，避免顺手合并造成行为漂移。

**已完成模块**：
1. `storyforge_workflow/orchestrators/_coercion.py`
   - 新增 `_positive_int_or_zero()` 与 `_positive_float_or_zero()`，承载共享正数归零语义。
2. `storyforge_workflow/orchestrators/book_run_adapter_coerce.py`
   - 从共享模块 re-export 旧 `_positive_int_or_zero` / `_positive_float_or_zero` 私有路径，保留 adapter 旧 import surface。
3. `storyforge_workflow/orchestrators/book_loop_budget.py`
   - `_int_value()` / `_float_value()` 退为 wrapper，复用共享 helper，保留旧私有测试/调试 surface。

**硬约束检查**：
- 仅合并逐字一致的正数 int/float 归零语义；`_optional_positive_int()` 仍不接收字符串且不排除 bool，`novel_loop._optional_int()` 仍接收数字字符串且排除 bool，二者未合并。
- `_bool_value()` 的字符串 truthy 语义未动。
- 旧私有 helper 路径仍可 import；兼容探针输出 `_positive_int_or_zero(3)=3`、`_positive_float_or_zero(1.5)=1.5`、`_int_value(True)=True`、`_float_value(True)=1.0`，保持原 bool-as-int 细节。

**本地验证**：
- `cd apps/workflow && uv run ruff check storyforge_workflow/orchestrators/_coercion.py storyforge_workflow/orchestrators/book_run_adapter_coerce.py storyforge_workflow/orchestrators/book_loop_budget.py storyforge_workflow/orchestrators/book_run_adapter.py storyforge_workflow/orchestrators/book_loop.py tests/test_book_run_adapter.py tests/test_book_loop_three_chapters.py` → All checks passed
- `cd apps/workflow && uv run pytest tests/test_book_run_adapter.py tests/test_book_loop_three_chapters.py -q` → **39 passed**
- `cd apps/workflow && uv run pytest -q` → **322 passed**

**行为变更**：false。纯 helper 下沉 + old-path wrappers/re-export；BookLoop budget accumulation、BookRun adapter checkpoint budget summary、parallel budget pause、provider degradation pause 和 old private helper surface 保持旧语义。

**影响**：T2 已到当前合理边界。剩余 `runner.py` 失败回写收敛属于逻辑重构，不应与纯 helper/shared adapter 拆分混做。

## T5 LLM leaf utilities 重构验证（2026-06-29，完成）

**条目**：T5 横切一致性 — OpenAI-compatible LLM leaf utilities 下沉到 `app/common/llm_http.py`（零行为变更）

**目标**：把 book_runs 与 assistant 已共享的 LLM env/header/reasoning-strip 叶子工具从 `book_generation_llm.py` 下沉到 common；保留 `book_generation_llm._call_llm` 作为 book-run 异常、token/cost 和 latency 语义的旧 surface。

**已完成模块**：
1. `app/common/llm_http.py`
   - 新增 `THINK_*` regex、`strip_reasoning_leak()`、`env_value()`、`optional_int()`、`optional_float()`、`openai_compatible_headers()`。
2. `app/domains/book_runs/book_generation_llm.py`
   - 以显式 alias 保留 `THINK_*`、`_strip_reasoning_leak`、`_env_value`、`_optional_int`、`_optional_float` 旧私有名。
   - `_llm_request_headers()` 继续负责 `BookGenerationPreflightError` 异常映射，调用 common header builder；`_call_llm()`、`_token_usage()`、`_cost_breakdown()` 和 URL/timeout/latency 行为未移动。

**硬约束检查**：
- assistant 仍可 monkeypatch `assistant_service._call_llm`，`revise_file_content()` 调用面未变。
- `book_generation.py` facade 仍 re-export `THINK_*`、`_strip_reasoning_leak`、`_env_value`、`_llm_request_headers`、`_optional_int`、`_optional_float` 等旧名。
- `STORYFORGE_LLM_AUTH_HEADER=api-key` / default bearer 行为不变；非法 auth header 仍抛 `BookGenerationPreflightError("STORYFORGE_LLM_AUTH_HEADER 只支持 api-key 或 bearer。")`。
- judge LLM client 未合并，保留其 `STORYFORGE_JUDGE_LLM_*` fallback 与 `httpx` monkeypatch 契约。

**本地验证**：
- `cd apps/api && uv run ruff check app/common/llm_http.py app/domains/book_runs/book_generation_llm.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_preflight.py app/domains/book_runs/book_generation_judge.py app/domains/assistant/service.py tests/test_book_generation.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py -q` → **40 passed, 1 warning**（既有 `HTTP_422_UNPROCESSABLE_ENTITY` deprecation warning）
- `cd apps/api && uv run python -c "import app.main; from app.domains.book_runs.book_generation import _llm_request_headers; print('import ok', _llm_request_headers({'STORYFORGE_LLM_API_KEY':'k'}))"` → Import OK，返回 bearer header
- `git diff --check -- apps/api/app/common/llm_http.py apps/api/app/domains/book_runs/book_generation_llm.py apps/api/app/domains/book_runs/book_generation.py apps/api/app/domains/assistant/service.py` → 通过

**行为变更**：false。leaf utilities 下沉 + old-path aliases；真实 LLM 请求 payload、headers、timeout、reasoning tag stripping、token usage/cost 统计、assistant revise 错误映射和 provider health probe 行为保持旧语义。

**影响**：T5 的零行为 LLM 收敛部分完成；错误模型统一与 judge LLM 行为对齐仍需独立行为评审。

## T5 assistant DomainError 收口验证（2026-06-29，完成第一刀）

**条目**：T5 横切一致性 — assistant 会话/修订错误接入 `DomainError` 全局 handler

**目标**：把 Assistant revise 路径的可预期错误从 router 手写 `HTTPException` 映射收口为领域异常自身携带 status code；保留外部 HTTP 契约：
- 会话不存在 → 404
- LLM 未配置 → 422
- 修订调用失败 → 502
- provider-health 继续始终 200 返回结构化诊断

**已完成模块**：
1. `app/domains/assistant/service.py`
   - `AssistantSessionNotFoundError` / `AssistantToolCallNotFoundError` 改为派生 `NotFoundError`，同时保留 `RuntimeError` 兼容现有捕获面。
   - `AssistantLlmNotConfiguredError` / `AssistantReviseError` 改为派生 `DomainError`，分别显式设置 `status_code = 422` / `502`，同时保留 `RuntimeError`。
2. `app/domains/assistant/router.py`
   - 删除 assistant sessions/tool-calls/revise 端点的重复 try/except 映射，交由 `app.main` 的 `DomainError` handler 返回 `{"detail": str(exc)}`。
3. `tests/test_assistant_revise.py`
   - 新增 revise missing session 404 回归测试，补齐 404/422/502 三种错误状态护栏。

**硬约束检查**：
- `agent_runs/runtime.py` 和 legacy `ide/orchestrator.py` 仍可按旧类名捕获 assistant 错误；多继承保持 `isinstance(exc, RuntimeError)` 为真。
- `probe_provider_health()` 不改；misconfigured/unauthorized/unreachable 仍是 200 响应体状态，不走 HTTP error。
- 错误响应体形状不变，仍是 `{"detail": "..."}`。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/assistant/service.py app/domains/assistant/router.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_assistant_revise.py tests/test_assistant_provider_health.py -q` → **12 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **61 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK

**行为变更**：外部 HTTP/response contract false；内部异常继承结构有意收口到 `DomainError`，以提高错误处理 locality。

**影响**：assistant router 不再携带 404/422/502 映射知识，错误 status 属于领域异常 interface。T5 剩余错误模型统一仍需按域独立评审，尤其 `ide`、`book_generation`、`agent_runs` 与 judge LLM 差异。

## T5 IDE command DomainError 收口验证（2026-06-29，完成第一刀）

**条目**：T5 横切一致性 — IDE command HTTP 错误接入 `DomainError` 全局 handler

**目标**：把 IDE command endpoint 的可预期错误从 router 手写 `HTTPException` 映射收口为领域异常自身携带 status code；保留外部 HTTP 契约：
- 未知命令 → 404
- 命令参数或领域状态不满足执行条件 → 400
- WebSocket command 分支继续返回 `{type: "error", detail: ...}` 消息，不改为 HTTP 异常

**已完成模块**：
1. `app/domains/ide/command_registry.py`
   - `IdeCommandNotFoundError` 改为派生 `NotFoundError`，同时保留 `Exception` 兼容现有捕获面。
   - `IdeCommandExecutionError` 改为派生 `InputError`，同时保留 `Exception`。
2. `app/domains/ide/router.py`
   - `/api/ide/commands/{command_id}` 删除重复 404/400 try/except，交由 `app.main` 的 `DomainError` handler 返回 `{"detail": str(exc)}`。
   - WebSocket command 分支保留显式捕获，继续把领域错误投影成 socket error message。

**硬约束检查**：
- `test_unknown_ide_command_returns_404` 和 IDE command invalid-state tests 继续锁定 HTTP status 与 detail。
- Agent WebSocket command tests 继续通过，说明 socket 分支未被 HTTP handler 语义污染。
- `IdeCommandNotFoundError.status_code == 404` import smoke 通过。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/ide/command_registry.py app/domains/ide/router.py tests/test_ide_commands.py tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_ide_commands.py tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **70 passed**
- `cd apps/api && uv run python -c "import app.main; from app.domains.ide.command_registry import IdeCommandNotFoundError; print('import ok', IdeCommandNotFoundError.status_code)"` → Import OK / `404`

**行为变更**：外部 HTTP/WebSocket contract false；内部异常继承结构有意收口到 `DomainError`，以提高错误处理 locality。

**影响**：IDE command HTTP router 不再携带命令错误 status 知识，HTTP status 属于 command registry 的 exception interface。T5 剩余错误模型统一仍需按域独立评审。

## T5 AgentRun router DomainError 去重验证（2026-06-29，完成）

**条目**：T5 横切一致性 — AgentRun not-found 由 `NotFoundError` 全局 handler 接管

**目标**：`AgentRunNotFoundError` 已派生 `NotFoundError`，删除 `agent_runs/router.py` 中重复的 404 `HTTPException` 映射，保留外部 HTTP 契约。

**已完成模块**：
1. `app/domains/agent_runs/router.py`
   - 删除 `get_agent_run` / `list_agent_run_events` / `list_agent_artifacts` / `list_agent_checkpoints` / SSE stream 端点的重复 try/except。
   - 移除不再需要的 `HTTPException` / `status` / `AgentRunNotFoundError` imports。

**硬约束检查**：
- AgentRun 缺失仍通过 `DomainError` handler 返回 404 + `{"detail": "AgentRun 不存在。"}`。
- SSE stream 端点仍先读取事件列表；缺失 run 在创建 `StreamingResponse` 前抛出 404，不改变流式响应成功路径。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/router.py app/domains/agent_runs/service.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **33 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK

**行为变更**：false。外部 HTTP response contract 不变；router 删除重复异常映射。

**影响**：AgentRun 读取端点的 not-found status 回到领域异常 interface，减少 router 与 service 的错误知识重复。

## T5 BookRun lifecycle DomainError 去重验证（2026-06-29，完成）

**条目**：T5 横切一致性 — BookRun 主生命周期错误由 `DomainError` 全局 handler 接管

**目标**：BookRun 主生命周期服务错误已经具备领域异常基类，删除 router 中重复的 404/422/400 `HTTPException` 映射，保留外部 HTTP 契约。

**已完成模块**：
1. `app/domains/book_runs/router.py`
   - `create/get/start/resume/pause/stop/retry/workflow-dispatch/progress` 端点删除重复 try/except。
   - `BookRunError` 继续通过 `InputError` 返回 400。
   - `BookRunNotFoundError` 继续通过 `NotFoundError` 返回 404。
   - `BookRunBlockedError.status_code = 422` 保留已存在契约，继续返回 422。

**硬约束检查**：
- `BookRunBlockedError` 仍为 422；缺 LLM 配置、非法状态、Blueprint 未锁定等主生命周期阻塞不降为 400。
- IDE command registry 仍捕获 `BookRunError` / `BookRunBlockedError` / `BookRunNotFoundError` 并包装为 `IdeCommandExecutionError`，所以 `/api/ide/commands/bookrun.*` 的错误仍按 IDE command 契约返回 400。
- BookRun export endpoints 未动；`ArtifactForbiddenError` 和 `BookExportError` 的 403/404/400 分类留后续单独评审。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/book_runs/router.py app/domains/book_runs/service.py tests/test_book_runs.py tests/test_book_run_start.py tests/test_ide_commands.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_book_runs.py tests/test_book_run_start.py tests/test_ide_commands.py -q` → **38 passed**
- `cd apps/api && uv run python -c "import app.main; from app.domains.book_runs.service import BookRunBlockedError; print('import ok', BookRunBlockedError.status_code)"` → Import OK / `422`

**行为变更**：false。外部 HTTP response contract 不变；router 删除重复异常映射。

**影响**：BookRun lifecycle 的 status mapping 回到领域异常 interface，主 router 更接近 thin transport layer。导出错误分类仍需独立处理。

## T5 Artifact/Export ForbiddenError 收口验证（2026-06-29，完成）

**条目**：T5 横切一致性 — Artifact/Export/BookRun export 的 403/404/400 映射收口到领域异常

**目标**：消除制品与导出端点中重复的 router 403/404/400 映射和 BookRun export 的字符串判 404，让作用域拒绝和导出对象缺失由领域异常自身携带 HTTP status。

**已完成模块**：
1. `app/common/exceptions.py`
   - 新增 `ForbiddenError(status_code = 403)`。
2. `app/domains/artifacts/service.py`
   - `ArtifactNotFoundError` 派生 `NotFoundError` + `ArtifactError`。
   - `ArtifactForbiddenError` 派生 `ForbiddenError` + `ArtifactError`。
3. `app/domains/exports/service.py`
   - `ExportForbiddenError` 派生 `ForbiddenError`，保留 `NotFoundError` 多继承兼容旧捕获面。
4. `app/domains/exports/book_markdown_exporter.py`
   - 新增 `BookExportNotFoundError(NotFoundError, BookExportError)`，替代 router 对 `"BookRun 不存在"` 的字符串判断。
5. Routers
   - `artifacts/router.py`、`exports/router.py`、`book_runs/router.py` export endpoints、`ide/router.py` artifact preview / run-events 删除对应重复 try/except。

**硬约束检查**：
- Artifact detail/download 错工作区仍 403，缺失制品仍 404，创建输入错误仍 400。
- Book export 错工作区仍 403，缺失作品/无可导出正文仍 404。
- BookRun export 错工作区仍 403，缺失 BookRun 仍 404，未完成 BookRun 仍 400。
- IDE artifact preview 错工作区仍 403，缺失 artifact 仍 404；IDE run events 缺失 BookRun 仍 404。

**本地验证**：
- `cd apps/api && uv run ruff check app/common/exceptions.py app/domains/artifacts/service.py app/domains/artifacts/router.py app/domains/exports/service.py app/domains/exports/router.py app/domains/exports/book_markdown_exporter.py app/domains/book_runs/router.py app/domains/ide/router.py tests/test_artifacts.py tests/test_exports.py tests/test_book_exporter.py tests/test_ide_artifact_preview.py tests/test_ide_run_events.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_artifacts.py tests/test_exports.py tests/test_book_exporter.py tests/test_ide_artifact_preview.py tests/test_ide_run_events.py -q` → **25 passed**
- `cd apps/api && uv run python -c "import app.main; from app.common.exceptions import ForbiddenError; from app.domains.artifacts.service import ArtifactForbiddenError; print('import ok', ForbiddenError.status_code, ArtifactForbiddenError.status_code)"` → Import OK / `403 403`

**行为变更**：false。外部 HTTP response contract 不变；router 删除重复异常映射和 fragile string-status branching.

**影响**：403/404/400 的 ownership 进一步回到 domain exception interface，Artifact/Export/BookRun export routers become thinner transport adapters.

## T5 BookGeneration error status contract 验证（2026-06-29，完成）

**条目**：T5 横切一致性 — BookGeneration 错误接入 `DomainError` status contract

**目标**：让真实 LLM 生成错误具备统一领域错误 status，同时保留 CLI、assistant 和测试依赖的 `RuntimeError` 捕获面。

**已完成模块**：
1. `app/domains/book_runs/errors.py`
   - `BookGenerationPreflightError` 改为多继承 `DomainError` / `RuntimeError`，显式 `status_code = 422`。
   - `BookGenerationError` 改为多继承 `DomainError` / `RuntimeError`，显式 `status_code = 502`。

**硬约束检查**：
- assistant revise 仍捕获 `BookGenerationError` 后包装为 `AssistantReviseError`，外部继续 502。
- CLI/preflight tests 仍通过；`isinstance(BookGenerationError("x"), RuntimeError)` 为真。
- 本刀不合并 judge LLM client，避免改变 `STORYFORGE_JUDGE_LLM_*` fallback 与 `httpx` monkeypatch 契约。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/book_runs/errors.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_llm.py app/domains/assistant/service.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_assistant_revise.py tests/test_ide_agent_orchestrator.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_assistant_revise.py tests/test_ide_agent_orchestrator.py -q` → **77 passed**
- `cd apps/api && uv run python -c "from app.domains.book_runs.errors import BookGenerationError, BookGenerationPreflightError; print('ok', BookGenerationError.status_code, BookGenerationPreflightError.status_code, isinstance(BookGenerationError('x'), RuntimeError))"` → `ok 502 422 True`

**行为变更**：false for existing call/catch sites. The exception interface is deeper: future HTTP surfaces can rely on the shared `DomainError` handler without local status mapping.

**影响**：T5 reaches current reasonable boundary. LLM leaf utilities and the highest-friction cross-domain error surfaces now have clear locality; remaining router mappings are broader legacy cleanup rather than this master-plan P1 item.

## T5/T6 宽回归验证（2026-06-29）

**条目**：T5 错误模型收口 + T6 当前护栏地图校准后的宽回归

**本地验证**：
- `cd apps/api && uv run ruff check app/common/exceptions.py app/domains/assistant/service.py app/domains/assistant/router.py app/domains/ide/command_registry.py app/domains/ide/router.py app/domains/ide/orchestrator.py app/domains/agent_runs/router.py app/domains/book_runs/router.py app/domains/book_runs/errors.py app/domains/artifacts/service.py app/domains/artifacts/router.py app/domains/exports/service.py app/domains/exports/router.py app/domains/exports/book_markdown_exporter.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py tests/test_ide_commands.py tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_book_runs.py tests/test_book_run_start.py tests/test_artifacts.py tests/test_exports.py tests/test_book_exporter.py tests/test_ide_artifact_preview.py tests/test_ide_run_events.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_assistant_revise.py tests/test_assistant_provider_health.py tests/test_ide_commands.py tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_book_runs.py tests/test_book_run_start.py tests/test_artifacts.py tests/test_exports.py tests/test_book_exporter.py tests/test_ide_artifact_preview.py tests/test_ide_run_events.py -q` → **138 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `git diff --check -- <T5 touched files + docs>` → 通过

**结论**：T5 到当前合理边界完成；T6 护栏地图已校准为完成当前合理边界。后续若继续清理 legacy router 映射，应按域独立做小刀，不再阻塞本轮总重构目标。

## T4 generated contract consumption 验证（2026-06-29，完成当前合理边界）

**条目**：T4 共享契约一致性 — Desktop API client 开始消费 generated OpenAPI types（零运行时行为变更）

**目标**：解决 `packages/shared/src/generated/api-types.ts` 全仓零消费的问题，明确 T4 方向为“消费 generated types”，而不是下线生成管线。本轮先接入 Desktop API client 最常用且测试充分的 DTO：assistant revise、provider health、Agent role catalog。

**已完成模块**：
1. `apps/desktop/frontend/src/lib/api/contracts.ts`
   - type-only 引入 `packages/shared/src/generated/api-types.ts` 的 `components`。
   - 新增 `ApiAssistantReviseRequest`、`ApiAssistantReviseResponse`、`ApiAssistantContextBundle`、`ApiProviderHealthResponse`、`ApiAgentRoleRead`。
2. `apps/desktop/frontend/src/lib/api/types.ts`
   - `AssistantContextBundlePayload` 改为 generated-backed contract alias。
3. `apps/desktop/frontend/src/lib/api/assistant.ts`
   - `requestRevision()` 的 backend body 与 response decode 改用 generated-backed DTO type；UI-facing `ReviseRequest` / `ReviseResult` camelCase surface 不变。
   - `probeProviderHealth()` response decode 改用 generated-backed DTO type；optional generated fields 在 camelCase boundary 归一为 `null` / `[]`。
4. `apps/desktop/frontend/src/lib/provider-config.ts`
   - `ProviderHealthStatus` 改为 generated-backed `ProviderHealthResponse['status']`。
5. `apps/desktop/frontend/src/lib/agent-roles.ts`
   - `AgentRoleRead` 改为 generated-backed `ApiAgentRoleRead`。
6. `packages/shared/src/generated/api-types.ts`
   - 使用本地 `openapi-typescript` 从 checked-in OpenAPI JSON 再生成，补上此前缺失的 `ProviderHealthResponse` 与 `AssistantContextBundle.budget`。

**硬约束检查**：
- `requestRevision()` 发出的 JSON body 未变，现有 `api-client.test.ts` payload golden 继续通过。
- `AssistantContextBundlePayload.budget` 继续以 snake_case 发送；再生成后的 generated schema 已包含 permissive `budget?: Record<string, unknown> | null`。
- 本刀不引入 `@storyforge/shared` runtime dependency；使用 type-only relative import，当前 Vite/tsc 不产生运行时 bundle 变化。
- Agent role alias/mention behavior不变；只是把 API DTO 类型从手写结构切到 generated schema。

**本地验证**：
- `packages/shared/node_modules/.bin/openapi-typescript.cmd packages/shared/src/contracts/storyforge.openapi.json -o packages/shared/src/generated/api-types.ts` → 通过，generated TS +71 行
- `packages/shared/node_modules/.bin/tsc.cmd --noEmit -p packages/shared/tsconfig.json` → 通过
- `cd apps/desktop/frontend && npm run typecheck` → 通过
- `cd apps/desktop/frontend && npm run test -- agent-roles api-client provider-config` → **16 passed**
- `cd apps/desktop/frontend && npm run test` → **62 passed**（保留既有 Editor SSR `useLayoutEffect` warning，未阻断）
- `git diff --check -- apps/desktop/frontend/src/lib/api/contracts.ts apps/desktop/frontend/src/lib/api/types.ts apps/desktop/frontend/src/lib/api/assistant.ts docs/internal/refactor-master-plan.md .codex/verification-report.md` → 通过

**工具链备注**：
- `pnpm --filter @storyforge/shared generate:types` / `pnpm --filter @storyforge/shared test` 仍会触发 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，pnpm 试图执行 install 并因非 TTY module purge guard 中止。已改用 package-local bin 执行 generate/tsc，未强行改动依赖安装状态。

**行为变更**：false。仅 type-level contract consumption；Desktop API client runtime payload、response mapping、error handling 和 tests 均保持旧语义。

## Pi/OpenCode Agent Harness adoption plan 校准验证（2026-06-29）

**条目**：主重构收口后，更新 `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`，为下一线程进入阶段 2 Context Builder 做交接。

**已完成内容**：
- 将最近校准状态更新为：refactor master E2/T5/T6 已完成当前合理边界；Root Agent 已承接 supported intents；`ide/orchestrator.py` 只保留旧路径兼容 facade。
- 在「已落地」表中补充 Root Agent supported intents、legacy IDE orchestrator facade、DomainError status contract 收口事实。
- 删除旧的 E2 blocker 叙述，改为「与已完成主重构 / E2 的关系」；明确 `chapter.review` / `chapter.repair` 已迁入 live `AgentRuntime`，`legacy.orchestrator` fallback 已下线。
- 更新实施顺序：C-c 标记为已完成；下一实现线程首刀改为 阶段 2 Context Builder。
- 新增「实现线程交接（首刀）」：第一刀做可审计 LLM context snapshot builder，先覆盖 `file.review` / `file.revise` 的 context bundle 转换测试，不先改变 provider 调用策略。

**本地验证**：
- `rg -n "E2|legacy|fallback|Root Agent|C-c|_judge_run_args_from_scene_packet|阶段 2|Context Builder|blocker|不成立|仍走|迁移半成品|orchestrator" docs/architecture/pi-opencode-agent-harness-adoption-plan.md` → 无陈旧「E2 未完成 / Root Agent 不成立 / 仍走 legacy」断言；仅保留已完成关系和 facade 描述。
- `git diff --check -- docs/architecture/pi-opencode-agent-harness-adoption-plan.md docs/internal/refactor-master-plan.md .codex/verification-report.md` → 通过。
- `rg -n "\s+$" docs/architecture/pi-opencode-agent-harness-adoption-plan.md` → 无行尾空白。

**行为变更**：false。文档校准与下一线程交接，无代码改动。

## 阶段 2 Context Builder tracer-bullet MVP 验证（2026-06-29，首刀）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 2 · Context Transform / LLM Context Builder

**目标**：新增一个纯、可测试、可审计的 LLM context snapshot builder，先覆盖 `file.review` / `file.revise` 的 `context_bundle` 转换路径；本刀只生成 snapshot 与摘要，不改变 tool 选择、artifact schema、权限模型或 provider 调用策略。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/llm_context.py`
   - 新增 `build_llm_context_snapshot()`，输入 AgentRun 状态、intent、用户目标、selected file/content、`context_bundle`、role hints、review report、artifacts/event history，输出稳定 `llm_context_snapshot`。
   - 默认排除 timeline 原始事件、permission payload、UI debug JSON、patch metadata、debug/patch/permission 类上下文文件；只以白名单摘要带入 project、selected file、context files、review report、story memory 和 chapter context。
   - 新增 `llm_context_snapshot_trace_summary()`，供运行时 trace 记录轻量统计与 `snapshot_id`。
2. `apps/api/app/domains/agent_runs/runtime.py`
   - `context.load` 生成 `llm_context_snapshot` 并在 `output_summary.llm_context` 记录轻量摘要。
   - `file.revise` trace input summary 引用 `llm_context_snapshot_id`；真实 `assistant_service.revise_file_content()` 仍接收旧 `context_bundle`，不把 snapshot 接入 prompt。
   - `file.review` 仍使用现有 `context_bundle` 审稿路径；本刀不改变 review reasoner/provider 调用策略。
3. `apps/api/tests/test_agent_llm_context.py`
   - 覆盖同输入生成稳定 snapshot。
   - 覆盖 permission/debug/timeline/patch JSON 不进入 LLM context。
   - 覆盖 selected file、role hints、章节上下文、story memory、review report 摘要保留。
   - 覆盖旧 `context_bundle` 缺失或 `files` 字段畸形时保守降级。
   - 覆盖 `file.review` 运行时 `context.load` trace 生成 snapshot 摘要，以及 `file.revise` trace 关联同一个 `llm_context_snapshot_id`。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除；`AgentRuntime` 旧调用面仍通过 `test_agent_runs.py` 与 `test_ide_agent_orchestrator.py`。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 本刀未修改 ToolDefinition schema、PermissionGate 行为、AgentArtifact schema 或真实 provider 调用策略。

**本地验证**：
- `cd apps/api && uv run pytest tests/test_agent_llm_context.py -q` → **6 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **63 passed**
- `cd apps/api && uv run ruff check app/domains/agent_runs/llm_context.py app/domains/agent_runs/runtime.py tests/test_agent_llm_context.py` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `git diff --check -- apps/api/app/domains/agent_runs/llm_context.py apps/api/app/domains/agent_runs/runtime.py apps/api/tests/test_agent_llm_context.py .codex/verification-report.md` → 通过

**行为变更**：false for prompt/provider/tool selection. Agent runtime now records an auditable LLM context snapshot summary during `context.load`, but the actual `file.review` and `file.revise` inputs remain on the existing `context_bundle` path. Snapshot-to-prompt wiring is intentionally left for a later golden-guarded slice.

## 阶段 2 Context Builder prompt 接线验证（2026-06-29，第二刀）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 2 · Context Transform / LLM Context Builder，snapshot → prompt context 接线

**目标**：在首刀可审计 snapshot 基础上，把 `file.review` / `file.revise` 的真实 LLM prompt 上下文切到由 snapshot 派生的干净 `context_bundle`，避免 permission/debug/timeline/patch metadata 噪声进入模型；不改变 tool 选择、artifact schema、权限模型或 provider 调用策略。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/llm_context.py`
   - 新增 `llm_context_snapshot_to_prompt_context_bundle()`，把 snapshot 转回当前 review/revise prompt 已支持的 legacy `context_bundle.files` 形状。
   - 保留真实 context files，同时把 Story Memory 与 Chapter Context 作为合成上下文文件摘要注入 prompt；selected file 仍走正文输入，不作为上下文文件重复注入。
   - 输出 bundle 只由 snapshot 白名单字段生成，不携带 timeline 原始事件、permission payload、UI debug JSON、patch metadata 或 debug 文件摘录。
2. `apps/api/app/domains/agent_runs/runtime.py`
   - `context.load` 同时生成 `llm_context_snapshot` 与 `llm_prompt_context_bundle`。
   - `file.review` 优先使用 `llm_prompt_context_bundle` 调用 review reasoner；`file.revise` 优先使用同一干净 bundle 构造 `AssistantReviseRequest`。
   - 保留原始 `context_bundle` 作为 snapshot 输入与审计来源；不改 `ToolDefinition`、`PermissionGate`、AgentArtifact 或 provider gateway。
3. `apps/api/tests/test_agent_llm_context.py`
   - 新增 prompt bundle 纯转换测试，锁定 safe files + Story Memory + Chapter Context，以及 RAW 噪声不出现。
   - 新增 `file.review` LLM prompt 行为测试，确认真实 review prompt 包含干净上下文且排除 permission/debug/timeline/patch 噪声。
   - 扩展 `file.revise` runtime 测试，确认 revise prompt 排除 selected-file 重复上下文和 debug timeline/permission payload，同时 trace 仍关联 `llm_context_snapshot_id`。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除；`test_agent_runs.py`、`test_ide_agent_orchestrator.py` 与 `test_assistant_revise.py` 组合回归通过。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 本刀不改变 provider 调用入口、模型配置解析、权限确认模型或 proposed patch artifact schema；变化只在进入 prompt 的上下文净化层。

**本地验证**：
- `cd apps/api && uv run pytest tests/test_agent_llm_context.py -q` → **8 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_assistant_revise.py -q` → **70 passed**
- `cd apps/api && uv run ruff check app/domains/agent_runs/llm_context.py app/domains/agent_runs/runtime.py tests/test_agent_llm_context.py` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → Import OK
- `git diff --check -- apps/api/app/domains/agent_runs/llm_context.py apps/api/app/domains/agent_runs/runtime.py apps/api/tests/test_agent_llm_context.py .codex/verification-report.md` → 通过

**行为变更**：true, intentionally scoped to prompt context sanitization. `file.review` / `file.revise` now receive context derived from the audited snapshot instead of raw Desktop `context_bundle.files`; tool sequence, provider adapter, permission gate, artifact schema, direct `/api/assistant/revise` contract and proposed patch confirmation behavior remain unchanged.

## 阶段 1 C-a AgentRun event type 常量收敛验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — C-a. event type 字面量 → enum/常量 + reducer 兼容旧名

**目标**：在不引入 turn/message_delta/tool lifecycle 新协议的前提下，把当前已存在的 AgentRun 事件名集中定义，保持 REST/SSE/WebSocket 对外字符串值不变，并保留旧控制消息到事件名的兼容 reducer。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/event_types.py`
   - 新增当前既有 AgentRun event type 常量：`agent_run_started`、`agent_plan_created`、`subagent_started`、`subagent_completed`、`tool_trace`、`permission_required`、`agent_artifact`、`agent_run_completed`、`agent_run_failed`、`system_job`。
   - 新增控制事件常量：`permission_approved`、`permission_denied`、`pause_run`、`resume_run`、`stop_run`、`retry_from_checkpoint`。
   - 新增控制消息常量与 `event_type_for_control_message()`，保留 `approve_permission -> permission_approved`、`deny_permission -> permission_denied`，其他旧控制消息按原值透传。
2. `apps/api/app/domains/agent_runs/service.py`、`event_sink.py`、`event_encoders.py`、`run_payloads.py`
   - 内部事件写入和 WebSocket started/control 编码改用集中常量。
   - `run_payloads._control_event_type()` 继续保留为旧 facade，调用新的兼容 reducer。
3. `apps/api/app/domains/ide/router.py`
   - 轻量 stream 投影中的 `tool_trace` / `permission_required` 和控制消息集合改用集中常量；`agent_step`、`agent_result`、`error` 等非 AgentRun event store 投影暂不扩大。
4. `apps/api/tests/test_agent_runs.py`
   - 新增常量值与控制消息 reducer 测试，明确本刀不夹带 `turn_started` / `message_delta`。
   - 既有 SSE、WebSocket、AgentRun event store 测试继续覆盖外部协议字符串不变。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除；`service.py` 仍 re-export 既有 encoder/sink/run_payload helper，`_control_event_type()` 仍可从旧路径使用。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 turn/message_delta/tool_execution_* 事件；未改变事件 payload、事件顺序、权限模型、artifact schema 或 provider 调用策略。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/event_types.py app/domains/agent_runs/event_encoders.py app/domains/agent_runs/event_sink.py app/domains/agent_runs/run_payloads.py app/domains/agent_runs/service.py app/domains/ide/router.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **34 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_agent_llm_context.py -q` → **42 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py -q` → **79 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`

**行为变更**：false。对外 AgentRun event type 字符串、控制消息 ack、SSE/WebSocket payload、事件 store 顺序和状态机语义保持旧行为；本刀只收敛后端命名来源和兼容 reducer。

## C-b AgentRuntime / runtime-tools registry 收敛验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — C-b. 收敛两个互不相连的 tool registry：`agent_runs/tooling.py` 可执行 registry vs `runtime_tools` 描述性 registry

**目标**：把当前 AgentRuntime 真正可执行的工具从 `runtime.py` 字面量注册收敛到一份可复用的 agent runtime tool spec；`/api/runtime-tools` 读侧复用同一份 spec 暴露 `origin=agent_runtime` 条目。第一刀不改 handler、tool choice、permission gate、artifact schema 或写工具 propose-then-confirm 模型。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/tooling.py`
   - 新增 `AgentRuntimeToolSpec` / `ToolCatalogReferences` 与 `list_agent_runtime_tool_specs()`。
   - 当前 9 个可执行 AgentRuntime 工具统一登记：`context.load`、`file.review`、`file.revise`、`judge.run`、`judge.repair`、`bookrun.start`、`bookrun.pause`、`bookrun.resume`、`bookrun.retry_from_checkpoint`。
   - 新增 `tool_definition_from_spec()`，从静态 spec 生成执行期 `ToolDefinition`。
   - `ToolRegistry.all()` 只读返回注册结果，供测试校验可执行 registry 与 spec 对齐。
2. `apps/api/app/domains/agent_runs/runtime.py`
   - `_register_tools()` 改为从 `list_agent_runtime_tool_specs()` 注册；handler 仍绑定原 `_context_load`、`_file_review`、`_file_revise`、`_judge_run` 与现有 IDE command wrapper。
   - 现有 permission gate 逻辑保持：`file.revise` / `judge.repair` / `bookrun.start` 仍是 propose-then-confirm，不迁入硬 preflight 阻断。
3. `apps/api/app/domains/runtime_tools/service.py`
   - `/api/runtime-tools` 聚合新增 `origin=agent_runtime` 的 9 个可执行 AgentRuntime 工具条目。
   - 既有 CreativeToolRegistry 与 MCP 只读工具继续保留原 origin 与字段。
4. `apps/api/app/domains/runtime_tools/router.py`、`schemas.py`
   - 文档描述从单一 CreativeToolRegistry 更新为 AgentRuntime / CreativeToolRegistry / MCP 聚合。
5. `apps/api/tests/test_runtime_tools.py`
   - 覆盖 `/api/runtime-tools` 包含 agent_runtime 工具，且顺序和值来自 `list_agent_runtime_tool_specs()`。
   - 覆盖执行期 `AgentRuntime._tool_registry` 注册结果与 spec 完全一致。
   - 保留 CreativeToolRegistry 与 MCP 工具契约断言。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除；`ToolDefinition` 字段和调用方式保持兼容。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `ToolDefinition.allowed_roles` / `retry_safe` / `idempotent` 等阶段 3 字段；未改变写工具确认模型、权限策略、事件 payload 或 provider 调用策略。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/tooling.py app/domains/agent_runs/runtime.py app/domains/runtime_tools/service.py app/domains/runtime_tools/router.py app/domains/runtime_tools/schemas.py tests/test_runtime_tools.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_runtime_tools.py tests/test_agent_runs.py tests/test_model_runs.py -q` → **51 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **96 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`

**行为变更**：true, additive read-side only. `/api/runtime-tools` now includes 9 `origin=agent_runtime` entries derived from the executable AgentRuntime tool spec; AgentRuntime execution handlers, permission gate behavior, proposed patch confirmation, artifact schema, model/provider calls, and existing CreativeToolRegistry/MCP entries remain unchanged.

## 阶段 3 Tool Preflight 字段补齐验证（2026-06-29，零行为切片）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 3 · Tool Preflight / Permission Gate 收口，先做 `ToolDefinition` 扩展字段，不迁移写工具权限模型。

**目标**：在 C-b 共享 agent runtime tool spec 基础上，补齐目标模型要求的 preflight 元数据字段：`allowed_roles`、`retry_safe`、`idempotent`、`execution_mode`、`artifact_kinds`。本刀只让字段成为可执行 registry 与 `/api/runtime-tools` 读侧的可审计事实，不把 `file.revise` / `judge.repair` / `bookrun.start` 改成硬 preflight 阻断。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/tooling.py`
   - `AgentRuntimeToolSpec` 与执行期 `ToolDefinition` 新增 `allowed_roles`、`retry_safe`、`idempotent`、`execution_mode`、`artifact_kinds`。
   - 为 9 个 AgentRuntime 工具登记保守 preflight 元数据：只读/分析工具标注可读角色；写入或长任务工具只开放 root/repair/bookrun 相关角色；provider/写入/长任务默认 `retry_safe=False`、`idempotent=False`。
   - `context.load` 标记为 `retry_safe=True`、`idempotent=True`；`bookrun.start` 标记为 `execution_mode=long_running`；控制命令标记为 `execution_mode=control`。
2. `apps/api/app/domains/runtime_tools/schemas.py`、`service.py`
   - `RuntimeToolRead` 新增同名字段，`/api/runtime-tools` 对 agent_runtime、CreativeToolRegistry internal、MCP 工具均返回完整字段。
   - MCP 只读工具标记 `risk_level=read`、`retry_safe=True`、`idempotent=True`、`execution_mode=mcp_readonly`。
   - CreativeToolRegistry internal 工具填保守默认：写/高成本工具 `requires_confirmation=True` 时风险归类为 `write_pending` 或 `high_cost`，其余保持 read-side 兼容。
3. `apps/api/tests/test_runtime_tools.py`
   - 覆盖 `/api/runtime-tools` 中 agent_runtime 工具的新字段值。
   - 覆盖执行期 `AgentRuntime._tool_registry` 注册结果与 spec 新字段完全一致。
   - 覆盖 `allowed_roles` 与现有 `role_catalog.allowed_tools` 投影一致，避免产生第二套角色权限事实源。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除；`ToolDefinition` 仍只由 `tool_definition_from_spec()` 构造，现有执行调用面不变。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 input schema 强校验、budget check、pending-call resume 或写工具硬阻断；`file.revise` / `judge.repair` / `bookrun.start` 仍保持 propose-then-confirm 行为。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/tooling.py app/domains/agent_runs/runtime.py app/domains/runtime_tools/service.py app/domains/runtime_tools/router.py app/domains/runtime_tools/schemas.py tests/test_runtime_tools.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_runtime_tools.py tests/test_agent_runs.py tests/test_model_runs.py -q` → **52 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **97 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`

**行为变更**：true, additive metadata only. `/api/runtime-tools` responses now include new preflight metadata fields; AgentRuntime execution, permission decisions, proposed patch confirmation, artifact schema, event payloads, and provider/model calls remain unchanged.

## 阶段 4 ToolResult / Artifact postprocess 管道第一刀验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 4 · Tool Postprocess / Artifact Pipeline，先收敛已有 review/proposed patch 归档逻辑。

**目标**：在不新增 artifact 类型、不改变前端响应 schema 的前提下，把 `ToolResult` 从 `status/output/trace` 扩展为可承载 `summary/payload/artifacts/metrics/retry_metadata/checkpoint_metadata` 的 postprocess 载体；现有 `review_report` / `proposed_patch` 归档优先从 ToolResult artifacts 进入 `AgentArtifact`，旧 result 字段继续作为 fallback。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/tooling.py`
   - 新增 `ToolArtifact(kind, payload, requires_confirmation)`。
   - `ToolResult` 新增 `summary`、`payload`、`artifacts`、`metrics`、`retry_metadata`、`checkpoint_metadata`，保留原 `status/output/trace` 兼容字段。
2. `apps/api/app/domains/agent_runs/runtime.py`
   - `_base_response()` 新增内部 `tool_artifacts` 参数，用 `_tool_artifacts` 暂存给后端 postprocess；`_record_result_artifacts()` 消费后会 `pop`，不会泄漏给 WebSocket/REST 最终响应。
   - `_record_result_artifacts()` 优先记录 ToolResult artifacts，并按 artifact kind 去重；旧 `agent_result.review_report`、top-level `proposed_patch`、`bookrun_checkpoint` 路径继续作为 fallback。
   - `file.review` ToolResult 填充 `review_report` artifact、summary、payload、metrics。
   - `file.revise` ToolResult 填充 `proposed_patch` artifact、summary、payload、metrics。
   - `judge.repair` IDE command wrapper 在返回 repair patch 时生成同等 `proposed_patch` ToolArtifact，供 `chapter.review` / `chapter.repair` 归档使用。
3. `apps/api/tests/test_agent_runs.py`
   - 新增 `file.review` ToolResult postprocess metadata 测试。
   - 新增 artifact postprocess 测试，证明 ToolResult artifacts 优先于旧 fallback，且 `_tool_artifacts` 内部字段会被移除。
   - 既有 file.review/file.revise/chapter repair artifact 行为回归继续通过。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除；`ToolResult.status/output/trace` 和现有 tool trace 结构保持兼容。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `diagnostic_summary` / `memory_update_proposal` / `export_manifest`，未改变 artifact schema、permission gate、provider/model 调用或 proposed patch 确认模型。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/tooling.py app/domains/agent_runs/runtime.py app/domains/runtime_tools/service.py app/domains/runtime_tools/router.py app/domains/runtime_tools/schemas.py tests/test_agent_runs.py tests/test_runtime_tools.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py -q` → **74 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **99 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`

**行为变更**：false for external API and runtime semantics. Artifact recording now prefers internal ToolResult artifacts, but WebSocket/REST result shape, `AgentArtifact` kinds/payloads, event order, permission behavior, provider/model calls, and proposed patch review flow remain unchanged.

## Pi/OpenCode Agent Harness adoption plan 当前状态校准（2026-06-29）

**条目**：更新 `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`，把阶段 2 / C-a / C-b / 阶段 3 字段 / 阶段 4 第一刀从“待做/缺口”校准为当前已完成边界，并明确下一刀交接。

**已完成内容**：
- 顶部最近校准更新为：阶段 2 Context Builder tracer/prompt 接线、C-a event type 常量、C-b registry 第一层收敛、阶段 3 preflight 元数据字段、阶段 4 ToolResult/postprocess 第一刀已完成。
- “已落地”表补充 `event_types.py`、`llm_context.py`、AgentRuntime shared tool spec、ToolResult artifacts postprocess 当前事实。
- 删除陈旧断言：不再说“今天无 Context Builder”、不再说 `ToolDefinition` 缺 `allowed_roles` / `retry_safe` / `idempotent`、不再说可执行 registry 与 runtime_tools 完全互不相连。
- 阶段 1/2/3/4 状态文字改为当前边界：阶段 1 低成本常量收敛完成但 turn/streaming 未做；阶段 2 snapshot + prompt 接线完成；阶段 3 字段完成但行为迁移未做；阶段 4 ToolResult artifacts 第一刀完成。
- 实施顺序更新为：Done 阶段 2、Done C-a/C-b、Done 阶段 3 字段、Done 阶段 4 第一刀；Next 阶段 5 Save Points。
- “实现线程交接”改为下一刀：建议先做只读 save point projection/helper，不立即改运行时为可中断/可恢复。

**本地验证**：
- `rg -n "今天仍无|今天无|下一实现线程首刀|首个实现切片|runtime.py:701-708|runtime.py:674-696|runtime.py:644-672" docs/architecture/pi-opencode-agent-harness-adoption-plan.md` → 无匹配
- `rg -n "两个互不相连|缺 \`allowed_roles|ToolResult\` 现为|Context Builder              ←" docs/architecture/pi-opencode-agent-harness-adoption-plan.md` → 无匹配
- `git diff --check -- docs/architecture/pi-opencode-agent-harness-adoption-plan.md .codex/verification-report.md` → 通过

**行为变更**：false。文档校准，无代码行为变化。

## 阶段 5 Save Point projection tracer-bullet 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Agent Harness Save Points，第一刀只读 projection/helper。

**目标**：先从现有 `AgentRun` / `AgentRunEvent` / `AgentArtifact` 推导当前 durable boundaries，不改 `AgentRuntime.run_user_message()` 的同步执行模型，不新增 turn/message_delta/provider stream 恢复。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/save_points.py`
   - 新增 `build_agent_run_save_point_projection()`，纯读侧投影当前可证明的 save point candidates。
   - 从事件推导：`run_started`、`tool_completed`（由既有 `tool_trace` 映射）、`permission_required`、`permission_decided`、`run_completed`、`run_failed`、`run_stopped`。
   - 从 artifact 推导：`artifact_persisted` 与 `bookrun_checkpoint`。
   - 输出 pending 摘要：pending permission、permission event id、blocked tool、proposed patch artifact id。
   - 输出 recoverability 摘要：是否可从 BookRun checkpoint retry、latest checkpoint artifact id、failed_without_checkpoint、terminal event id、resume strategy。
   - 明确当前 interruption model 只识别既有 `paused` / `stopped`，不制造 `interrupted` 事件。
2. `apps/api/app/domains/agent_runs/service.py`、`router.py`
   - 新增 `get_agent_run_save_points()` 只读 service facade。
   - 新增 `GET /api/agent-runs/{run_id}/save-points`，直接从现有事件/artifact 事实源投影，不替代 `/events` 或 SSE。
3. `apps/api/tests/test_agent_runs.py`
   - 覆盖 pending permission + proposed patch 可从事实源重建。
   - 覆盖 BookRun checkpoint 被识别为当前真实可恢复边界。
   - 覆盖 failed run 无 checkpoint 时不会被误判为 retry-safe。
   - 覆盖既有 `tool_trace` event 被映射为 `tool_completed` save point。
   - 覆盖 save-points REST endpoint 只读投影现有 event store，且不破坏 `/events` 回放。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未引入 turn/message_delta/tool_execution_* 新事件，未改变 WebSocket/SSE payload、权限模型、artifact schema、provider/model 调用或 proposed patch 确认模型。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/save_points.py app/domains/agent_runs/service.py app/domains/agent_runs/router.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run ruff check app/domains/agent_runs/save_points.py app/domains/agent_runs/tooling.py app/domains/agent_runs/runtime.py tests/test_agent_runs.py tests/test_runtime_tools.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **41 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **104 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`

**行为变更**：false。新增只读 projection helper 与测试，不改变运行时执行、事件写入、权限或外部 API 行为。

## 阶段 5 tool_trace recovery metadata 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Agent Harness Save Points，继续沿现有 `tool_trace` 事件承载 `tool_completed` save point 元数据。

**目标**：不新增 `tool_completed` event type、不提前改变 runtime 写事件顺序、不触碰写工具 propose-then-confirm 模型，只在现有 `tool_trace` payload 中追加可恢复投影所需的 recovery 元数据。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/event_sink.py`
   - `_AgentRunEventSink.record_tool_trace()` 仍写 `event_type=tool_trace`。
   - `payload` 新增 `recovery`：`kind=tool_completed`、`tool_name`、`status`、`index`。
   - 对已登记的 AgentRuntime tools，从 `list_agent_runtime_tool_specs()` 补充 `retry_safe`、`idempotent`、`execution_mode`、`artifact_kinds`；对 `subagent.*` 或未知工具保守只写基础字段。
2. `apps/api/app/domains/agent_runs/save_points.py`
   - `tool_trace` 投影为 `tool_completed` save point 时优先读取 `payload.recovery`。
   - 保留旧 trace payload fallback，兼容没有 recovery 字段的历史事件。
3. `apps/api/tests/test_agent_runs.py`
   - 扩展 `tool_trace -> tool_completed` 投影测试，锁定 recovery 元数据。
   - 新增 endpoint 回归，确认 `/save-points` 可投影 `context.load` 的 retry/idempotency/execution_mode 元数据。
   - 扩展 SSE 回放测试，确认不会出现 `event: tool_completed` 新事件名。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` event type；未改变 WebSocket/SSE 事件名、权限模型、artifact schema、provider/model 调用或 proposed patch 确认模型。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/event_sink.py app/domains/agent_runs/save_points.py app/domains/agent_runs/service.py app/domains/agent_runs/router.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **42 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **105 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`

**行为变更**：true, additive event payload metadata only. Existing event type remains `tool_trace`; SSE/REST/WebSocket event names and runtime execution semantics remain unchanged.

## 阶段 5 Runtime recovery marker tracer 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Agent Harness Save Points，继续做 runtime recovery tracer bullet 的第一层 marker/projection，不实现自动恢复。

**目标**：在不新增 event type、不新增 checkpoint 表、不改变 WebSocket/SSE/REST 事件名的前提下，把同步 run 已完成 tool 的 after-tool execution boundary 持久化到现有 `tool_trace.payload.recovery.execution_marker`，并让 `/save-points` 投影出 `runtime_recovery` 摘要。marker 只说明边界和 replay policy，不承诺 provider stream 恢复，也不自动重试非 retry-safe tool。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/runtime_recovery.py`
   - 新增纯 helper `build_tool_recovery_payload()` / `build_runtime_execution_marker()`。
   - `context.load` 这类 `retry_safe=True` 且 `idempotent=True` 的 completed tool 会标记 `replay_safe=True`、`resume_strategy=replay_from_tool_boundary`。
   - `file.review`、subagent 或未知策略 tool 保守标记 `manual_restart_required`。
2. `apps/api/app/domains/agent_runs/event_sink.py`
   - `_AgentRunEventSink.record_tool_trace()` 仍只写 `event_type=tool_trace`。
   - recovery payload 构建改为复用纯 helper，追加 `execution_marker`，旧 `kind/tool_name/status/index/retry_safe/idempotent/execution_mode/artifact_kinds` 字段保持。
3. `apps/api/app/domains/agent_runs/save_points.py`
   - `tool_completed` save point summary 会投影 `execution_marker`。
   - 顶层新增 `runtime_recovery`：`latest_execution_marker`、`latest_replay_safe_marker`、`automatic_resume_supported=false`、`manual_restart_required`。
   - 失败且无 `bookrun_checkpoint` 时仍保持 `recoverability.resume_strategy=manual_restart_required`。
4. `apps/api/tests/test_agent_runs.py`
   - 覆盖 recovery helper 稳定输出。
   - 覆盖 `tool_trace -> tool_completed` save point 携带 execution marker。
   - 覆盖实际 `file.review` WebSocket/REST 路径投影 marker 且不新增 `tool_completed` 事件名。
   - 覆盖 failed run 即使存在 replay-safe runtime marker、没有 checkpoint 时仍要求 manual restart。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；未改变 WebSocket/SSE 事件名、权限模型、artifact schema、provider/model 调用或 proposed patch 确认模型。
- `automatic_resume_supported=false`，本刀不提供自动恢复入口。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime_recovery.py app/domains/agent_runs/event_sink.py app/domains/agent_runs/save_points.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **44 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **107 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/event_sink.py apps/api/app/domains/agent_runs/save_points.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive event payload/projection metadata only. Existing event type remains `tool_trace`; SSE/REST/WebSocket event names, runtime execution order, permission decisions, artifact schema, provider/model calls, and proposed patch review flow remain unchanged.

## 阶段 5 interruptible boundary tracer 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Agent Harness Save Points，`file.review` 首个可中断运行边界。

**目标**：在不新增 `run_interrupted` / `tool_completed` / `turn_*` 事件、不新增状态或 checkpoint 表的前提下，让无写入的 `file.review` 不再完全“一次同步跑到底”：先持久化 plan，再执行并持久化 `context.load`，随后检查现有 `paused` / `stopped` run 状态；若控制事件已到达，则停止继续 reviewer，不写 artifact，不 complete。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/runtime.py`
   - `file.review` 改走 `_run_file_review_interruptible()` 增量路径。
   - 增量路径顺序为：`record_plan` → `context.load` → `record_tool_trace(context.load)` → 检查 `runtime_interruption` → reviewer/subagent → postprocess。
   - 中断结果返回 `runtime_interruption` 与 `agent_result.runtime_interrupted=true`，但内部 `_events_recorded` / `_runtime_interrupted` 不泄漏给外部响应。
   - 中断后跳过 artifact postprocess、hidden system jobs 和 `agent_run_completed`，避免污染 durable boundary。
2. `apps/api/app/domains/agent_runs/event_sink.py`
   - `_AgentRunEventSink.runtime_interruption()` 刷新当前 `AgentRun` 并把现有 `paused` / `stopped` 投影为 runtime interruption。
   - 继续复用现有 `pause_run` / `stop_run` 控制事件与 `AgentRun.status`，未新增 `interrupted` 状态。
3. `apps/api/app/domains/agent_runs/runtime_recovery.py`
   - 新增 `build_runtime_interruption_payload()`，将 `paused` / `stopped` 转成可审计 payload。
   - `stopped` 投影为 `resume_strategy=stopped_by_user`；`paused` 投影为 `await_resume`；`automatic_resume_supported=false`。
4. `apps/api/app/domains/agent_runs/save_points.py`
   - `runtime_recovery` 新增 `latest_interruption`，可从既有 `pause_run` / `stop_run` 事件恢复最近中断边界。
5. `apps/api/tests/test_agent_runs.py`
   - 新增 `test_file_review_runtime_stops_at_context_boundary_when_control_event_arrives`。
   - 测试用真实 `_AgentRunEventSink` 派生类模拟 `context.load` 后到达 `stop_run`：reviewer sentinel 不会被调用；事件流停在 `agent_plan_created` / `tool_trace` / `stop_run`；没有 `subagent_started`、`agent_artifact`、`agent_run_completed`；`/save-points` 可投影 latest execution marker 与 latest interruption。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；未改变 WebSocket/SSE 事件名、权限模型、artifact schema、provider/model 调用或 proposed patch 确认模型。
- 本刀不提供 pending-call resume，不自动重放 provider request，不碰 `file.revise` / `judge.repair` / `bookrun.start` 写工具确认模型。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime.py app/domains/agent_runs/runtime_recovery.py app/domains/agent_runs/event_sink.py app/domains/agent_runs/save_points.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **45 passed**
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **63 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **108 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/event_sink.py apps/api/app/domains/agent_runs/save_points.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive interruptibility for read-only `file.review`. Normal completed `file.review` response/events remain compatible; interrupted runs now stop at the first durable boundary using existing `stop_run` / `pause_run` facts instead of completing after a user stop.

## 阶段 5 pending-call resume tracer 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Agent Harness Save Points，`file.review` 无写入 pending-call resume 第一刀。

**目标**：继续沿 `AgentRunEvent` / `AgentArtifact` 事实源推进 runtime recovery：当 `file.review` 在 `context.load` 后被 `pause_run` 中断时，记录隐藏 `runtime_pending_call` artifact 保存最小续跑上下文；收到 `resume_run` 后，同一个 `file.review` run 可从该 artifact 继续 reviewer，不重复执行 `context.load`。本刀不碰 `file.revise` / `judge.repair` / `bookrun.start` 写工具确认模型，不承诺 provider stream 恢复。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/runtime_recovery.py`
   - 新增 `RUNTIME_PENDING_CALL_ARTIFACT_KIND = "runtime_pending_call"`。
2. `apps/api/app/domains/agent_runs/system_jobs.py`
   - 将 `runtime_pending_call` 加入 `HIDDEN_SYSTEM_ARTIFACT_KINDS`，避免普通 `/artifacts` 列表暴露 runtime 内部续跑上下文。
3. `apps/api/app/domains/agent_runs/runtime.py`
   - `file.review` 在 `paused` interruption 边界记录隐藏 pending-call artifact，包含 `context_output`、`context_trace`、`boundary` 与 `resume_strategy=continue_after_context_load`。
   - 当 run 已 `resume_run` 且 `current_step=resumed`，`file.review` 可从最新 pending-call artifact 继续 reviewer/subagent，不再重跑 `context.load`。
   - 完成后正常归档 `review_report` 并写 `agent_run_completed`；外部响应标记 `agent_result.resumed_from_pending_call=true`。
4. `apps/api/app/domains/agent_runs/event_sink.py`
   - 新增 `record_runtime_pending_call()`，通过既有 `record_agent_artifact()` 写入隐藏 artifact，仍产生可回放 `agent_artifact` 事件。
5. `apps/api/app/domains/agent_runs/service.py`
   - `/artifacts` 仍过滤隐藏 runtime pending artifact。
   - `/save-points` 使用 `_list_agent_save_point_artifacts()` 额外纳入 `runtime_pending_call`，让恢复投影能看见 pending call。
6. `apps/api/app/domains/agent_runs/save_points.py`
   - `pending` 新增 `runtime_pending_call_artifact_id` 与 `runtime_pending_tool`。
   - `runtime_recovery` 新增 `latest_pending_call`。
   - run 完成后不再把历史 pending-call artifact 作为活跃 pending 投影。
7. `apps/api/tests/test_agent_runs.py`
   - 新增 `test_file_review_runtime_resumes_from_pending_context_boundary`。
   - 覆盖 pause 后普通 artifacts 为空、`/save-points` 可见 pending call、resume 后继续 reviewer、不重复 `context.load`、最终只有 visible `review_report` artifact、run completed 后 pending projection 清空。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；未改变 WebSocket/SSE 事件名、权限模型、可见 artifact schema、provider/model 调用或 proposed patch 确认模型。
- 本刀仅覆盖无写入 `file.review` pending resume，不自动重放 provider request，不泛化到写工具。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime.py app/domains/agent_runs/runtime_recovery.py app/domains/agent_runs/event_sink.py app/domains/agent_runs/save_points.py app/domains/agent_runs/service.py app/domains/agent_runs/system_jobs.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **46 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **109 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/event_sink.py apps/api/app/domains/agent_runs/save_points.py apps/api/app/domains/agent_runs/service.py apps/api/app/domains/agent_runs/system_jobs.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive resume behavior for read-only `file.review` after a `pause_run` at the `context.load` boundary. Normal completed `file.review` remains compatible; paused runs now have a hidden durable pending-call artifact and can continue reviewer execution after `resume_run`.

## 阶段 5 control-channel resume tracer 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Agent Harness Save Points，`resume_run` 控制通道直接驱动 pending `file.review` 续跑。

**目标**：把上一刀的 pending-call resume 从“resume 后再发同一个 user_message”推进到真正控制通道：WebSocket 收到 `resume_run` 时，先记录既有控制事件并把 run 置回 `running/resumed`，再查隐藏 `runtime_pending_call` artifact；若存在无写入 `file.review` pending call，则直接调用 live `AgentRuntime` 续跑，并把 `agent_result` 放入 control ack 的 `resumed_result`。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/runtime.py`
   - pending-call artifact 增加 `resume_message`，保存续跑所需的最小 user_message envelope（不把它做成新事实源）。
2. `apps/api/app/domains/agent_runs/service.py`
   - 新增 `AgentControlResult`。
   - 新增 `handle_agent_control_message()`，作为控制消息 facade：写入控制事件后，在 `resume_run` 时调用 `resume_agent_run_if_pending()`。
   - 新增 `resume_agent_run_if_pending()`，从隐藏 `runtime_pending_call` artifact 读取 `resume_message` 并复用 `execute_agent_user_message_run()` 继续同一个 run。
3. `apps/api/app/domains/ide/router.py`
   - WebSocket 控制消息改用 `handle_agent_control_message()`。
   - `resume_run` ack 在存在续跑结果时追加 `resumed_result`，不改变原有 `type/status/run_id/event_id` ack 字段。
4. `apps/api/tests/test_agent_runs.py`
   - 新增 `test_resume_run_control_message_drives_pending_file_review_resume`。
   - 测试通过真实 `record_agent_control_event()` 制造 `pause_run` 边界，再经 WebSocket `resume_run` 自动续跑；断言 ack 携带 `resumed_result`，最终事件流只出现一次 `context.load`，并完成 `review_report` artifact。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；未改变 SSE 事件名、权限模型、可见 artifact schema、provider/model 调用或 proposed patch 确认模型。
- 本刀仅覆盖无写入 `file.review` control-channel resume，不自动重放 provider request，不泛化到写工具。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/service.py app/domains/ide/router.py app/domains/agent_runs/runtime.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **47 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **110 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/service.py apps/api/app/domains/ide/router.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive WebSocket control behavior. Existing control ack fields remain; `resume_run` may now include `resumed_result` when a read-only pending `file.review` call is recoverable from AgentArtifact facts.

## 阶段 5 postprocess resume tracer 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Agent Harness Save Points，`file.review` reviewer 已完成后的 postprocess 续跑。

**目标**：补齐 run loop recovery 的另一条无写入边界：当 `file.review` 已经完成 reviewer 计算，但只持久化了部分 subagent trace 时收到 `pause_run`，不应丢掉已计算结果，也不应 resume 后重跑 reviewer。应把 `review_output` 与 `next_trace_index` 写入隐藏 `runtime_pending_call` artifact，resume 后只补齐剩余 `tool_trace`、归档 `review_report` artifact 并 complete。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/runtime.py`
   - `_record_file_review_pending_call()` 支持 `review_output` 与 `next_trace_index`。
   - 新增 `_resume_file_review_postprocess_from_pending_call()`，从 pending artifact 继续剩余 trace 记录、artifact postprocess 和 run complete。
   - 新增 `_json_safe_review_output()`，确保 pending artifact 只保存 JSON-safe trace payload。
2. `apps/api/app/domains/agent_runs/save_points.py`
   - `latest_pending_call.pending_tool` 在非 `after_tool:context.load` 边界投影为 `file.review.postprocess`。
   - 投影 `next_trace_index`，帮助恢复端知道下一个待落库 trace 序号。
3. `apps/api/tests/test_agent_runs.py`
   - 新增 `test_file_review_resume_after_subagent_boundary_does_not_rerun_reviewers`。
   - 测试在 `subagent.plot_reviewer` trace 写入后暂停；resume 后 builder 调用次数仍为 1，事件流补齐 character/prose/continuity/synthesizer traces，最终写入 `review_report` 并 complete。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；未改变 SSE/WebSocket 事件名、权限模型、可见 artifact schema、provider/model 调用或 proposed patch 确认模型。
- 本刀仅覆盖无写入 `file.review` postprocess resume，不自动重放 provider request，不泛化到写工具。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime.py app/domains/agent_runs/save_points.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **48 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **111 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`

**行为变更**：true, additive recovery behavior for read-only `file.review` postprocess. If a pause arrives after reviewer computation but before all traces/artifacts are durable, resume continues from `next_trace_index` instead of rerunning reviewer work.

## 阶段 5 pending-call diagnostic tracer 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Run loop recovery 深化，pending-call resume diagnostic 第一刀。

**目标**：在不新增 event type、不改变权限模型、不自动执行写工具的前提下，让 `resume_run` 对不可恢复的隐藏 `runtime_pending_call` artifact 给出可回放诊断。若 pending call 是 unsupported intent（例如写工具）或缺少 resume envelope，控制通道不静默吞掉，也不重跑 provider/tool；诊断写入既有 `resume_run` 事件的 `payload.runtime_recovery.resume_diagnostic`，并由 `/save-points` 投影。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/runtime_recovery.py`
   - 新增纯 helper `build_runtime_pending_call_summary()` 与 `build_runtime_pending_call_resume_diagnostic()`。
   - 当前仅 `file.review` 属于可由控制通道自动恢复的 pending intent；其他 intent 保守标记 `unsupported_pending_call_intent` 与 `manual_restart_required`。
   - `file.review` pending 缺少 `resume_message` 时标记 `missing_resume_message`，避免控制通道凭不完整 artifact 盲目重跑。
2. `apps/api/app/domains/agent_runs/service.py`
   - `handle_agent_control_message()` 在 `resume_run` 后调用 pending resume classifier。
   - 可恢复时保持既有 `resumed_result` 行为；不可恢复但存在 pending artifact 时，将 `resume_diagnostic` 追加到 control result 与 `resume_run` event payload。
   - `resume_agent_run_if_pending()` 旧返回形状保持 `dict | None`。
3. `apps/api/app/domains/agent_runs/save_points.py`
   - `runtime_recovery.latest_resume_diagnostic` 从既有 `resume_run` event 投影。
   - pending-call 摘要复用 runtime recovery 纯 helper，减少 save point 与 runtime/service 的判断漂移。
4. `apps/api/app/domains/ide/router.py`
   - WebSocket `resume_run` ack 在存在诊断时追加 `resume_diagnostic`，旧 ack 字段保持。
5. `apps/api/tests/test_agent_runs.py`
   - 新增 `test_resume_run_records_diagnostic_for_unsupported_pending_call`。
   - 新增 `test_resume_run_records_diagnostic_for_malformed_file_review_pending_call`。
   - 更新 runtime recovery projection 断言，确认新增字段不破坏既有 tool_trace recovery projection。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除；`resume_agent_run_if_pending()` 旧返回契约保持。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；诊断落在既有 `resume_run` event payload。
- 未改变 provider/model 调用策略、写工具确认模型、可见 artifact schema 或 proposed patch review flow。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime_recovery.py app/domains/agent_runs/runtime.py app/domains/agent_runs/service.py app/domains/agent_runs/save_points.py app/domains/ide/router.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **50 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **113 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/service.py apps/api/app/domains/agent_runs/save_points.py apps/api/app/domains/ide/router.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive recovery diagnostics only. `resume_run` may now carry `resume_diagnostic` when a hidden pending call exists but cannot be safely resumed; unsupported/malformed pending calls remain non-executed and require manual restart or a future explicit migration.

## 阶段 5 failure recovery projection 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Run loop recovery 深化，failed run 恢复投影第一刀。

**目标**：在不改失败写入路径、不新增 event type、不承诺 provider stream 恢复的前提下，让 `/save-points` 对 failed run 给出更可审计的恢复摘要：指出最近 `agent_run_failed` 事件、是否缺少 checkpoint、应否 manual restart，以及失败前最后一个已落库 execution marker。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/save_points.py`
   - `runtime_recovery` 新增 `latest_failure`。
   - `latest_failure` 投影 `event_id` / `sequence` / `event_type` / `failed_without_checkpoint` / `manual_restart_required` / `resume_strategy`。
   - 若存在 `bookrun_checkpoint`，投影 `checkpoint_artifact_id` 并给出 `bookrun_checkpoint` resume strategy；否则保守为 `manual_restart_required`。
   - 若失败前已有 `tool_trace.payload.recovery.execution_marker`，以摘要引用最近 execution marker，帮助恢复端解释“最后成功边界”和“仍不能自动恢复”之间的关系。
2. `apps/api/tests/test_agent_runs.py`
   - 扩展 `test_failed_run_with_runtime_marker_still_requires_manual_restart_without_checkpoint`，确认即使存在 replay-safe `context.load` marker，没有 checkpoint 的 failed run 仍投影 manual restart，并在 `latest_failure.latest_execution_marker` 引用最近边界。
   - 更新 runtime recovery projection golden，确认非失败 run 的 `latest_failure` 为 `None`。
3. `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`
   - 记录 failure projection 第一刀已完成，并明确仍不支持 provider stream 恢复。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；失败摘要只读投影既有 `agent_run_failed` / `tool_trace` / `bookrun_checkpoint` facts。
- 未改变 provider/model 调用策略、权限模型、artifact schema 或 proposed patch review flow。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/save_points.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **50 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **113 passed**
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime_recovery.py app/domains/agent_runs/runtime.py app/domains/agent_runs/service.py app/domains/agent_runs/save_points.py app/domains/ide/router.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/service.py apps/api/app/domains/agent_runs/save_points.py apps/api/app/domains/ide/router.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive save-point projection only. Failed runs now expose a richer `runtime_recovery.latest_failure` summary, but automatic resume semantics remain unchanged.

## 阶段 5 pending-call resolution tracer 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Run loop recovery 深化，pending-call lifecycle resolution 第一刀。

**目标**：在不新增事件类型、不改变可见 artifact schema、不触碰写工具确认模型的前提下，让成功通过 control-channel resume 消费的隐藏 `runtime_pending_call` 也有 append-only 的 durable resolution fact。此前 pending call 只有创建和诊断；本刀新增隐藏 `runtime_pending_call_resolution` artifact，普通 `/artifacts` 不暴露，`/save-points` 可投影，且最新 pending-related fact 为 resolution 时不会把旧 pending artifact 再当成活跃待恢复。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/runtime_recovery.py`
   - 新增 `RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND = "runtime_pending_call_resolution"`。
   - 新增纯 helper `build_runtime_pending_call_resolution_payload()`，从原 pending payload 生成 append-only resolution payload。
2. `apps/api/app/domains/agent_runs/runtime.py`
   - `file.review` 从 pending call 成功续跑时，将 resolution 作为 hidden `ToolArtifact` 交给既有 artifact postprocess。
   - context-boundary resume 与 postprocess resume 都写 resolution；若 resume 过程中再次 paused，不写 resolution。
   - 普通非 resume `file.review` 路径不写 resolution。
3. `apps/api/app/domains/agent_runs/system_jobs.py`
   - 将 `runtime_pending_call_resolution` 加入隐藏 artifact kind，避免普通 `/artifacts` 暴露内部 runtime lifecycle fact。
4. `apps/api/app/domains/agent_runs/service.py`
   - `_latest_runtime_pending_call_artifact()` 以 pending/resolution 两类 artifact 中最新事实为准；若最新为 resolution，则不再返回旧 pending。
   - `/save-points` artifact 查询包含 resolution artifact。
5. `apps/api/app/domains/agent_runs/save_points.py`
   - `save_points` 可显示 `runtime_pending_call_resolution`。
   - `runtime_recovery.latest_pending_call_resolution` 投影 resolution 摘要。
   - 最新 pending-related fact 为 resolution 时，`pending.runtime_pending_call_artifact_id` 与 `runtime_recovery.latest_pending_call` 归空。
6. `apps/api/tests/test_agent_runs.py`
   - 扩展 context-boundary resume、control-channel resume 与 postprocess resume 测试，确认成功续跑后 visible artifacts 仍只有 `review_report`，而 save-points 可见 `latest_pending_call_resolution`。
   - 扩展 unsupported/malformed pending diagnostic 测试，确认不可恢复路径不写 resolution。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除；`resume_agent_run_if_pending()` 返回契约保持。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；resolution 通过既有 `agent_artifact` event 和 hidden artifact fact 表达。
- 未改变 provider/model 调用策略、权限模型、写工具确认模型、可见 artifact schema 或 proposed patch review flow。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime_recovery.py app/domains/agent_runs/runtime.py app/domains/agent_runs/service.py app/domains/agent_runs/save_points.py app/domains/agent_runs/system_jobs.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_file_review_runtime_resumes_from_pending_context_boundary tests/test_agent_runs.py::test_resume_run_control_message_drives_pending_file_review_resume tests/test_agent_runs.py::test_file_review_resume_after_subagent_boundary_does_not_rerun_reviewers -q` → **3 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **50 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **113 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/service.py apps/api/app/domains/agent_runs/save_points.py apps/api/app/domains/agent_runs/system_jobs.py apps/api/app/domains/ide/router.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive hidden runtime lifecycle artifact only. Successful pending `file.review` resume now writes a hidden `runtime_pending_call_resolution` artifact; visible artifacts, event names, permission decisions, provider calls, and write confirmation flow remain unchanged.

## 阶段 4 BookRun checkpoint/metrics enrichment 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 4 · Tool Postprocess / Artifact Pipeline，BookRun checkpoint/metrics 第一刀。

**目标**：在不改变 BookRun 独立事实源、不迁移 BookRun 控制流、不改变 provider/model 调用策略的前提下，让镜像进 AgentRun 的 `bookrun_checkpoint` artifact 携带与 `tool_trace` snapshot 一致的恢复/指标摘要，并让 `/save-points` 能直接投影最新 checkpoint 章号与预算/进度指标。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/service.py`
   - `record_book_run_snapshot()` 写 `bookrun_checkpoint` artifact 时复用 `_book_run_snapshot_payload()`。
   - checkpoint artifact payload 现在追加 `book_id`、`blueprint_id`、`current_chapter_index`、`total_chapters`、`completed_count`、`tokens_used`、`token_budget`、`checkpoint_count` 等 snapshot 字段。
   - 原有 `writing_run_id` / `book_run_id` / `scope` / `mode` / `checkpoint` / `source` 字段保持。
2. `apps/api/app/domains/agent_runs/save_points.py`
   - artifact summary 增加 `tokens_used`、`token_budget`、`completed_count`、`current_chapter_index`、`total_chapters`、`checkpoint_count`。
   - 对 `checkpoint` 列表投影最新条目的 `chapter_index`、`status`、`model_run_id`、`judge_report_id`、`approved_scene_id`。
3. `apps/api/tests/test_agent_runs.py`
   - 扩展 `test_save_point_projection_detects_bookrun_checkpoint`，覆盖 checkpoint save point 的预算/进度/最新章摘要。
   - 扩展 `test_book_run_progress_is_projected_to_agent_run_event_store`，覆盖端到端 BookRun progress → AgentRun checkpoint artifact → `/save-points` projection。
4. `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`
   - 记录阶段 4 BookRun checkpoint/metrics 第一刀已完成，并保留更深 retry/checkpoint metadata 与新 artifact 类型为后续缺口。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未改变 BookRun 独立事实源或控制流；本刀只是 AgentRun 镜像 artifact/save-point 的 additive metadata。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；未改变 provider/model 调用策略、权限模型或 proposed patch review flow。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/service.py app/domains/agent_runs/save_points.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_save_point_projection_detects_bookrun_checkpoint tests/test_agent_runs.py::test_book_run_progress_is_projected_to_agent_run_event_store -q` → **2 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **50 passed**
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **63 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **113 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/service.py apps/api/app/domains/agent_runs/save_points.py apps/api/app/domains/agent_runs/system_jobs.py apps/api/app/domains/ide/router.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive checkpoint artifact/save-point metadata only. BookRun lifecycle, checkpoint source of truth, AgentRun event names, provider calls, and write confirmation flow remain unchanged.

## 阶段 4 BookRun retry metadata projection 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 4 · Tool Postprocess / Artifact Pipeline，BookRun retry/resume metadata 第一刀。

**目标**：继续深化 BookRun → AgentRun 镜像事实，不改变 BookRun 独立事实源、不迁移控制流、不改变 provider/model 调用策略。`retry_from_checkpoint` / `resume` 这类恢复起点需要进入 BookRun snapshot、`bookrun_checkpoint` artifact 和 `/save-points` 摘要，便于后续 Desktop recovery / BookRun 收敛读取同一 AgentRun facts。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/run_payloads.py`
   - `_book_run_snapshot_payload()` 读取 `book_run.progress` 中的 `resume_from_chapter_index`、`retry_from_chapter_index` 和 `retry_from_checkpoint`。
   - snapshot payload 追加 `retry_checkpoint` 与 `retry_checkpoint_chapter_index` 摘要，只保留 chapter/model/judge/approved/status 等可审计引用。
2. `apps/api/app/domains/agent_runs/save_points.py`
   - artifact summary 追加 `resume_from_chapter_index`、`retry_from_chapter_index`、`retry_checkpoint_chapter_index`。
   - `retry_checkpoint` dict 投影为 `retry_checkpoint_chapter_index`、`retry_checkpoint_model_run_id`、`retry_checkpoint_judge_report_id`、`retry_checkpoint_approved_scene_id` 等摘要字段。
3. `apps/api/tests/test_agent_runs.py`
   - 新增 `test_agent_run_retry_from_checkpoint_projects_bookrun_retry_metadata`。
   - 测试通过真实 WebSocket `retry_from_checkpoint` 控制消息，验证 BookRun 状态、控制事件 payload、bookrun-agent `tool_trace`、`bookrun_checkpoint` artifact 与 `/save-points` 均携带 retry 起点。
4. `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`
   - 记录阶段 4 BookRun retry metadata 第一刀已完成，并明确 BookRun 事实源收敛仍未完成。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未改变 BookRun 独立事实源或控制流；本刀只是 AgentRun 镜像 snapshot/artifact/save-point 的 additive metadata。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；未改变 provider/model 调用策略、权限模型或 proposed patch review flow。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/run_payloads.py app/domains/agent_runs/save_points.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_agent_run_retry_from_checkpoint_projects_bookrun_retry_metadata -q` → **1 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_save_point_projection_detects_bookrun_checkpoint tests/test_agent_runs.py::test_book_run_progress_is_projected_to_agent_run_event_store tests/test_agent_runs.py::test_agent_run_retry_from_checkpoint_projects_bookrun_retry_metadata -q` → **3 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **51 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **114 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/service.py apps/api/app/domains/agent_runs/save_points.py apps/api/app/domains/agent_runs/system_jobs.py apps/api/app/domains/agent_runs/run_payloads.py apps/api/app/domains/ide/router.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive snapshot/checkpoint/save-point metadata only. BookRun lifecycle, checkpoint source of truth, AgentRun event names, provider calls, and write confirmation flow remain unchanged.

## 阶段 5 control event projection 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Save Points / 阶段 6 Desktop event recovery 前置，control event projection 第一刀。

**目标**：在不新增事件类型、不改变控制通道行为的前提下，让 `/save-points` 从现有 AgentRunEvent facts 投影 pause/resume/retry 控制边界，并给 Desktop recovery 提供 `runtime_recovery.latest_control`。`stop_run` 继续沿既有 `run_stopped` save point 语义，不制造第二套停止模型。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/save_points.py`
   - `pause_run` / `resume_run` / `retry_from_checkpoint` 现在投影为 `control_message` save point。
   - 新增 `_control_event_summary()`，只提取 `control_type`、reason/source、BookRun/WritingRun id/status/mode/scope 等小摘要，不复制完整 payload。
   - `runtime_recovery.latest_control` 投影最近控制事件，覆盖 permission approve/deny、pause/resume/stop/retry。
2. `apps/api/tests/test_agent_runs.py`
   - 扩展 `test_agent_run_control_channel_updates_bound_bookrun_status`，确认 pause/resume 进入 `control_message` save point，latest control 指向 `stop_run`。
   - 扩展 `test_agent_run_retry_from_checkpoint_projects_bookrun_retry_metadata`，确认 retry 控制消息进入 `control_message` save point，latest control 指向 `retry_from_checkpoint`。
   - 更新 runtime recovery golden，确认无控制事件时 `latest_control=None`。
3. `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`
   - 记录阶段 5 control event projection 第一刀已完成，仍不声明 provider stream 恢复或写工具 pending resume。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 import path / facade 未移除。
- Runtime package 没有 re-export workflow provider parity；未触碰 `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- Orchestrators package 未 re-export BookRun adapter symbols；未触碰 workflow orchestrators。
- 未新增 `turn_*` / `message_delta` / `tool_completed` / `agent_run_interrupted` event type；只读投影既有控制事件。
- 未改变 BookRun 独立事实源、provider/model 调用策略、权限模型或 proposed patch review flow。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/save_points.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_agent_run_control_channel_updates_bound_bookrun_status tests/test_agent_runs.py::test_agent_run_retry_from_checkpoint_projects_bookrun_retry_metadata -q` → **2 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **51 passed**
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **63 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **114 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/runtime_recovery.py apps/api/app/domains/agent_runs/runtime.py apps/api/app/domains/agent_runs/service.py apps/api/app/domains/agent_runs/save_points.py apps/api/app/domains/agent_runs/system_jobs.py apps/api/app/domains/agent_runs/run_payloads.py apps/api/app/domains/ide/router.py apps/api/tests/test_agent_runs.py` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive save-point projection only. Control events are now easier to recover from `/save-points`; event names, control side effects, provider calls, and write confirmation flow remain unchanged.

## 阶段 6 Desktop save-points client 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 6 · Desktop event recovery 前置，Desktop API client 读取面第一刀。

**目标**：让 Desktop 前端可以通过既有 API client barrel 读取 `/api/agent-runs/{run_id}/save-points`，并补齐 `retry_from_checkpoint` 控制消息类型。此刀只建立客户端读取面，不实现 UI 恢复面板，也不改变后端运行时行为。

**已完成模块**：
1. `apps/desktop/frontend/src/lib/api/agent-runs.ts`
   - 新增 `getAgentRunSavePoints(runId)`。
   - 使用既有 `getApiConfig()` / `trimApiBaseUrl()` / `readErrorDetail()` 路径，携带 `X-StoryForge-API-Key`。
2. `apps/desktop/frontend/src/lib/api/types.ts`
   - 新增 `AgentRunSavePoint` / `AgentRunSavePointProjection` 瘦类型，直接表达后端 projection shape。
   - `AgentControlMessageType` / `AgentControlAckMessage` 加入 `retry_from_checkpoint`。
   - `AgentControlAckMessage` 允许携带 `resumed_result` / `resume_diagnostic`。
3. `apps/desktop/frontend/src/lib/api/agent-socket.ts`
   - `isAgentControlAckMessage()` 识别 `retry_from_checkpoint` ack。
4. `apps/desktop/frontend/src/lib/api-client.ts`
   - 旧 barrel re-export `getAgentRunSavePoints` 与 save-point projection 类型。
5. `apps/desktop/frontend/tests/api-client.test.ts`
   - 新增 `agent control websocket accepts retry_from_checkpoint ack`。
   - 新增 `getAgentRunSavePoints fetches durable recovery projection`。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 桌面端旧 `api-client.ts` barrel 继续保留；新增 helper 从旧路径导出。
- 未触碰 Runtime package provider parity；未触碰 workflow provider adapter。
- 未触碰 orchestrators package 或 BookRun adapter re-export。
- 未改变后端事件名、权限模型、provider/model 调用策略或写工具确认流。

**本地验证**：
- `npm --prefix apps/desktop/frontend run test -- api-client.test.ts` → **9 passed**
- `npm --prefix apps/desktop/frontend run typecheck` → passed
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/api/app/domains/agent_runs/save_points.py apps/api/tests/test_agent_runs.py apps/desktop/frontend/src/lib/api-client.ts apps/desktop/frontend/src/lib/api/agent-runs.ts apps/desktop/frontend/src/lib/api/agent-socket.ts apps/desktop/frontend/src/lib/api/types.ts apps/desktop/frontend/tests/api-client.test.ts` → 通过
- `Select-String -Path <touched files> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive Desktop client capability only. Desktop can now fetch save-point projections and send typed retry-from-checkpoint control messages; no UI or backend runtime behavior changed.

## 阶段 6 Desktop recovery read-model/UI 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 6 · Desktop event recovery，ChatWindow 恢复摘要 read-model/UI 第一刀。

**目标**：在不改变后端运行时、不新增恢复控制行为、不触碰 provider/权限/写回模型的前提下，让 Desktop 消费 `/save-points` 的 durable facts，并把 pending permission、pending call、checkpoint、latest control、failed-without-checkpoint 等恢复信息转换成稳定的 ChatWindow 展示模型。

**已完成模块**：
1. `apps/desktop/frontend/src/components/chat-window/recovery.ts`
   - 新增纯函数 `buildAgentRunRecoveryDisplay()`。
   - 将 `AgentRunSavePointProjection` 解析为小型 UI read-model：状态、恢复策略、pending 摘要、最近控制、最近边界、checkpoint 摘要和 tone。
   - 对缺失/畸形字段保守降级，只展示能可靠解析的事实。
2. `apps/desktop/frontend/src/components/ChatWindow.tsx`
   - 在新 AgentRun 开始时清空恢复摘要。
   - 在 `permission_required`、control ack、agent result/error 后读取 `/save-points` 并刷新恢复 read-model。
   - 继续保留旧 `ChatWindow` barrel 导出，便于测试和旧引用读取。
3. `apps/desktop/frontend/src/components/chat-window/panels.tsx`
   - 新增 `AgentRunRecoveryPanel`，在现有 AgentRun steps 区块下方展示轻量恢复摘要。
   - 不新增按钮，不改变控制通道语义。
4. `apps/desktop/frontend/tests/chat-window.test.ts`
   - 覆盖 pending permission + proposed patch 摘要。
   - 覆盖 BookRun checkpoint + `retry_from_checkpoint` latest control 摘要。
   - 覆盖 failed-without-checkpoint 时仍显示 manual restart 保守策略。
5. `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`
   - 记录阶段 6 Desktop recovery read-model/UI 第一刀已完成，后续仍聚焦 production runtime 和更完整恢复入口。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 未触碰 API 源码；本刀无 touched API ruff target。
- 旧 Desktop `api-client.ts` barrel 与 `ChatWindow` barrel 继续保留。
- 未触碰 Runtime package provider parity；未触碰 workflow provider adapter。
- 未触碰 orchestrators package 或 BookRun adapter re-export。
- 未新增后端事件名；未改变 provider/model 调用策略、权限模型、writeback/proposed patch confirmation flow 或自动恢复行为。

**本地验证**：
- `npm --prefix apps/desktop/frontend run test -- chat-window.test.ts api-client.test.ts` → **20 passed**
- `npm --prefix apps/desktop/frontend run typecheck` → passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/desktop/frontend/src/components/ChatWindow.tsx apps/desktop/frontend/src/components/chat-window/panels.tsx apps/desktop/frontend/tests/chat-window.test.ts` → 通过
- `Select-String -Path <touched files including recovery.ts> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive Desktop read-model/UI only. ChatWindow can now refresh and display save-point recovery summaries; backend runtime behavior, event protocol, provider calls, permission model, and write confirmation flow remain unchanged.

## 阶段 6 Desktop resumed-result closeout 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 6 · Desktop event recovery，control-channel `resumed_result` UI 收口第一刀。

**目标**：后端 `resume_run` ack 已可携带 `resumed_result` 续跑 pending `file.review`；Desktop 需要消费该结果并完成 ChatWindow 收口，避免 UI 只把 ack 当作普通 `resume_run` 状态而停留在 running。此刀只改变 Desktop 结果消费，不改变后端 runtime、控制协议、权限模型或写工具确认流。

**已完成模块**：
1. `apps/desktop/frontend/src/components/chat-window/resumed-result.ts`
   - 新增 `statusFromAgentResult()` 和 `stepsFromResumedAgentResult()` 纯 helper。
   - 将 `resumed_result` 映射为恢复步骤，并根据 `requires_user_confirmation` 保留 completed/waiting 状态。
2. `apps/desktop/frontend/src/components/ChatWindow.tsx`
   - `sendAgentRunControl()` 收到带 `resumed_result` 的 ack 时，复用 Agent result 收口路径更新 assistant session、标题、steps、消息、review markers 或 proposed patch。
   - 成功收口后继续刷新 `/save-points` recovery 摘要。
   - 保留旧 `ChatWindow` barrel 导出，便于测试和旧引用读取。
3. `apps/desktop/frontend/tests/chat-window.test.ts`
   - 新增 resumed result 无确认时映射为 completed recovery steps 的测试。
   - 新增 resumed result 需要确认时保持 waiting 状态的测试。
4. `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`
   - 记录阶段 6 Desktop `resumed_result` closeout 已完成，后续不再重复做同一 UI 收口。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 未触碰 API 源码；本刀无 touched API ruff target。
- 旧 Desktop `api-client.ts` barrel 与 `ChatWindow` barrel 继续保留。
- 未触碰 Runtime package provider parity；未触碰 workflow provider adapter。
- 未触碰 orchestrators package 或 BookRun adapter re-export。
- 未新增后端事件名；未改变 provider/model 调用策略、权限模型、writeback/proposed patch confirmation flow 或自动恢复行为。

**本地验证**：
- `npm --prefix apps/desktop/frontend run test -- chat-window.test.ts api-client.test.ts` → **22 passed**
- `npm --prefix apps/desktop/frontend run typecheck` → passed
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`
- `git diff --check -- .codex/verification-report.md docs/architecture/pi-opencode-agent-harness-adoption-plan.md apps/desktop/frontend/src/components/ChatWindow.tsx apps/desktop/frontend/src/components/chat-window/panels.tsx apps/desktop/frontend/tests/chat-window.test.ts` → 通过
- `Select-String -Path <touched files including recovery.ts/resumed-result.ts> -Pattern '[ \t]+$'` → trailing whitespace check ok

**行为变更**：true, additive Desktop UI closeout only. `resume_run` acknowledgements that include `resumed_result` now complete the visible ChatWindow flow; backend runtime behavior, event protocol, provider calls, permission model, and write confirmation flow remain unchanged.

## 阶段 6 Desktop resume diagnostic / stale ack guard 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 6 · Desktop event recovery，control-channel 诊断收口与陈旧 ack guard。

**目标**：`resume_run` 可能返回 `resume_diagnostic` 而非 `resumed_result`；Desktop 不能继续把 UI 留在 running。同时 control ack 是异步返回，若用户已开启另一个 AgentRun，旧 ack 不能覆盖当前 run 的状态、steps 或消息。

**已完成模块**：
1. `apps/desktop/frontend/src/components/chat-window/resumed-result.ts`
   - 新增 `displayFromResumeDiagnostic()`，把 unsupported/malformed/premature pending resume 映射为 failed/waiting 文案。
2. `apps/desktop/frontend/src/components/ChatWindow.tsx`
   - `sendAgentRunControl()` 在 await 后用 `shouldApplyAgentControlAck()` 校验 active run、requested run 和 ack run id。
   - `resume_diagnostic` 会写入 ChatWindow 消息与 resume step，并按诊断降级为 failed 或 waiting。
   - resumed review marker 优先使用 `review_report.file_path` / proposed patch file path，避免作者切换文件后把 markers 打到当前编辑器文件。
3. `apps/desktop/frontend/tests/chat-window.test.ts`
   - 覆盖 stale/mismatched ack guard。
   - 覆盖 resume diagnostic failed/waiting 映射。
   - 覆盖 agent result file path 优先从 review report / proposed patch 读取。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 旧 Desktop `ChatWindow` barrel 继续保留新增 helper 导出。
- 未触碰后端事件协议、provider/model 调用策略、权限模型或写工具确认流。

**本地验证**：
- `npm --prefix apps/desktop/frontend run test -- chat-window.test.ts api-client.test.ts` → **26 passed**
- `npm --prefix apps/desktop/frontend run typecheck` → passed

**行为变更**：true, additive Desktop safety behavior only. 陈旧 control ack 不再覆盖当前 AgentRun；`resume_diagnostic` 会在 UI 中明确收口。

## 阶段 5 chapter.review pending resume 验证（2026-06-29）

**条目**：Pi/OpenCode Agent Harness adoption plan — 阶段 5 · Run loop recovery 深化，`chapter.review` 的 `judge.run` 后置 no-write pending resume tracer。

**目标**：在不改变写工具确认模型、不新增事件名、不承诺 provider stream 恢复的前提下，让 `chapter.review` 能在 `judge.run` 已落库后暂停，并在 `resume_run` 后只用已持久化的 `judge_output` 收口审阅结果；恢复路径不重跑 `judge.run`，也不自动执行 `judge.repair`。

**已完成模块**：
1. `apps/api/app/domains/agent_runs/runtime_recovery.py`
   - `SUPPORTED_RUNTIME_PENDING_CALL_INTENTS` 扩展到 `chapter.review`。
   - pending summary 投影 `chapter.review.postprocess`。
   - resume diagnostic 对 `chapter.review` 要求 `judge_output` / `judge_trace` 存在，缺失时保守降级。
2. `apps/api/app/domains/agent_runs/runtime.py`
   - `_run_chapter_review()` 写 plan 后执行 `judge.run` 并落 `tool_trace`，在 `after_tool:judge.run` 检查 paused/stopped。
   - paused 时写隐藏 `runtime_pending_call` artifact，保存 `judge_output`、`judge_trace` 和 resume envelope。
   - `_resume_chapter_review_from_pending_call()` 从 pending artifact 收口章节审阅，生成 no-write result 与 resolution artifact，不执行 `judge.repair`。
3. `apps/api/tests/test_agent_runs.py`
   - 新增 `test_chapter_review_runtime_resumes_after_judge_run_without_repairing`。
   - 测试证明 pending/save-points projection 正确、`resume_run` 返回 resumed_result、`judge.run` 不重跑、`judge.repair` 不执行、resolution artifact 投影后旧 pending 不再活跃。
4. `docs/architecture/pi-opencode-agent-harness-adoption-plan.md`
   - 记录该 tracer bullet 已完成，并明确下一刀不要把它误扩展成写工具自动恢复。

**硬约束检查**：
- 未新增或维护 `apps/web`。
- 未改变 `file.revise` / `judge.repair` / `bookrun.start` 的 propose-then-confirm 模型。
- 未新增 `turn_*` / `message_delta` / `agent_run_interrupted` 等事件。
- 未触碰 Runtime package provider parity；未触碰 workflow provider adapter。
- 未触碰 orchestrators package 或 BookRun adapter re-export。
- 未改变 provider/model 调用策略、BookRun 事实源或 Desktop 写回确认流。

**本地验证**：
- `cd apps/api && uv run ruff check app/domains/agent_runs/runtime.py app/domains/agent_runs/runtime_recovery.py tests/test_agent_runs.py` → All checks passed
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_chapter_review_runtime_resumes_after_judge_run_without_repairing -q` → **1 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py::test_file_review_runtime_resumes_from_pending_context_boundary tests/test_agent_runs.py::test_resume_run_control_message_drives_pending_file_review_resume tests/test_agent_runs.py::test_file_review_resume_after_subagent_boundary_does_not_rerun_reviewers tests/test_agent_runs.py::test_chapter_review_runtime_resumes_after_judge_run_without_repairing tests/test_agent_runs.py::test_resume_run_records_diagnostic_for_unsupported_pending_call tests/test_agent_runs.py::test_resume_run_records_diagnostic_for_malformed_file_review_pending_call -q` → **6 passed**
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py::test_agent_user_message_chapter_review_calls_registry_and_waits_for_confirmation -q` → **1 passed**
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **52 passed**
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_runtime_tools.py tests/test_model_runs.py -q` → **63 passed**
- `cd apps/api && uv run python -c "import app.main; print('import ok')"` → `import ok`

**行为变更**：true, additive no-write pending resume only. `chapter.review` can resume from the durable `judge.run` boundary, but write tools, provider stream recovery, event protocol, artifact visibility, and permission behavior remain unchanged.

## 下一步计划落盘 + 30 章退回结构化（2026-06-29，阶段0-3 文档半）

- 变更：新增 `docs/internal/next-step-plan.md`（多 agent 侦察产出的下一步路线图：阶段0 护栏 + 产品轨/质量轨并行 + 重跑 DoD + Do-Not-Do）；新增 `.codex/real-llm-30ch-mimo25pro-20260611-192356/readthrough-findings.md`（7 阻塞 × 6 盲评维度映射 + 机器可验证锚点）；`docs/internal/current-phase.md` 追加"下一步计划与重跑 DoD"小节（仅追加，未删改既有事实行）。
- 机器可验证锚点：`book.md` 中"审计链"出现 65 次（blocker#1 系统词由 premise `book_generation.py:408,486` 主动播种）；`grep -c '^## ' book.md`=30 章。
- 验证命令与结果：
  - `cd apps/api && uv run pytest tests/test_phase9_fact_sources.py -q` → 13 passed（current-phase.md 追加未触发 doc-guard 字符串断言回归）。
- 未联通能力：本文件为诊断脚手架，非人工通读完成记录；逐章引文与主观质量判定待新一轮长程人工盲评（next-step-plan Q9）填充，不得据此宣称质量验收通过。

## 阶段0-1：真实生成 _call_llm 有界重试 + 退避护栏（2026-06-29，rank 1 重试半）

- 变更：`apps/api/app/domains/book_runs/book_generation_llm.py` 的 `_call_llm` 由单次 `urlopen` 改为有界重试循环：429/5xx 与超时/连接失败可重试（指数退避 + jitter，尊重 Retry-After 头），4xx（429 除外）与空正文立即失败不掩盖真实问题；新增 `_is_retryable_status`/`_retry_after_seconds`/`_sleep_before_retry` 叶子 helper，镜像 workflow `provider_client` 退避语义。重试参数读自 source：`STORYFORGE_LLM_RETRY_MAX_ATTEMPTS`(默认3)/`STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS`(0.5)/`STORYFORGE_LLM_RETRY_JITTER_SECONDS`(0.25)。零行为变更（默认成功路径不变），无路由/schema 变化故无需刷 openapi。
- 新增 `apps/api/tests/test_book_generation_llm_retry.py`：本地 HTTPServer 真实协议边界，覆盖 429 重试成功、5xx 重试成功、超 max_attempts 抛错、4xx 不重试。
- 验证命令与结果：
  - `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_llm.py tests/test_book_generation_llm_retry.py` → All checks passed
  - `cd apps/api && uv run python -c "import app.main"` → import ok（无 import 环）
  - `cd apps/api && uv run pytest tests/test_book_generation_llm_retry.py tests/test_book_generation.py -q` → 33 passed
- 未联通能力：本刀只护单次调用瞬时错误；缺章硬护栏（failure_count>0 即判不合格 + summary 标注缺章章号）与 4 万字长程 resume/预算暂停实战演练为 rank 1 余下半 / Q9 preflight，未在本刀交付。

## 阶段0-2：CI 增 push/PR 触发 + OpenAPI 漂移门 + e2e 定时安全网（2026-06-29，rank 2）

- 变更：`.github/workflows/ci.yml` 由仅 `workflow_dispatch` 增加 `push`/`pull_request`(到 master) 触发 + `concurrency`(取消同 ref 在途 run)；核心 job 仍跑 `pnpm run verify:local`，其内含 OpenAPI 契约漂移检查（`scripts/verify-local.mjs:71-94` 刷新后比对 sha256，漂移即 exit 1），并加注释说明改路由未刷 openapi 的 PR 会在此自动失败。`.github/workflows/e2e.yml` 增每周 cron 安全网（保留 workflow_dispatch）。
- 验证命令与结果：
  - `python -c "import yaml; yaml.safe_load(...ci.yml/e2e.yml)"` → YAML OK
  - 合并到 master 后由 push 触发首个自动 CI run 实测核心门禁（见下方 run 链接/编号回填）。
- 未联通能力：本刀只接触发与漂移门可见性，未改快门禁子集（verify:local 仍是全量核心门禁）；分支保护/required checks 未设置，故不阻断合并，仅提供自动信号。

## 阶段0-2 后修：CI 启用暴露既有 prettier 格式债，格式化转绿（2026-06-29）

- 现象：PR #30 启用 push/PR CI 后，首个 master CI run(28379332812) 在第一道 `pnpm run lint` 失败——`prettier --check` 报 9 个文件未格式化（eslint 仅 2 个非阻断 warning）。这是近期 #27 Wave1/2 重构与 hidden-agent-jobs 合并引入的既有格式债，因 CI 此前仅 workflow_dispatch 未被发现（历史 master run 亦全 red）。新启用的 CI 正确抓出。
- 变更：对 9 个受影响文件跑 `pnpm exec prettier --write`（App.tsx、ChatWindow.tsx、chat-window/{display-utils,panels,recovery}、editor/VersionHistory、lib/api/{agent-runs,runtime-health}、lib/project/context-bundle）。纯格式化，无逻辑变更。
- 验证命令与结果（core.autocrlf=false，prettier 写 LF 不被转 CRLF）：
  - `pnpm run lint` → exit 0（prettier "All matched files use Prettier code style!"，eslint 0 errors / 2 known warnings）
  - `npm --prefix apps/desktop/frontend run typecheck` → exit 0
  - `pnpm openapi` 重生成快照 → NO DRIFT（契约漂移门干净）
- 未联通能力：本地全量 `verify:local` 因 API+workflow pytest 较慢未在 10min 内跑完；API/workflow 单测留由合并后 master CI run 实测（见后续回填）。

## 故事状态模型设计落盘（2026-06-30，设计定稿）

- 变更：新增 `docs/internal/story-state-model-design.md`（跨章故事状态层设计定稿：5 决策锁定 + `state_event`/`state_ledger` 数据模型 + 12 类 CHANGES→edge/node/memory 映射 + 逐章运行时接线 + 三级升级）。纯文档，无代码/路由/schema 变更，无需刷 openapi。
- live 接线锚点核验（写入耐久文档前 grep/read 实测，防 file:line 漂移）：
  - `_judge_and_repair_loop` @ `book_generation_judge.py:65`（有界 `for range(MAX_REPAIR_ROUNDS)`；调用点 `book_generation.py:194/335`、`book_generation_parallel.py:290`）
  - `deterministic_judge_fallback` @ `judge/deterministic.py:11`；`semantic_judge_with_status` @ `judge/semantic.py:97`
  - local-gate 假象 @ `book_generation_judge.py:204-211`（`local_coverage` 注释 :204 自承 score=100 为假象）
  - `EdgeKind` @ `edge_constraints.py:18` = `relationship/timeline_order/status`；status 时间窗 `_check_status_window:144`
  - `_skip_submit_continuity` @ `novel_loop.py:47`（默认 port :70 不提交 → 设计要求翻成真提交）
  - 有界多轮 repair 由 `tests/test_multi_round_repair.py` 实证（多轮 / 封顶 / 阈值停止）
- 未联通能力：本文件是设计，未实现，不声称任何质量验收、不等同 Q1/Q9 通过；语义层先 advisory，仅确定性硬闸可硬断；不接 `narrative_gate.py`、不复用 `apps/workflow` `narrative/`。下一步建议起 Q1 P0（先建 `story_state` domain 骨架 + 单测，零行为变更，再单独接 loop）。

## CI 移除后补本地 pre-push 门禁（lint + OpenAPI 漂移）（2026-06-30）

- 背景：CI 于本日整体移除（PR #31 squash 含 `5d22b27` 删 `ci.yml`/`e2e.yml`），lint + OpenAPI 漂移两道快门禁失去自动拦截。按用户决策（b 本地 git hook）补回；`next-step-plan.md` 顶部加更新横幅 + §一.5/阶段0-2/横切 DoD/执行进度 同步。
- 变更：新增 `.githooks/pre-push`（跑 `pnpm run verify:fast`）；新增 `scripts/check-openapi-drift.mjs`（记录 digest → `pnpm openapi` → 比对，漂移即 exit 1，逻辑镜像 `verify-local.mjs:71-94`）；`package.json` 增 `verify:fast`（lint + check:drift）/`check:drift`/`hooks:install`（`git config core.hooksPath .githooks`）。一次性 `pnpm hooks:install` 启用，绕过用 `git push --no-verify`。
- 验证命令与结果：
  - `pnpm run verify:fast` → eslint 0 errors（2 个既有 warning 不阻断）+ prettier “All matched files use Prettier code style!”（含新 `.mjs`）+ `[check:drift] OpenAPI 契约无漂移`，整体 exit 0。
  - hook 经 `core.hooksPath` 启用后由本分支 push 实跑（见提交记录）。
- 未联通能力：hook 是本地防线、可 `--no-verify` 绕过，非强制门禁（贴合无 CI 决定）；仅覆盖 lint + 漂移，typecheck（desktop frontend 未入 workspace，既有问题）/单测/pytest 不在其中，仍须 `pnpm verify` 手动全量。`generate-openapi.mjs` 需本机 `uv` + API python env（无需 DB/起服）。

## Q1 P0：story_state 领域骨架落地（2026-06-30）

- **目标**：按 `story-state-model-design.md` 的下一步建议，先建路径无关的 `story_state` domain 骨架（事件日志 + 当前态投影 + grounding 硬闸 + 确定性不变量），作为 Q1/Q4 后续接 `_judge_and_repair_loop` 的底座。
- **变更**：
  - 新增 `apps/api/app/domains/story_state/`：`StoryStateEvent` append-only 事件表、`StoryStateLedger` 当前态投影表、`StateChangeInput`/grounding/result schemas、`commit_story_state_changes()` 与 `reproject_story_state()` 服务函数。
  - 新增 `apps/api/alembic/versions/20260630_0001_add_story_state.py`，并更新 Alembic head 到 `20260630_0001`。
  - `app.models` 注册新模型，保证内存 SQLite 与 ORM metadata 路径可见。
  - 新增 `apps/api/tests/test_story_state.py`，覆盖 grounding 成功/失败、append event、ledger projection、按章 rollback/reproject、伏笔未埋先收、秘密知情集只增、位置移动链 from 校验。
  - 新增 `.codex/context-summary-story-state-q1-p0.md` 并回填 `.codex/operations-log.md` 编码前/后声明。
- **本地验证**：
  - `cd apps/api && uv run ruff check app/domains/story_state app/models.py tests/test_story_state.py tests/test_alembic_heads.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_story_state.py -q` → 6 passed。
  - `cd apps/api && uv run pytest tests/test_story_state.py tests/test_alembic_heads.py tests/test_alembic_schema_current_orm.py -q` → 13 passed，1 个既有 Alembic `path_separator` deprecation warning。
  - `cd apps/api && uv run pytest tests/test_continuity_edges.py tests/test_story_memory_persistence.py tests/test_story_state.py -q` → 21 passed。
  - `cd apps/api && uv run python -c "from app.db.base import Base; import app.models; print('story_state_events' in Base.metadata.tables, 'story_state_ledgers' in Base.metadata.tables)"` → `True True`。
  - `pnpm run verify:fast` → 首次因 pnpm 无 TTY 依赖目录清理确认保护失败（非代码失败）；复跑 `$env:CI='true'; pnpm.cmd run verify:fast` → 通过，eslint 0 errors / 2 个既有 warning，Prettier 通过，OpenAPI 契约无漂移。
  - `git diff --check -- <touched files>` → 通过。
- **未联通能力**：本刀是 Q1 P0 底座，**不等同 Q1 完成**；尚未接 `_judge_and_repair_loop`，未替换 `book_generation_parallel.py` 中林岚/灯塔写死抽取，未实现 LLM 语义 grounding，未向 `continuity_edges` 提交 edge 类 CHANGES，未跑 Q9 4 万字真实长程重跑。

## Q2：去 demo premise 系统词 + 默认多 arc（2026-06-30）

- **目标**：移除真实生成默认源头里的 `林岚` / `灯塔` / `审计链` 播种，并把 `_default_planning_arcs()` 从单 arc 全书覆盖改为多 arc、有界目标章，降低 Q9 重跑复发 30 章退回 blocker#1/#6/#7 的概率。
- **变更**：
  - `book_generation.py` 新增 `DEFAULT_GENERATION_*` 常量，默认题材改为沈砚 / 苍岭城 / 铜钟匠 / 旧盟约，不再使用旧 demo 词。
  - `_seed_consistency_data()` 的 Character Bible / Style Pack 同步改为新默认人物与风格样例。
  - `_blueprint_payload()` metadata 改为新 `pov` / `location` / `title_seed`。
  - `_default_planning_arcs()` 改为 3 条默认弧线：`missing_bellsmith_case`、`patrol_oath_pressure`、`city_bell_rule`，目标章通过 `_arc_points()` 有界压缩，不再单 arc 覆盖全书。
  - `test_book_generation.py` 新增默认题材非 demo 与多 arc 回归测试；fake provider 响应同步改为沈砚，避免测试证据继续播种旧主角。
- **本地验证**：
  - `cd apps/api && uv run ruff check app/domains/book_runs/book_generation.py tests/test_book_generation.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_book_generation_defaults_do_not_seed_demo_story_terms tests/test_book_generation.py::test_default_planning_arcs_are_multi_arc_and_bounded tests/test_book_generation.py::test_book_generation_runs_one_chapter_and_records_evidence tests/test_book_generation.py::test_book_generation_runs_ten_chapters_with_word_targets -q` → 4 passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py -q` → 31 passed。
  - `cd apps/api && uv run pytest tests/test_book_generation_parallel.py -q` → 11 passed。
- **未联通能力**：Q2 不替代 Q1；`book_generation_parallel.py` 的林岚/灯塔写死 memory extract 尚未替换，旧 golden baseline/历史测试夹具仍保留旧题材作为历史回归事实，Q9 真实重跑仍需显式换非 demo 题材并完成人工盲评。

## Q3：fast judge 语义 advisory 必经一遍（2026-06-30）

- **目标**：收紧真实生成 fast path 空转。本地 deterministic/style/character/timeline 门禁通过时，不再完全跳过语义 Judge；语义评审必须执行一遍，但只作为 advisory 信号，不扣分、不触发修复。
- **变更**：
  - `book_generation_judge.py::_run_real_judge()` 在 `local_gate_passed` fast path 前调用 `semantic_judge_with_status()`。
  - 新增 `_semantic_advisory_payload()`，将 `failed`、`issue_count` 和 advisory issues 摘要写入 summary `JudgeIssue.payload["semantic_advisory"]`。
  - fast path reason 改为 `local_gate_passed_semantic_advisory`，明确不是“未运行语义”。
  - 更新 `test_book_generation.py`：用 fake httpx client 锁定 advisory 成功路径；其它生成测试改按 draft 请求数断言，避免测试环境 HTTP 栈缺 `trio` 影响真实生成路径。
- **本地验证**：
  - `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_judge.py tests/test_book_generation.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_book_generation_fast_path_runs_semantic_advisory_when_local_gate_passes tests/test_book_generation.py::test_book_generation_runs_one_chapter_and_records_evidence tests/test_book_generation.py::test_book_generation_runs_ten_chapters_with_word_targets tests/test_book_generation.py::test_book_generation_resume_continues_after_existing_approved_chapters -q` → 4 passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py -q` → 31 passed。
  - `cd apps/api && uv run pytest tests/test_judge_semantic.py tests/test_judge_failure_marker.py -q` → 7 passed。
  - `cd apps/api && uv run pytest tests/test_book_generation_parallel.py -q` → 11 passed。
- **未联通能力**：语义 advisory 仍是咨询信号，不作为硬门禁；未实现跨章语义维度和 `required_facts` 真相源填充（Q4）；当时并发 memory extract 写死问题尚未收口，后续见「Q1 P1」；未跑 Q9 真实长程。

## Q1 P1：并发 memory extract 去硬编码（2026-06-30）

- **目标**：移除 `book_generation_parallel.py` 章末 Story Memory 抽取中的旧 demo 主角/地点词，避免非 `林岚/灯塔` 题材每章 `memory_extract_skipped` 或抽取断粮。
- **变更**：
  - `_character_state_extracts()` 改为使用 `Chapter.pov` 作为角色锚点，并从正文中截取包含该角色的句子作为状态证据。
  - `_world_fact_extracts()` 改为使用 `Chapter.location` + 通用中文设定词缀（规约/协议/许可/盟约/钟楼/密钥/线索/信号）抽取世界事实，不再写死 `灯塔/信号`。
  - 新增 `.codex/context-summary-q1-memory-extract.md`；`test_book_generation_parallel.py` 新增非 demo 题材抽取回归。
- **本地验证**：
  - `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_parallel.py tests/test_book_generation.py tests/test_book_generation_parallel.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py -q` → 43 passed。
  - `cd apps/api && uv run pytest tests/test_story_state.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_alembic_heads.py -q` → 53 passed，1 个既有 Alembic `path_separator` deprecation warning。
  - `git diff --check` → 通过。
- **未联通能力**：这是通用本地抽取，不是 LLM 语义 CHANGES；串行 runner 尚未写 Story Memory atoms；复杂状态、称谓归一和 edge 类变更仍需后续 Q1/Q4。

## Q1 P2：state-grounding bridge 接 `_judge_and_repair_loop`（2026-06-30）

- **目标**：把 Q1 P0 的 `story_state` 底座接入真实生成 judge loop，让串行与并发真实路径在章节通过后产生可审计的跨章状态事件，不再停留在“建表但未接线”。
- **变更**：
  - `book_generation_judge.py::_judge_and_repair_loop()` 在章节通过且无阻断 issue 后调用 `_commit_story_state_for_scene()`，提交保守 CHANGES。
  - 保守 CHANGES 来源为 `Chapter.pov`、`Chapter.location` 与通用世界事实词缀；所有条目仍经 `commit_story_state_changes()` 做 surface grounding 与 ledger projection。
  - story_state 硬失败转为 `story_state_conflict` JudgeIssue，并把质量分压到批准阈值以下，避免伪 clean。
  - `_record_summary_judge()`、串行 `run_book_generation()`、并发 `run_book_generation_parallel()` 的 progress 均记录 `story_state_commit` 摘要。
  - 新增 `.codex/context-summary-q1-state-grounding-bridge.md`；`test_book_generation.py` 断言真实生成入口会写入 `StoryStateEvent` / `StoryStateLedger`。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_book_generation_runs_one_chapter_and_records_evidence tests/test_book_generation.py::test_book_generation_fast_path_runs_semantic_advisory_when_local_gate_passes -q` → 2 passed。
  - `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_parallel.py tests/test_book_generation.py tests/test_book_generation_parallel.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py -q` → 43 passed。
  - `cd apps/api && uv run ruff check app/domains/story_state app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_parallel.py tests/test_story_state.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_alembic_heads.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_story_state.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_alembic_heads.py -q` → 53 passed，1 个既有 Alembic `path_separator` deprecation warning。
  - `git diff --check` → 通过。
- **未联通能力**：这仍不是最终 Writer 工具调用协议；当时尚未实现 LLM 语义 grounding、edge 类 CHANGES → `continuity_edges`、真相源填 `required_facts`、称谓一致性维度或 Q9 4 万字长程重跑；`required_facts` 真相源第一刀后续见「Q4 P0」。

## Q4 P0：story_state 真相源填 `required_facts`（2026-06-30）

- **目标**：消除 `_build_judge_payload()` 中 `required_facts=[]` 的假空转，把 Q1 已落库的 `StoryStateLedger` 当前态投影注入真实 judge payload，让 deterministic / semantic judge 在后续章节看到跨章已知事实。
- **变更**：
  - `book_generation_judge.py::_build_judge_payload()` 从 `StoryStateLedger` 读取当前 `book_run_id` 范围内的 `status` / `rule` / `phase` / `holder` / `location`，生成最多 20 条 `required_facts`。
  - 新增 `已知事实：` conflict-only 事实前缀：旧 required_facts 普通字符串仍保持“必须出现”语义；story_state 注入的已知事实只检查直接矛盾，不要求每章复述。
  - `deterministic_judge_fallback()` 支持 conflict-only 事实，避免前章状态在后续章节未复述时产生误报。
  - `evidence_links` 记录 `story_state_ledger` 来源，便于 audit 追踪。
  - 新增 `.codex/context-summary-q4-required-facts-story-state.md`；`test_book_generation.py` 覆盖真相源注入抓矛盾与 conflict-only 不误报缺失。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_book_generation_judge_payload_uses_story_state_required_facts tests/test_book_generation.py::test_conflict_only_story_state_fact_does_not_require_restatement -q` → 2 passed。
  - `cd apps/api && uv run ruff check app/domains/judge/deterministic.py app/domains/book_runs/book_generation_judge.py tests/test_book_generation.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py tests/test_judge_semantic.py tests/test_judge_failure_marker.py tests/test_judge_repair.py -q` → 59 passed。
  - `cd apps/api && uv run ruff check app/domains/judge/deterministic.py app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_parallel.py app/domains/story_state tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py tests/test_judge_semantic.py tests/test_judge_failure_marker.py tests/test_judge_repair.py` → All checks passed。
  - `git diff --check` → 通过。
- **未联通能力**：Q4 尚未完整完成；当时仍缺跨章语义新维度、称谓一致性 judge 维度、edge 类 CHANGES → `continuity_edges`、真实 LLM 工具化 CHANGES 与 Q9 4 万字长程重跑；edge 类提交后续见「Q1 P3」。

## Q1 P3：edge 类 CHANGES → `continuity_edges`（2026-06-30）

- **目标**：完成 `story-state-model-design.md` 中 edge/node 分流的第一版实现：relationship / timeline_order / status 这类结构边不写 `state_ledger`，而是进入已 live 的 `continuity_edges` 并复用其冲突检测。
- **变更**：
  - `CommitStoryStateResult` 新增 `edge_count`，记录本次 CHANGES 分流出的结构边数量。
  - `commit_story_state_changes()` 将 `relationship` / `timeline` / `timeline_order` / `status` 识别为 edge 类 CHANGES：先经 `ContinuityEdgeCandidate` + `check_edge_constraints()` 校验，通过后写 `ContinuityEdge`，payload 标记 `source=story_state`、`book_run_id`、`chapter_index`、`change_type`。
  - edge 类 CHANGES 仍写 `StoryStateEvent`，但不写 `StoryStateLedger`，保持 edge/node 不重叠。
  - edge 冲突转为 `StoryStateInvariantError`，整笔 rollback，不产生半写 event/edge/ledger。
  - `reproject_story_state()` 会删除当前 scope 下 story_state 来源的 `continuity_edges`，再按剩余事件重建，避免未来边残留或重复边。
  - 新增 `.codex/context-summary-q1-edge-changes.md`；`test_story_state.py` 覆盖正常分流、冲突回滚、reproject 重建。
- **本地验证**：
  - `cd apps/api && uv run ruff check app/domains/story_state tests/test_story_state.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_story_state.py -q` → 9 passed。
  - `cd apps/api && uv run pytest tests/test_story_state.py tests/test_continuity_edges.py tests/test_book_generation.py tests/test_book_generation_parallel.py -q` → 63 passed。
  - `cd apps/api && uv run ruff check app/domains/story_state app/domains/continuity tests/test_story_state.py tests/test_continuity_edges.py app/domains/book_runs/book_generation_judge.py app/domains/judge/deterministic.py tests/test_book_generation.py tests/test_book_generation_parallel.py` → All checks passed。
  - `git diff --check` → 通过。
- **未联通能力**：真实 Writer/LLM 工具化 CHANGES 尚未落地；当前 book generation 保守桥不主动生成复杂 relationship/timeline edge；`continuity_edges` 表无 `book_run_id` 列，story_state 来源的 run scope 暂存于 payload。

## Q1 P4：串行 runner Story Memory atoms 写入（2026-06-30）

- **目标**：对齐串行/并发真实生成入口。并发 runner 已在章节 approved 后写 Story Memory atoms，串行 CLI 长程路径此前只产生 BookContext/Judge/Audit 证据，不写 `memory_atom_ids`，导致 Q9 指定 CLI 路径的记忆链弱于并发路径。
- **变更**：
  - 新增 `book_generation_memory.py`，把章末本地 memory 抽取、Story Memory 写入、章节前召回字符统计下沉为共享 helper。
  - `book_generation_parallel.py` 改为复用共享 helper，并通过 `__all__` 保留旧私有 helper 导出供测试/扩展点使用。
  - `run_book_generation()` / `resume_book_generation()` 在生成前记录 `memory_recall_chars`，在章节批准后调用 `extract_memory_atoms_for_chapter()` 写入 Story Memory，并把 `memory_atom_ids` / `memory_recall_chars` 写入 `completed_chapters`。
  - 本地抽取摘要压短，确保串行 10 章 memory recall budget 真实大于 0 但仍低于既有 8000 字预算线。
  - 新增 `.codex/context-summary-q1-serial-memory.md`；`test_book_generation.py` 覆盖串行 1 章写 atoms 与 10 章记忆召回预算。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_book_generation_runs_one_chapter_and_records_evidence tests/test_book_generation.py::test_book_generation_runs_ten_chapters_with_word_targets tests/test_book_generation_parallel.py::test_parallel_memory_extracts_use_chapter_context_without_demo_terms tests/test_book_generation_parallel.py::test_book_generation_parallel_runner_extracts_and_recalls_story_memory -q` → 4 passed。
  - `cd apps/api && uv run pytest tests/test_story_state.py tests/test_continuity_edges.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_judge_semantic.py tests/test_judge_failure_marker.py tests/test_judge_repair.py -q` → 71 passed。
  - `cd apps/api && uv run ruff check app/domains/story_state app/domains/continuity app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_parallel.py app/domains/book_runs/book_generation_memory.py app/domains/book_runs/book_generation_judge.py app/domains/judge/deterministic.py tests/test_story_state.py tests/test_continuity_edges.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_judge_semantic.py tests/test_judge_failure_marker.py tests/test_judge_repair.py` → All checks passed。
  - `git diff --check` → 通过。
- **未联通能力**：这是本地 Story Memory 抽取桥，不是最终 Writer/LLM 工具化 CHANGES；resume 重建历史 completed_chapters 时暂未反查既有 memory atoms，后续新补章节会写入 atoms；Q9 真实长程仍需验证召回预算是否随章数膨胀。

## Q1 P5：LLM CHANGES JSON 通道（2026-06-30）

- **目标**：为最终 Writer/LLM CHANGES 提供第一条真实传输路径。模型可以在正文后输出可剥离的 `STORY_STATE_CHANGES` JSON 区块；后端解析后写入 ScenePacket，judge loop 优先消费模型 CHANGES，缺失时继续使用保守本地桥。
- **变更**：
  - 新增 `book_generation_changes.py`：`append_story_state_changes_instruction()` 在生成 prompt 末尾追加 CHANGES 输出协议；`extract_story_state_changes_from_content()` 从模型响应剥离 `【STORY_STATE_CHANGES】...【/STORY_STATE_CHANGES】` JSON 数组。
  - `_generate_chapter()` 调用上述 parser，成功时将结构化区块从正文移除，并在返回值携带 `story_state_changes`。
  - `_record_scene_packet()` 支持保存 `story_state_changes` 到 `ScenePacket.packet`。
  - `_commit_story_state_for_scene()` 优先读取 ScenePacket 中的 changes，再 fallback 到本地保守 CHANGES。
  - 测试 fake provider 改为返回合法 CHANGES block，验证 Scene 正文不含 block、StoryStateEvent 来自模型声明的 `character.status`。
  - 新增 `.codex/context-summary-q1-llm-changes-channel.md`。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_story_state_changes_block_is_stripped_from_generated_content tests/test_book_generation.py::test_book_generation_runs_one_chapter_and_records_evidence tests/test_book_generation.py::test_book_generation_runs_ten_chapters_with_word_targets -q` → 3 passed。
  - `cd apps/api && uv run pytest tests/test_story_state.py tests/test_continuity_edges.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_judge_semantic.py tests/test_judge_failure_marker.py tests/test_judge_repair.py -q` → 72 passed。
  - `cd apps/api && uv run ruff check app/domains/story_state app/domains/continuity app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_parallel.py app/domains/book_runs/book_generation_memory.py app/domains/book_runs/book_generation_changes.py app/domains/book_runs/book_generation_records.py app/domains/book_runs/book_generation_judge.py app/domains/judge/deterministic.py tests/test_story_state.py tests/test_continuity_edges.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_judge_semantic.py tests/test_judge_failure_marker.py tests/test_judge_repair.py` → All checks passed。
  - `git diff --check` → 通过。
- **未联通能力**：这不是最终 tool-call 协议；当时仍缺 schema retry、花名册稳定 ID 选择器、LLM 语义 grounding、跨章语义新维度、称谓一致性 judge 维度与 Q9 4 万字重跑；schema retry/稳定 ID 后续见「Q1/Q4 P6」，称谓/17-18 章时间线基线后续见「Q7」。

## Q7：称谓一致性 judge 维度 + 17/18 章时间线回归（2026-06-30）

- **目标**：闭合计划中 Q7 的第一版确定性基线：真实 judge 链路能发现人物称谓漂移，并用第 17 章事实约束第 18 章时间线。
- **变更**：
  - `judge.consistency.py` 新增 `_detect_character_alias_conflicts()`：读取 Character Bible 的 `canonical_name` / `aliases`，在同句同时出现 canonical 与未登记同姓称谓时输出 `character_addressing_conflict`。
  - `judge.service.create_judge_issues()` 与 `book_generation_judge._run_real_judge()` 均接入称谓一致性检测；`_CATEGORY_DIMENSION` 将 `character_addressing_conflict` 映射到 `character_consistency`。
  - 新增 `test_judge_flags_unregistered_character_addressing_drift`：`林岚` 同句被叫成未登记 `林医生` 时输出称谓问题，并建议替换为 Character Bible 登记别名 `林调查员`。
  - 新增 `test_judge_detects_chapter_18_timeline_conflict_from_chapter_17_fact`：第 17 章 Story Memory 记录“午夜在雾港”，第 18 章正文写“午夜在荒原城”，应输出 `timeline_conflict`。
  - 新增 `.codex/context-summary-q7-addressing-timeline.md`。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_judge_character_consistency.py::test_judge_flags_unregistered_character_addressing_drift tests/test_judge_timeline_consistency.py::test_judge_detects_chapter_18_timeline_conflict_from_chapter_17_fact -q` → 2 passed。
  - `cd apps/api && uv run pytest tests/test_judge_character_consistency.py tests/test_judge_timeline_consistency.py tests/test_timeline_consistency.py tests/test_book_generation.py tests/test_book_generation_parallel.py -q` → 52 passed。
  - `cd apps/api && uv run ruff check app/domains/judge/consistency.py app/domains/judge/service.py app/domains/book_runs/book_generation_judge.py tests/test_judge_character_consistency.py tests/test_judge_timeline_consistency.py tests/test_timeline_consistency.py tests/test_book_generation.py tests/test_book_generation_parallel.py` → All checks passed。
  - `git diff --check` → 通过。
- **未联通能力**：称谓检查是确定性窄口径，不覆盖所有亲属称谓/同姓角色/语义别称；17/18 基线证明跨章事实可触发 judge，不等同整书人工通读通过；Q9 仍未跑。

## Q8：长程可观测性 Prometheus 指标（2026-06-30）

- **目标**：让真实长程生成路径的逐章 judge/repair/failure/cost 信号进入 `/metrics`，避免 Q9 只靠离线 summary 才能看出长跑健康度。
- **变更**：
  - `app/common/metrics.py` 新增 `book_generation_failure_count_total`、`book_generation_cost_cny_total`、`observe_book_generation_chapter()`、`observe_book_generation_failure()`。
  - `_judge_and_repair_loop()` 返回 `judge_call_count`，每轮 `_run_real_judge()` 都计入，repair 重试不再被压成单次。
  - 串行 `run_book_generation()` 与 `resume_book_generation()` 在每章 judge loop 后 emit `judge_calls_total`、`repair_patches_total`、`book_generation_cost_cny_total`，并在 `completed_chapters` 写入 `judge_call_count`。
  - 并发 `run_book_generation_parallel()` 的 precommit 校正路径使用同一章节观测 helper，并把 `judge_call_count` 合入章节 progress。
  - `_pause_by_failure()` 递增 `book_generation_failure_count_total`；`_chapter_metric()` 将 `judge_call_count` 写入 summary per-chapter metrics。
  - `tests/test_metrics.py` 覆盖 `/metrics` 暴露新指标与 helper 计数语义；`tests/test_book_generation.py` 覆盖真实一章生成推动 judge/cost counter、失败暂停推动 failure counter。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_metrics.py tests/test_book_generation.py tests/test_book_generation_parallel.py -q` → 50 passed。
  - `cd apps/api && uv run ruff check app/common/metrics.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation_parallel.py app/domains/book_runs/book_generation_progress.py app/domains/book_runs/book_generation_metrics.py tests/test_metrics.py tests/test_book_generation.py tests/test_book_generation_parallel.py` → All checks passed。
- **未联通能力**：Q8 只完成可观测性，不等同 Q9；尚未跑真实 4 万字长程、resume/预算暂停实战演练、人工盲评或 artifact sha256 登记。指标有意不携带 `book_run_id` / `chapter_index` 标签，逐章细节仍以 BookRun progress / summary.json 为准。

## Q1/Q4 P6：稳定 ID 花名册 + CHANGES schema retry（2026-06-30）

- **目标**：把 Q1/Q4 设计中的“花名册挑稳定 ID + schema 校验重试”接到真实生成路径，减少模型自由名漂移和 CHANGES JSON 结构错导致的状态链断粮。
- **变更**：
  - `book_generation_changes.py` 新增 `StoryStateRosterEntry`、`stable_story_state_entity_id()`、`build_story_state_roster()`、`normalize_story_state_changes_with_roster()`、`validate_story_state_change_dicts()`。
  - `_generate_chapter()` 在 prompt 里注入 `故事状态花名册`，来源为当前 `StoryStateLedger`、Character Bible、本章 POV 与地点；串行、resume、并发 precommit 均传入 `book_run_id` 以读取 run-scoped ledger。
  - 模型返回自由名 CHANGES（如 `entity_id=沈砚`）时，后端提交前归一为稳定 ID（如 `character:<hash>`），并保留 `canonical_name` / `aliases` 供 grounding 与 audit 阅读。
  - CHANGES schema 不合格时新增 `_retry_story_state_changes_schema()`，只要求模型修正 JSON 数组，不重写章节正文；重试结果仍经花名册归一和 `StateChangeInput` 校验。
  - `test_book_generation.py` 新增 prompt 花名册/稳定 ID 归一、schema retry 只修 JSON 的回归；真实一章生成测试改为断言 `StoryStateEvent` / `StoryStateLedger` 使用稳定 ID。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py -q` → 58 passed。
  - `cd apps/api && uv run pytest tests/test_metrics.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py -q` → 61 passed。
  - `cd apps/api && uv run ruff check app/common/metrics.py app/domains/book_runs/book_generation_changes.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation_parallel.py app/domains/book_runs/book_generation_progress.py app/domains/book_runs/book_generation_metrics.py tests/test_metrics.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py` → All checks passed。
- **未联通能力**：这仍不是 OpenAI function/tool-call transport，当前继续兼容 `STORY_STATE_CHANGES` JSON block；语义 grounding 仍未接入，schema retry 只保证结构合法，不判断 delta 语义是否被正文充分支撑；Q9 真实 4 万字长程仍未执行。

## Q1/Q4 P7：LLM 语义 grounding advisory（2026-06-30）

- **目标**：补齐 `story-state-model-design.md` 中 grounding 的第二层咨询信号：确定性 surface grounding 负责反捏造，LLM 语义 grounding 判断 CHANGES delta 是否被正文语义支持，但不作为硬门禁。
- **变更**：
  - `StoryStateGroundingResult` 新增 `semantic_reason`。
  - 新增 `story_state/semantic.py`：`semantic_ground_story_state_changes()` 复用 `STORYFORGE_JUDGE_LLM_*`（回退 `STORYFORGE_LLM_*`），要求模型只返回每条 CHANGES 的 `seq`、`score`、`reason`。
  - `commit_story_state_changes()` 新增可注入 `semantic_grounder`，把 advisory 的 `semantic_status=advisory`、`semantic_score`、`semantic_reason` 写入 `StoryStateEvent.grounding`；grounder 异常只写 `semantic_grounding_failed`，不回滚确定性通过的提交。
  - `_commit_story_state_for_scene()` 在真实生成路径传入 `semantic_ground_story_state_changes()`。
  - `tests/test_story_state.py` 新增语义 grounding 分数落库、grounder 异常不阻断提交的回归；fast judge advisory 测试更新为期望章节语义 judge + story_state semantic grounding 两次语义 LLM 调用。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_story_state.py tests/test_book_generation.py tests/test_book_generation_parallel.py -q` → 60 passed。
  - `cd apps/api && uv run ruff check app/domains/story_state/schemas.py app/domains/story_state/service.py app/domains/story_state/semantic.py app/domains/book_runs/book_generation_judge.py tests/test_story_state.py tests/test_book_generation.py tests/test_book_generation_parallel.py` → All checks passed。
- **未联通能力**：语义 grounding 仍为 advisory，不硬断、不触发 repair；真正 function/tool-call transport 与跨章语义新维度仍未实现；Q9 真实 4 万字长程仍未执行。

## Q5：参数化章节阈值 + API 系统词检测（2026-06-30）

- **目标**：移除真实长程前置路径中的 30 章固定阶段边界和 CLI 10 章固定上限，并把退回 blocker 中的系统/流程词泄漏检测接到 API 真实 judge 路径。
- **变更**：
  - `book_runs.dispatch._default_phase_policy(total_chapters)` 按实际章数派生默认阶段：30 章保持历史 1-6 / 7-15 / 16-24 / 25-30；18 章变为 1-4 / 5-9 / 10-14 / 15-18。
  - `book_generation_cli.py` 新增 `--max-chapter-count`，默认 30；`book_generation_preflight.resolved_llm_env()` 支持 `STORYFORGE_LLM_SMOKE_MAX_CHAPTER_COUNT`，Q9 16-18 章 band 不再被旧 10 章默认上限拦住。
  - `judge.types` 新增 API 侧 `FORBIDDEN_DRAFT_TERMS`；`deterministic_judge_fallback()` 输出 `forbidden_draft_term`，覆盖 `Phase` / `测试` / `workflow` / `模型` / `审计链` 等系统词。
  - `book_generation_judge._CATEGORY_DIMENSION` 将 `forbidden_draft_term` 归入 `style_consistency`。
  - 测试新增 18 章 phase policy 缩放、Q9 CLI band 上限参数化、API 系统词检测回归。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_deterministic_judge_flags_forbidden_draft_system_terms tests/test_book_generation.py::test_book_generation_cli_allows_q9_chapter_band_with_parameterized_cap tests/test_book_run_workflow_dispatch.py -q` → 18 passed。
  - `cd apps/api && uv run ruff check app/domains/judge/types.py app/domains/judge/deterministic.py app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation_cli.py app/domains/book_runs/book_generation_preflight.py app/domains/book_runs/dispatch.py tests/test_book_generation.py tests/test_book_run_workflow_dispatch.py` → All checks passed。
- **未联通能力**：HTTP `/api/book-runs/{id}/start` 的 6 章后台安全闸仍保留；Q9 按 DoD 走 CLI 长程路径。API 系统词检测是自包含实现，没有 import workflow `ForbiddenDraftTermsFilter`，也不代表完整 workflow narrative guard 已接入真实路径。

## Q6：整书级叙事终检 advisory audit（2026-06-30）

- **目标**：在 `audit_report.json` 导出时补一层整书级咨询式终检，覆盖逐章 judge 看不到的章数完整性、系统词残留、模板化开头、未回收 story_state 项与最终章收束信号；该信号只进入审计报告，不作为导出硬门禁。
- **变更**：
  - `export_book_run_audit_report()` 新增 `full_book_advisory_audit`，并把状态同步到 `quality_summary.full_book_advisory_status`。
  - 新增 5 个可解释 check：`chapter_count_integrity`、`forbidden_draft_terms`、`repeated_openings`、`story_state_open_items`、`final_chapter_resolution_signal`。
  - `story_state_open_items` 读取 `StoryStateEvent` / `StoryStateLedger`：没有事件源时返回 `unavailable`，有未回收 foreshadow/conflict/countdown/oath 时返回 `needs_review`。
  - 终检异常返回 `status=error`，`hard_gate=false`；不会阻断 `audit_report.json` 导出。
  - 最终章收束信号避免把 `没结束` / `未结束` 等否定短语误判为正向收束。
  - `tests/test_book_exporter.py` 覆盖 advisory 结构、needs_review 不阻断导出、StoryState 缺失为 `unavailable` 而非伪 pass。
  - 生成测试 fixture 将假正文里的“真实模型章节正文”改为“真实章节正文”，避免 Q5 系统词检测把测试夹具自身判为 `forbidden_draft_term`；`_draft_requests()` 同步排除 StoryState semantic grounding 请求。
  - 新增 `.codex/context-summary-q6-full-book-advisory-audit.md`。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_exporter.py -q` → 7 passed。
  - `cd apps/api && uv run ruff check app/domains/exports/book_markdown_exporter.py tests/test_book_exporter.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_book_generation_runs_one_chapter_and_records_evidence tests/test_book_generation.py::test_book_generation_fast_path_runs_semantic_advisory_when_local_gate_passes tests/test_book_generation.py::test_book_generation_resume_continues_after_existing_approved_chapters -q` → 3 passed。
  - `cd apps/api && uv run pytest tests/test_book_exporter.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_run_recorded_skill_runs_export.py tests/test_phase9a_deterministic_smoke.py -q` → 61 passed。
  - `cd apps/api && uv run ruff check app/domains/exports/book_markdown_exporter.py tests/test_book_exporter.py tests/test_book_generation.py` → All checks passed。
- **环境修复记录**：验证中发现本地 venv 的 `httpcore/_backends/__init__.py` 与 RECORD 不一致（应为空文件，却被写成 trio backend 内容），导致真实 `httpx` 请求报 `No module named 'trio'` 并污染生成测试。已执行 `cd apps/api && uv pip install --force-reinstall httpcore==1.0.9` 修复本地环境；未改项目依赖。
- **未联通能力**：Q6 是静态/确定性 advisory 第一版，不等同人工通读；未接 workflow narrative guard；未跑 Q9 真实 4 万字长程、resume/预算暂停实战演练、人工盲评或 artifact sha256 登记。真正 function/tool-call transport 与更广的跨章语义维度仍未完成。

## Q1/Q4 P8：OpenAI-compatible tool-call transport（2026-06-30）

- **目标**：把 StoryState CHANGES 从正文尾部 JSON block 升级为 OpenAI-compatible `tools/tool_calls` 结构化传输第一版，同时保留 JSON block fallback，避免 provider 能力差异导致状态链断粮。
- **变更**：
  - `_call_llm()` 新增可选 `tools` / `tool_choice` 入参，请求 payload 会透传给 chat/completions；响应中的 `message.tool_calls` 被规整为 `result["tool_calls"]`。
  - `book_generation_changes.py` 新增 `STORY_STATE_CHANGES_TOOL_NAME=record_story_state_changes`、`story_state_changes_tools()`、`extract_story_state_changes_from_tool_calls()`。
  - `_generate_chapter()` 默认发送 `record_story_state_changes` tool schema；同时返回 tool call 与正文 JSON block 时优先采用 tool call；`STORYFORGE_LLM_STORY_STATE_TOOL_CALLS=0/false/no/off` 可关闭并回退 JSON block。
  - tool call 结果仍经花名册稳定 ID 归一、`StateChangeInput` schema 校验和 schema retry；不绕过 Q1/Q4 P6/P7 的 grounding 规则。
  - `_record_scene_packet()`、ModelRun payload、completed chapter progress 记录 `story_state_changes_source` / `story_state_tool_call_count`，便于 Q9 审计实际通道。
  - `tests/test_book_generation_llm_retry.py` 覆盖 `_call_llm` 发送 tools/tool_choice 并保留 tool_calls；`tests/test_book_generation.py` 覆盖 tool call 提取以及 `_generate_chapter()` 优先采用 tool call。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation_llm_retry.py tests/test_book_generation.py::test_story_state_changes_tool_calls_are_extracted tests/test_book_generation.py::test_generate_chapter_prefers_story_state_tool_calls -q` → 7 passed。
  - `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_llm.py app/domains/book_runs/book_generation_changes.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_records.py app/domains/book_runs/book_generation_parallel.py tests/test_book_generation_llm_retry.py tests/test_book_generation.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_generation_llm_retry.py tests/test_story_state.py -q` → 69 passed。
  - `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_llm.py app/domains/book_runs/book_generation_changes.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_records.py app/domains/book_runs/book_generation_parallel.py tests/test_book_generation_llm_retry.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py` → All checks passed。
- **未联通能力**：未对真实外部 provider 做 tool-call 兼容性探针；Q9 前仍需用目标模型确认 `tools` 支持，若不支持则显式设置 `STORYFORGE_LLM_STORY_STATE_TOOL_CALLS=0` 使用 JSON block fallback。跨章语义新维度仍未完成，Q9 真实 4 万字长程仍未执行。

## Q4 P1：跨章语义 judge 维度（2026-06-30）

- **目标**：让 semantic judge 不只判断单章 setting/timeline/relationship/style/voice，而能理解 Q1/Q4 已提供的跨章 story_state / memory / evidence_links 事实，输出可归类的跨章语义问题。
- **变更**：
  - `judge.semantic._JUDGE_SYSTEM_PROMPT` 新增四类跨章语义 category：
    - `cross_chapter_state_conflict`：正文与跨章 story_state / memory 事实矛盾。
    - `foreshadow_payoff_gap`：正文声称回收/解决/遗忘伏笔但与伏笔状态不匹配。
    - `arc_continuity_drift`：本章推进偏离已知主线弧线、倒计时或承诺且缺少过渡。
    - `repetition_echo`：本章复用前章开头、段落或系统化句式。
  - `semantic_judge_with_status()` 的 user prompt 新增 `证据链接：{payload.evidence_links}`，让 story_state_ledger / memory / planning 证据进入远程 Judge 上下文。
  - `_CATEGORY_DIMENSION` 映射新增上述类别，真实生成 progress / audit 的 `quality_issues[*].dimension` 可归入 `world_consistency`、`narrative_quality` 或 `style_consistency`。
  - `tests/test_judge_semantic.py` 新增 provider 返回跨章类别的解析回归，并断言远程请求 system prompt 含跨章类别、user prompt 含 `story_state_ledger` evidence。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_judge_semantic.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py -q` → 70 passed。
  - `cd apps/api && uv run ruff check app/domains/judge/semantic.py app/domains/book_runs/book_generation_judge.py tests/test_judge_semantic.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py` → All checks passed。
- **未联通能力**：这是 semantic prompt/分类第一版，不等同真实长程质量已验证；Q9 前仍需用真实 provider 观察这些类别的误报/漏报。未接 workflow narrative guard；未做人工盲评。

## Q9：长程验收本地结构门禁复验与真实阻塞（2026-06-30）

- **目标**：在真实凭证缺失时，至少复验 Q9 wrapper / evidence validator 的本地结构门禁，并明确记录不能伪完成真实 4 万字长跑。
- **环境预检**：
  - `STORYFORGE_LLM_API_KEY`：missing。
  - `STORYFORGE_LLM_BASE_URL`：missing。
  - `STORYFORGE_LLM_MODEL`：missing。
  - `STORYFORGE_LLM_PROVIDER`：missing。
  - `STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD`：missing。
  - `STORYFORGE_ALLOW_DIRECT_SERIAL_PH5`：missing。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation_long_wrapper.py tests/test_real_llm_long_evidence_validator.py -q` → 22 passed。
  - `cd apps/api && uv run ruff check tests/test_book_generation_long_wrapper.py tests/test_real_llm_long_evidence_validator.py` → All checks passed。
- **结论**：
  - 长程 wrapper / validator 的本地结构门禁仍可用，覆盖敏感值扫描、outer timeout、quality gate、artifact hashes、EPUB/cost breakdown、resume 目录复制、manual-readthrough gate 等。
  - Q9 真实 4 万字长跑未执行，不能视为完成：缺真实 provider 配置、成本确认、真实 tool-call provider 探针、resume/预算暂停实战演练、人工盲评与 artifact sha256 登记。
  - 产品轨 P1 / F1b 仍未交付：当前约束为不触碰 `apps/web`，P1 还依赖真实 Tauri + 真模型按钮路径，F1b 还依赖 P1/Q9 真实结论。

### Q9 结构门禁增强：Q6/P8 证据纳入验收（2026-06-30）

- **目标**：避免 Q9 真实产物只凭章节分数和 artifact hash 过关，必须同时证明 Q6 整书 advisory 已落盘、StoryState changes 传输来源可审计。
- **变更**：
  - `summary.json.per_chapter_metrics` 透出 `story_state_changes_source` / `story_state_tool_call_count`，与 `audit_report.json.chapters` 互为证据。
  - `.codex/run-real-llm-long-direct.py` 的运行后门禁读取 audit payload，要求 `full_book_advisory_audit` 存在、`hard_gate=false`、`quality_summary.full_book_advisory_status` 存在，并要求至少一章有非 `none` 的 `story_state_changes_source`。
  - `.codex/validate-real-llm-long-evidence.ps1` 对落盘产物执行同类校验；默认接受 `tool_call` 或 `json_block` 来源，新增 `-RequireToolCallStoryStateChanges` 用于真实 provider tool-call 严格探针。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_book_generation.py::test_book_generation_supports_api_key_auth_and_cost_breakdown tests/test_book_generation.py::test_book_generation_cli_writes_redacted_summary_file tests/test_book_generation.py::test_generate_chapter_prefers_story_state_tool_calls -q` → 3 passed。
  - `cd apps/api && uv run pytest tests/test_book_generation_long_wrapper.py -q` → 16 passed。
  - `cd apps/api && uv run pytest tests/test_real_llm_long_evidence_validator.py -q` → 12 passed。
  - `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_real_llm_long_evidence_validator.py tests/test_book_exporter.py -q` → 76 passed。
  - `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_metrics.py tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_real_llm_long_evidence_validator.py` → All checks passed。
  - PowerShell parser check for `.codex/validate-real-llm-long-evidence.ps1` → `parse-ok`。
- **未联通能力**：仍未执行真实 provider tool-call 探针、真实 4 万字长跑、resume/预算暂停实战演练或人工盲评；本增强只提高 Q9 证据门槛，不能替代 Q9。

## F1a：文档事实源收敛（2026-06-30）

- **目标**：先收口不依赖真实 P1/Q9 运行的新旧文档矛盾，避免 TODO/README 把脚本级 Tauri 写回 smoke 误宣称为完整真实桌面端到端验收。
- **变更**：
  - `docs/internal/TODO.md` 将“真实 Tauri 写回端到端”改为“写回护栏已有脚本级 smoke 证据，完整人工桌面端到端仍待执行”，并把第一阶段链路改成组件链路而非最终验收。
  - `docs/internal/current-phase.md` 补充重构总计划已完成当前合理边界，后续不再做纯机械 god-file 拆分；仍将完整真实 Tauri 桌面端到端列为未完成验收项。
  - `README.md` 同步对外能力边界，明确不能宣称完整真实 Tauri 桌面端到端写回验收已完成。
  - `tests/test_phase9_fact_sources.py` 新增 `_section()` 语义块守卫，检查 TODO 的“已验证/待执行”边界和 current-phase 的重构边界，减少对单个散落字符串的脆性依赖。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_phase9_fact_sources.py -q` → 14 passed。
  - `cd apps/api && uv run ruff check tests/test_phase9_fact_sources.py` → All checks passed。
- **未联通能力**：F1a 只解决文档事实源矛盾与守卫语义化；P1 仍未交付，F1b 终稿仍依赖完整真实 Tauri 端到端和 Q9 真实长程结论。

## 产品轨 P2：CJK 句/子句级 diff + hunk 级冲突容忍（2026-06-30）

- **目标**：解决中文长段落被行级 diff 合成巨型 hunk、以及接受一个 hunk 后整文件门控导致剩余 hunk 全部失效的问题。
- **变更**：
  - `patch-hunks.ts` 保留既有行号/增删行字段，新增 `originalStartOffset` / `originalEndOffset` / `modifiedStartOffset` / `modifiedEndOffset`、`unitKind`、原文前后文，作为逐 hunk 安全定位证据。
  - CJK 行内 diff 现在按 `。！？；，、：` 等句/子句边界拆 segment；普通文本和单 segment 行继续保持行级 hunk 行为。
  - 新增 `applyPatchHunkToCurrent(currentContent, hunk)`：优先按原 offset 验证，offset 漂移时用 hunk 原文与前后文重新定位；原文缺失或多处歧义时抛出单 hunk 冲突。
  - `useSuggestionWriteback.ts` 的分块接受改为基于当前编辑器内容应用单个 hunk；接受前一块后仍可继续接受剩余块。整文件接受仍保留 `currentContent === suggestion.before` 硬闸。
  - `patch-hunks.test.ts` 新增单行中文多处修改拆分、逐块接受、插入型 hunk offset 漂移重定位、局部冲突拒绝回归；`editor.test.tsx` 新增源码守卫，防止分块接受退回整文件门控。
- **本地验证**：
  - `cd apps/desktop/frontend && pnpm.cmd run test -- patch-hunks editor` → 13 passed（React SSR `useLayoutEffect` warning 为既有测试环境提示，命令退出 0）。
  - `cd apps/desktop/frontend && pnpm.cmd run typecheck` → 通过。
  - `cd apps/desktop/frontend && pnpm.cmd run test` → 81 passed（同上有既有 React SSR warning，命令退出 0）。
  - `git diff --check -- apps/desktop/frontend/src/lib/patch-hunks.ts apps/desktop/frontend/src/components/editor/useSuggestionWriteback.ts apps/desktop/frontend/tests/patch-hunks.test.ts apps/desktop/frontend/tests/editor.test.tsx` → 通过。
- **未联通能力**：P2 第一版只覆盖本地 desktop frontend 单元和源码守卫；未执行真实 Tauri 人工按钮路径，也不代表 P1 完整桌面端到端写回验收完成。P3/P4 后续见下方章节；Q9 真实长程仍未完成。

## 产品轨 P3：Provider 运行时真相源收敛 + 明文密钥防持久化（2026-06-30）

- **目标**：消除桌面 localStorage Provider 设置与后端真实 LLM env 之间的 split-brain 误导，并守住“密钥严禁经前端流转”的边界。
- **变更**：
  - `describeProviderConnection()` 不再根据本机 `apiKeyRef` 显示“缺少密钥引用/模型服务已配置”，统一显示“后端环境变量控制模型服务”，避免把 localStorage 字段误读为后端运行时真相源。
  - `SettingsView` 将模型服务字段文案改成“本机偏好/参考显示”，新增 `provider-runtime-env-source` 行，明确真实调用只读取 `STORYFORGE_LLM_PROVIDER` / `STORYFORGE_LLM_BASE_URL` / `STORYFORGE_LLM_MODEL` / `STORYFORGE_LLM_API_KEY`。
  - `probeProviderHealth()` 仍只调用后端 `/api/assistant/provider-health`，设置页说明它探测 `resolved_llm_env`，不会读取本页 localStorage。
  - `sanitizeAppSettings()` 对 `apiKeyRef` 只保留环境变量名或 `vault://` 引用，丢弃疑似明文密钥，避免历史或手输 secret 被持久化到 localStorage。
  - `provider-config.test.ts`、`editor.test.tsx`、`app-icons.test.tsx` 增加/更新守卫，锁定后端 env 真相源与明文密钥防持久化语义。
- **本地验证**：
  - `cd apps/desktop/frontend && pnpm.cmd run test -- provider-config editor app-icons patch-hunks` → 22 passed（React SSR `useLayoutEffect` warning 为既有测试环境提示，命令退出 0）。
  - `cd apps/desktop/frontend && pnpm.cmd run typecheck` → 通过。
  - `cd apps/desktop/frontend && pnpm.cmd run test` → 83 passed（同上有既有 React SSR warning，命令退出 0）。
  - `git diff --check` → 通过。
- **未联通能力**：P3 第一版不配置真实 provider、不验证真实密钥，也不改变后端 `_call_llm()` 的 env 读取方式；Q9 的真实 provider tool-call 探针和 4 万字长跑仍未执行。P1 真实 Tauri 按钮路径仍未交付；P4 后端流式第一版见下一节。

## 产品轨 P4：后端 WebSocket AgentRun 实时事件桥接（2026-06-30）

- **目标**：修正 IDE Agent WebSocket `stream=true` 旧路径“同步跑完整个 runtime 后再投影中间事件”的假流式问题，让持久化 `AgentRunEvent` 写库后即可推送到前端。
- **变更**：
  - `_AgentRunEventSink` 新增可选 `on_event` 回调，在 `agent_plan_created`、`tool_trace`、`permission_required`、`agent_artifact`、`system_job`、`agent_run_completed`、`agent_run_failed` 等事件写入后触发；事件事实源仍是数据库，不新增并行运行状态。
  - `run_agent_user_message()` / `execute_agent_user_message_run()` 保持 facade 入口不变，只新增可选 `on_event` 参数；WebSocket 路由仍不直接串联 start/execute 细节。
  - `event_encoders.py` 新增 `websocket_stream_events_from_agent_event()`，把 durable event 编码为现有 IDE stream 消息：`agent_run_started`、`agent_step`、`tool_trace`、`permission_required`；未改变 REST/SSE snapshot 语义。
  - `/api/ide/agent/sessions/{session_id}` 的 `stream=true` 分支改为在 worker thread 内运行同步 AgentRuntime，线程内使用独立 SQLAlchemy session，事件回调通过 `asyncio.Queue` 回到 WebSocket；最终仍发送完整 `agent_result`。
  - `test_agent_user_message_streams_runtime_events_before_result` 使用 threading gate 卡住后续 `file.review`，断言 `context.load` 的 `tool_trace` 已在最终 `agent_result` 前抵达 WebSocket，证明不是完成后回放。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py::test_agent_user_message_file_review_can_stream_intermediate_events tests/test_ide_agent_orchestrator.py::test_agent_user_message_streams_runtime_events_before_result tests/test_ide_agent_orchestrator.py::test_agent_user_message_stream_error_carries_run_id tests/test_agent_runs.py::test_websocket_user_message_enters_through_runtime_facade -q` → 4 passed。
  - `cd apps/api && uv run ruff check app/domains/agent_runs/event_sink.py app/domains/agent_runs/event_encoders.py app/domains/agent_runs/service.py app/domains/ide/router.py tests/test_ide_agent_orchestrator.py tests/test_agent_runs.py` → All checks passed。
  - `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_agent_runs.py -q` → 85 passed。
- **未联通能力**：P4 第一版没有把 AgentRuntime 内部工具/子代理执行体改成 native async；只是把同步 runtime 放入 worker thread，并把持久化事件实时桥接到 WebSocket。未跑真实 Tauri UI 观察或真模型长耗时流式体验；P1 与 Q9 仍需真实环境验收。

## Quick Win：Desktop Agent/Tauri smoke 接入默认桌面门禁（2026-06-30）

- **目标**：让计划中的 `verify-agent-conversation.mjs` / `verify-tauri-smoke.mjs` 不再只是手动命令，而是进入默认 `test:desktop` / desktop verify 聚合，避免 Agent 链路 wiring 和 Tauri 写回 smoke 漏跑。
- **变更**：
  - 根 `package.json` 的 `test:desktop` 改为 `npm --prefix apps/desktop run verify`。
  - `apps/desktop/package.json` 的 `verify` 增加 `npm --prefix frontend run verify:agent-conversation`，并继续执行 `verify:tauri-smoke`。
  - `apps/desktop/frontend/scripts/verify-unit.mjs` 的临时目录清理增加 `maxRetries` / `retryDelay`，修复 Windows 下单测已通过但 `rmSync()` 遇到短暂 `EBUSY` 导致整条门禁失败的问题。
- **本地验证**：
  - `npm --prefix apps/desktop/frontend run test` → 83 passed（React SSR `useLayoutEffect` warning 为既有测试环境提示，命令退出 0）。
  - `npm --prefix apps/desktop run verify` → 通过；覆盖 frontend typecheck、83 个前端单测、frontend build、`verify:smoke`、`verify:agent-conversation`、9 个 Rust tests、`verify:tauri-smoke`。
- **未联通能力**：该门禁提升只证明脚本级 browser/Tauri smoke 进入默认 desktop 验证；仍不能替代 P1 的完整真实 Tauri + 真模型人工按钮路径验收。

## Quick Win：`修选中 issue` 当前报告存在性校验（2026-06-30）

- **目标**：防止编辑器内旧 issue 标记或跨文件标记触发 `修选中问题` 时，ChatWindow 按过期 id 发起定向修订，改错当前目标。
- **变更**：
  - `review.ts` 新增 `reviewIssueForCurrentFile()`，统一校验 issue id 非空、审稿报告文件与当前文件一致、id 存在于当前审稿报告。
  - `ChatWindow.tsx` 的 `REVISE_ISSUE_EVENT` 入口改为调用该校验函数；缺当前文件、跨文件、旧 id 或不存在 id 均直接忽略。
  - `chat-window.test.ts` 新增回归，覆盖同一文件 slash 差异可匹配、跨文件拒绝、缺失 id 拒绝和缺当前文件拒绝。
- **本地验证**：
  - `npm --prefix apps/desktop/frontend run test -- chat-window` → 18 passed。
  - `npm --prefix apps/desktop/frontend run typecheck` → 通过。
  - `npm --prefix apps/desktop/frontend run test` → 84 passed（React SSR `useLayoutEffect` warning 为既有测试环境提示，命令退出 0）。
- **未联通能力**：这是桌面前端本地逻辑守卫，不替代 P1 的完整真实 Tauri + 真模型人工按钮路径验收；未改路由或 schema，因此无需刷新 OpenAPI。

## Quick Win：应用内模态替换原生 prompt/alert/confirm（2026-06-30）

- **目标**：统一桌面 React/Tauri 当前入口的新建文件、文件已存在确认、错误提示、分支命名和关闭未保存确认体验，避免原生 `prompt/alert/confirm` 打断应用内工作流。
- **变更**：
  - 新增 `components/app/AppDialog.tsx`，提供 `useAppDialog()` 与 `AppDialogHost`，支持 alert / confirm / prompt 三类应用内模态。
  - `App.tsx` 的新建文件、文件已存在确认、新建失败、初始化失败改为走应用内模态。
  - `Editor.tsx` 的保存失败、新分支命名、关闭未保存确认改为走同一应用内模态；`RightWorkspace` 透传 dialog API。
  - 删除遗留且未加载的 `src/main.ts` 旧 DOM 入口；`index.html` 仍只加载 `src/main.tsx`，`tsconfig.json` 移除对应 dead exclude。
  - `editor.test.tsx` 新增源码守卫，确认当前 React 桌面入口不再调用原生 `window.prompt` / `window.alert` / `window.confirm`。
- **本地验证**：
  - `npm --prefix apps/desktop/frontend run typecheck` → 通过。
  - `npm --prefix apps/desktop/frontend run test -- editor app-icons` → 10 passed（React SSR `useLayoutEffect` warning 为既有测试环境提示，命令退出 0）。
- **未联通能力**：该 Quick Win 只覆盖当前有效 React/Tauri 桌面入口与本地渲染/源码守卫；不替代 P1 的完整真实 Tauri + 真模型人工按钮路径验收。未改路由或 schema，因此无需刷新 OpenAPI。

## 本轮最终组合回归（2026-06-30）

- `cd apps/api && uv run pytest tests/test_book_exporter.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_generation_llm_retry.py tests/test_story_state.py tests/test_judge_semantic.py tests/test_metrics.py tests/test_book_generation_long_wrapper.py tests/test_real_llm_long_evidence_validator.py tests/test_book_run_recorded_skill_runs_export.py tests/test_phase9a_deterministic_smoke.py tests/test_ide_agent_orchestrator.py tests/test_agent_runs.py -q` → 201 passed。
- `cd apps/api && uv run ruff check app/domains/exports/book_markdown_exporter.py app/domains/book_runs/book_generation_llm.py app/domains/book_runs/book_generation_changes.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_records.py app/domains/book_runs/book_generation_parallel.py app/domains/book_runs/book_generation_judge.py app/domains/judge/semantic.py app/domains/agent_runs/event_sink.py app/domains/agent_runs/event_encoders.py app/domains/agent_runs/service.py app/domains/ide/router.py tests/test_book_exporter.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_generation_llm_retry.py tests/test_story_state.py tests/test_judge_semantic.py tests/test_metrics.py tests/test_book_generation_long_wrapper.py tests/test_real_llm_long_evidence_validator.py tests/test_ide_agent_orchestrator.py tests/test_agent_runs.py` → All checks passed。
- `git diff --check` → 通过。

## Q9 真实 16 章长程：缺章根因修复 + 本次 run 抢救（2026-06-30）

- **背景**：本日 deepseek-v4-flash 真实 16 章长程（`.codex/real-llm-q9-flash-16ch-20260630-155026`）runner 退出码 1，summary 显示第 8/12/15 章 `char_count=0`、book.md 只含 13 章；但 metrics 显示这 3 章各生成约 4000 completion tokens、judge 给 69 分。脱敏诊断（读 smoke.sqlite3）确认：3 章正文**已生成且连贯**（scene 内容 1990/1831/4491 字，无测试痕迹/模型自述），是后端门禁把好章判死后**导出只收 approved 章、静默丢成空洞**，且 BookRun 仍标 `completed / 16 章` 并算 sha256——把缺失当成功。
- **三处独立根因**：
  1. 字数下限过脆且无修复路径：`_apply_word_count_floor` 用蓝图下限 2000 作硬截断线，ch8(1990，差 10 字)/ch12(1831，差 8.5%) 被压到 score=69；下限本意是「防截断」（docstring 举例 50 字占位），却误伤完整但略短的好章。
  2. 汇总 Judge 误标：score 被字数门禁压到阈值以下、又无可定位 issue 时，`_record_summary_judge` 仍记「章节通过」（score 69 与「通过」自相矛盾）。
  3. story_state grounding all-or-nothing：ch15 的 9 个 change 里仅「陈伯」(character:e3c80dd822，实为同章已通过的「陈守义」别名) 未在正文出现，`commit_story_state_changes` 整批 `StoryStateGroundingError` 拒绝，连累全书最长的一章。
  4. 缺章护栏缺失：`run_book_generation` / `resume_book_generation` 无条件标 completed，缺章只进 `full_book_advisory_status`（advisory，hard_gate=False），不拦完成。
- **变更**（均为「别丢好章 / 别静默发缺章」，非降低门槛）：
  - `book_generation_judge.py`：新增 `WORD_COUNT_FLOOR_TOLERANCE=0.8`，硬截断线改为 `下限 × 容差`，只拦明显截断；`_record_summary_judge` 按 score 区分 `phase9b_real_judge_pass`(通过) 与 `phase9b_real_judge_subthreshold`(未通过)，不再误标；`_commit_story_state_for_scene` 传 `drop_ungroundable=True` 并把丢弃记为 advisory（`committed_with_dropped` / `all_dropped`），不再判死整章。
  - `story_state/service.py` + `schemas.py`：`commit_story_state_changes` 新增 `drop_ungroundable`（默认 False，保留显式工具/接口提交的严格 all-or-nothing）；True 时丢弃不可核实 change、提交其余；`CommitStoryStateResult` 新增 `dropped_grounding`。
  - `book_generation.py`：新增 `_assert_no_missing_chapters` 缺章护栏，run/resume 标 completed 前若 1..N 章未全部批准则落 `failed` 并抛 `BookGenerationError`；修复 `_reconstruct_completed_chapters` 重建章漏 `approved` 标记（护栏暴露的预存 bug，否则断点续跑前序章被误判缺失）。
- **回归测试**（新增 9 个）：word-count 容差通过近下限章 / 容差下仍拒截断 / 汇总 judge 不误标；缺章护栏 gap 拒绝并落 failed / 全批准放行；grounding 部分提交保留其余 / 全不可接地不抛错不落库 / 默认仍严格拒绝。
- **本次 run 抢救**（不重新生成正文，无 LLM 调用）：用修复后逻辑重放 8/12/15 章门禁尾段确认合法通过（ch8 word-count 过+story commit committed；ch12 word-count 过+committed_with_dropped 丢 2 条；ch15 word-count 过+committed_with_dropped 丢「陈伯」），置 approved 后重导出 → `.codex/real-llm-q9-flash-16ch-20260630-155026-salvaged/`：book.md 含 16 个连号章标题、`chapter_count_integrity: pass (16/16)`、scored_chapter_count=16、average_score=100。sha256 见同目录 `salvage-result.json`。
- **本地验证**：
  - `cd apps/api && uv run pytest tests/test_story_state.py tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_book_generation_parallel.py tests/test_book_exporter.py tests/test_judge_repair.py tests/test_multi_round_repair.py -q` → 99 passed。
  - `cd apps/api && uv run pytest -q` → 758 passed, 3 skipped。
  - `cd apps/api && uv run ruff check .` → All checks passed。
  - OpenAPI：`CommitStoryStateResult` 仅服务内部使用，未出现在任何路由响应模型，无契约漂移，无需刷新快照。
- **未联通能力 / 不外推**：本轮只证明缺章根因已修、本次已生成内容可组装成完整 16 章可读产物；advisory 仍为 `needs_review`（伏笔「乱石坡刻石与铜屑」未回收、结尾收束信号弱），这些**叙事面**结论必须由人工盲评判定，不以 golden/judge/average_score=100 替代。抢救书未经人工通读，**不得**宣称真实 3-5 万字长程质量验收通过。

## Q9 抢救书后处理：导出剥离重复标题 + 人工通读结论（2026-06-30）

- **导出侧修复**：模型在正文首行重复抄写章标题（`# 铜钟疑案 N`，全书 1/2/9/10/11/12/13 共 7 章命中）会在成书/EPUB 重复显示。`book_markdown_exporter` 新增 `_strip_redundant_title_line`，在 markdown 与 EPUB 渲染处剥离与章标题一致的首个 ATX 标题行，不改原始 `scene.content`。新增 helper 单测 + markdown/EPUB 集成回归。
- **本地验证**：`cd apps/api && uv run pytest tests/test_book_exporter.py -q` → 9 passed；`uv run ruff check app/domains/exports/book_markdown_exporter.py tests/test_book_exporter.py` → 通过。
- **抢救书重生成**：导出修复后重跑 salvage → `.codex/real-llm-q9-flash-16ch-20260630-155026-salvaged/` 全 16 章正文无内嵌标题、章头完整（book.md/epub 新 sha256 见 `salvage-result.json`，audit 不含正文故 hash 不变）。
- **人工通读结论（用户）**：用户通读抢救书，结论 **「还行（可接受）」**，未要求退回重跑。该结论为整体 verdict，未单独给 6 维盲评分；audit advisory 仍标伏笔「乱石坡刻石与铜屑」未回收、结尾收束信号弱，登记为后续可改进项。
- **边界（不外推）**：「可接受」≠ 真实 3-5 万字长程**质量验收通过**，亦不据此宣称稳定生产级长篇生产闭环；后续若要正式验收仍需按 DoD 走 6 维盲评。

## Desktop 私测 Alpha A2：后端 sidecar 真打包 + 独立起服验证（2026-07-01）

- **背景**：PR #43 落地了 A2 代码路径（PyInstaller 打包脚本、`externalBin` sidecar 声明、`main.rs` sidecar spawn、BYO-key 注入），但「真打包出的 exe 能否脱离 docker/venv/python 独立起服」此前未验；A2 是 alpha 计划标注的最高风险 keystone。
- **打包**：`node apps/desktop/scripts/build-api-sidecar.mjs`（`uv run --with pyinstaller PyInstaller --onefile --name storyforge-api ... run_windows.py`）→ `apps/desktop/src-tauri/binaries/storyforge-api.exe`（46 MB）+ triple 副本 `storyforge-api-x86_64-pc-windows-msvc.exe`，exit 0。
- **独立起服**（直接运行 .exe，不经 python/uv/docker）：env = `STORYFORGE_DESKTOP_SKIP_SERVICES=1` + `STORYFORGE_ENV=local` + `DATABASE_URL=sqlite+pysqlite:///<临时>.sqlite3` + `STORYFORGE_API_PORT=8770`。
- **证据**：
  - 启动日志：`storyforge_api_started` → `Application startup complete`，uvicorn 监听 127.0.0.1:8770；仅一条预期的默认 API key warning。
  - `GET /health/live` → `{"status":"alive"}`。
  - `GET /health/ready` → `{"status":"ready","checks":{"db":"ok","redis":"skipped"}}`（sqlite 建表成功、redis 本地模式跳过）。
  - `GET /openapi.json` → 200（全量 app 装配、路由齐全）。
  - sqlite 文件经冻结 exe 内 `bootstrap_sqlite_database()` create_all 建出 **45 张表**（agent_runs / book_runs / books / chapters / character_bible_entries / judge_issues / memory_atoms 等核心域齐全）——证明 create_all 在冻结环境内真跑，`db:ok` 非空文件糊弄。
- **结论**：A2 keystone（Python 后端打进 Tauri sidecar + 去 dev-tree 假设）在 exe 层面成立——打包后端可独立起服、sqlite 自建库、服务全 API。
- **未验 / 不外推**：本轮只证明 sidecar exe 独立起服；**未**验证 `tauri build` 出完整安装包并由 Tauri 主进程拉起 sidecar、GUI 端到端（开文件→Agent 审稿→修订→diff 确认→写回→版本记录）、真机「app 内换模型/服务商即生效」端到端。这些仍需真机 Tauri 跑。

### 换模型/服务商「写盘即生效、无需重启」：sidecar HTTP 端到端（2026-07-01）

- **验证目标**：PR #43 的实时配置读取（后端 `resolved_llm_env` 实时读 `STORYFORGE_LLM_CONFIG_FILE` 指向的 `llm-provider.json`）在真·冻结 sidecar + 真 HTTP 路径上成立，而非仅单测。
- **方法**：同一冻结 exe 进程（**不重启**），`STORYFORGE_LLM_CONFIG_FILE` 指向 scratchpad 的 `llm-provider.json`，用 `GET /api/assistant/provider-health`（回显 resolved model/base_url，绝不回显凭据）观察 resolved 结果。
- **证据**：
  - 初始 json `model=sf-live-alpha` / `baseUrl=http://127.0.0.1:9/v1` → probe 回 `"model":"sf-live-alpha"`、`"base_url":"http://127.0.0.1:9/v1"`。
  - **不重启**改写 json 为 `model=sf-live-beta` / `baseUrl=http://127.0.0.1:19/v1` → 同进程下一次 probe 回 `"model":"sf-live-beta"`、`"base_url":"http://127.0.0.1:19/v1"`。
  - 两次均 `status=unreachable`（假 base_url 端口拒连，WinError 10061，预期）——回显字段才是判据；model/base_url 随文件即时翻转，证明无需重启后端。
- **结论**：换模型/服务商「写盘即生效、无需重启」在冻结 sidecar 上端到端成立。
- **未验**：app 内 SettingsView/欢迎区 chip 点击 → Tauri `save_llm_config` 写 `llm-provider.json` → 后端读取 这段仍需真机 GUI 串一次（Tauri 侧写盘有类型/命令保证，但未在打包 app 内点击验证）。

### A2 续：tauri build 出 NSIS 安装包 + sidecar 打包内嵌（2026-07-01）

- **验证目标**：`tauri build` 能否出 Windows 安装包，且 A2 sidecar（externalBin）被正确内嵌，装出来的 app 默认走打包后端。
- **构建**：`cd apps/desktop && npm run tauri -- build --bundles nsis`，exit 0。
  - 前端 vite build ✓（`frontend/dist`，monaco 3.3MB 提示 chunk 偏大，非阻断）。
  - cargo release → `target/release/storyforge-desktop.exe`（15.4 MB，sha256 `802a97f48fe06d6e1c8d5688981acd1262293d30e8ab1824a7e3ff678b2c6239`），1m03s（deps 已热）。
  - makensis → 安装包 `target/release/bundle/nsis/StoryForge IDE_0.1.0_x64-setup.exe`（51 MB，sha256 `000c5b1c3b1595d8195e35326a192f3c2d0b4bd9c42e5cd112c8d48f619f6a90`）。NSIS 工具链本机已就绪，未触发 GitHub 下载（未撞代理）。
- **sidecar 内嵌证据**（正向，非靠体积推断）：生成的 `target/release/nsis/x64/installer.nsi` 含 `File /a "/oname=storyforge-api.exe" "...\binaries\storyforge-api-x86_64-pc-windows-msvc.exe"` —— 安装器把 triple 名 sidecar 装成运行期 `storyforge-api.exe`，正是 `main.rs` 的 `.sidecar("storyforge-api")` 期望名。release 目录亦已 stage `storyforge-api.exe`(46MB) 于 app exe 旁。
- **打包态默认走 sidecar**：`should_use_api_sidecar()` = `!cfg!(debug_assertions)`（main.rs:366），release 构建默认 true，无需 env 即用打包后端。
- **结论（合并前两轮）**：A2 keystone 在打包层端到端成立 —— sidecar 独立起服可用（已验）+ tauri build 正确内嵌 sidecar 出安装包（本轮）+ release 默认拉起 sidecar。
- **仍未验（需真机 GUI）**：双击 `StoryForge IDE_0.1.0_x64-setup.exe` 安装 → 启动 app → Tauri 主进程拉起打包 sidecar → GUI 端到端（开文件→Agent 审稿→修订→diff 确认→写回→版本记录）。这段是唯一剩余门，需人工点击。

### 对话式 Agent 收口：chat.explain 接真·LLM + 项目级对话解绑当前文件（2026-07-01）

- **背景**：延续上一轮把桌面中间交互区从「按钮式 GUI」改成 Codex/Claude Code 式对话 agent 的改动（删 `Composer.tsx` 顶层 legacy 组件与 `panels.tsx` 内 issue 面板、去命令面板「审查当前文件」与编辑器 gutter「定向修订」按钮连线、`ChatWindow`/请求载荷让 file 字段可空、`WelcomeWorkspace` 把对话区门控从 `currentFile` 改为 `projectPath`）。本轮为收口修复 + 门禁复绿。
- **后端**：
  - `agent_runs/runtime.py`：`chat.explain` 从写死 echo 改为调 `assistant_service.chat_reply` 走真·LLM，落 `assistant.chat` 工具调用证据链；LLM 未配置/失败时明确回话不伪造。
  - `assistant/service.py`：新增 `chat_reply()`（系统提示 + 项目上下文摘录 → `_call_llm`，未配置抛 `AssistantLlmNotConfiguredError`）。
  - **修复 resume 回归**：需要文件的 intent 的「无文件降级为对话」护栏，条件从「同时要求 file_path+content」收紧为**只看 file_path**。根因：`file.review` 的 resume 重建消息只回传 `file_path`（正文靠 pending call 的 `context_output` 续跑、不回传 content），旧条件会把 resume 误降级成 `chat.explain`、绕过 `_resume_file_review_from_pending_call` → `KeyError: resumed_from_pending_call`。
- **测试隔离修复**（`tests/conftest.py`）：autouse `isolate_remote_llm_env` 原先只删 `os.environ`，但 `resolved_llm_env` 还会经 pydantic settings 从 `.env.local` 回填真实 key（本机配了 key），导致 `chat.explain` 默认走真·LLM 挂在网络请求上。补：同时清空缓存 settings 的 `storyforge_llm_*` 字段，使默认判定为「未配置」；需真实路径的测试仍可 monkeypatch 覆盖。probe 证实 fixture 下 `missing_book_generation_env()` 回 4 项缺失。
- **测试更新**（`test_ide_agent_orchestrator.py`）：
  - `test_agent_user_message_stream_error_carries_run_id`：原触发点「file.review 无 file_path→报错」已因降级失效，改用「不存在的 assistant_session→`_resolve_assistant_session` 抛 `AgentOrchestrationError`」触发**流式** error，保留「error 携带 run_id」覆盖。
  - 新增 `test_file_review_without_open_file_degrades_to_chat`：锁定「无 file_path 的 file.review 降级为 chat.explain、不硬报错」新契约。
- **前端收尾**：补 `panels.tsx` 缺失的 `useState` import；移除 `App.tsx` 因 `welcomeVisible=!activeProject` 而变死的 `emptyWorkbenchVisible` state 及 6 处 setter；删 `command-palette.test.tsx` 对已删 `onReviewCurrent` prop 的死引用。
- **证据（命令 + 结果）**：
  - `npm --prefix apps/desktop/frontend run typecheck` → 干净（先前两处报错已修）。
  - `npm --prefix apps/desktop/frontend run test` → 93 pass / 0 fail。
  - `cd apps/api && uv run pytest tests/test_agent_runs.py` → 54 passed（含 resume 用例复绿）。
  - `uv run pytest tests/test_ide_agent_orchestrator.py` → 32 passed（含新增 degrade 用例；先前 chat.explain 触网挂起已解）。
  - `uv run pytest`（全量 API）→ **767 passed / 3 skipped / 1 failed**，529s。
- **唯一失败为先前存在、与本轮无关**：`test_phase9_fact_sources.py::test_local_start_records_current_phase9_runbook` 断言本地启动手册含「更新时间：2026-06-04」，而手册已在已合并的 PR #43（3343df6）改为「2026-07-01」——文档/测试日期漂移，手册与该测试均不在本轮改动清单内。
- **未验 / 不外推**：本轮全走单测 + TestClient；**未**在真·LLM 环境跑 `chat.explain` 真实回话，也**未**在真机 Tauri GUI 串「无文件时项目级对话」端到端。真机 GUI 端到端仍是唯一剩余门。

## 事实源文档刷新至对话式 Agent + 私测 Alpha 阶段 + 修 phase9 日期钉死断言（2026-07-02）

- **背景**：`current-phase.md` / `TODO.md` / `CLAUDE.md` 停在 2026-06-23 旧叙事（BookRun 优先、长程重跑为首要），落后于 2026-06-30 对话式 Agent 定向与 2026-07-01 已合并的 PR #42-#46（UI 改版、Alpha sidecar、对话式 Agent + chat.explain 真·LLM）；每个新会话都会被旧文档误导。另有唯一红测 `test_phase9_fact_sources.py::test_local_start_records_current_phase9_runbook`：把运维手册「更新时间：2026-06-04」钉进断言，PR #43 手册日期改为 2026-07-01 后必挂。
- **改动**：
  - `docs/internal/current-phase.md`：阶段更名「Desktop 对话式 Agent 与私测 Alpha 收口阶段」（真相边界 2026-07-02）；补 PR #42-#46 收口事实、Q9 16 章门禁修复证据（`.codex/real-llm-q9-flash-16ch-20260630-155026`，人工通读通过）、对话式 Agent 现状边界（仍为关键词意图路由、无项目级 fs 工具、流程树含前端预制骨架步骤）；「仍未完成的验收项」改为：真机安装包端到端 / 对话体验收口 / Agent loop / 质量轨后台；禁止宣称范围加「不得把意图路由式 Agent 宣称为自主工具循环 agent」。30 章退回细节、重跑 DoD、重构边界、历史 E2E 证据句保留不动。
  - `docs/internal/TODO.md`：同步阶段名与新四级优先级（对话体验收口 → Agent loop → 真机端到端 → 质量轨后台）；本地验证命令区不动。
  - `CLAUDE.md`：§1.1 更新至 2026-07-02 真相；§8 能做/不能做补对话式 Agent、Alpha sidecar 与意图路由边界；§8.1 换为新优先级。
  - `docs/internal/next-step-plan.md`：按该文件惯例追加 2026-07-02 更新块（产品轨顺序调整，质量轨 DoD 不变）。
  - `apps/api/tests/test_phase9_fact_sources.py`：`更新时间：2026-06-04` 钉死断言改为日期格式正则（手册必须有更新时间，不钉死具体日期）；阶段名断言同步；新增 `chat.explain` / `私测 Alpha 单机后端` / `工具循环` / `会话历史列表` 等新事实钉；`2026-06-21 本轮正在执行 apps/web 退场` 改为 `已完成退场收口`。
- **证据**：`uv run pytest tests/test_phase9_fact_sources.py -q` → 14 passed（此前 1 failed / 13 passed）；`uv run ruff check tests/test_phase9_fact_sources.py` → 通过；`pnpm.cmd lint` → 0 error（仅先前存在的 Editor.tsx exhaustive-deps warning），prettier 全通过。
- **未验 / 不外推**：本轮为文档 + 测试断言同步，无运行时行为变更；不改变任何「禁止宣称」边界本身。

## Desktop 对话体验收口：会话历史列表 + 欢迎页输入框接真（2026-07-02）

- **背景**：延续 PR #46 对话式 Agent 收口，补两处用户 2026-07-01 笔记（`端的问题.md` #2/#5、`审uiux.md`）反馈的缺口：左栏没有对话历史（原「展开会话」只显示 localStorage 里当前项目的单个 sessionId、文案写死「最近创作会话」），欢迎页中央大输入框是纯装饰（无 value/onChange、发送钮无 onClick，从欢迎页发不出消息）。
- **后端（可按项目列会话历史）**：
  - `assistant_sessions` 增列 `project_path`（`String(1024)`，index，nullable，带独立迁移 `20260702_0001`，down_revision 接 `20260630_0001` head）；`AssistantSession` model / `AssistantSessionCreate` / `AssistantSessionRead` schema 同步。
  - `list_recent_assistant_sessions` + `GET /api/assistant/sessions` 增 `project_path` 过滤参数（None 时行为不变，向后兼容首页最近记录）。
  - `agent_runs/runtime.py` 的 `_resolve_assistant_session` 建会话时从 `args.project_path` 落 `project_path`，使 agent 自动建的会话可被按项目检索。
- **前端**：
  - api-client 新增 `listAssistantSessions({ projectPath, limit })`；`AssistantSessionRecord` 增 `project_path`。
  - `CodexSidebar`：展开项目时从 `GET /api/assistant/sessions?project_path=` 拉真实会话历史（加载中/失败/空态分别提示），点击会话 → `onSelectProjectSession(path, id)` 切项目并恢复该会话，「新建会话」→ `onNewProjectSession(path)` 清空当前项目会话开新对话；高亮当前会话。
  - `useProjectWorkspace.setActiveProjectAssistantSession` 增 `projectOverride`，供切项目与设会话在同一事件里生效（activeProject state 尚未更新）。
  - 欢迎页输入框接真：`WelcomeWorkspace`/`AgentComposerHome` 接 `composerValue/onComposerChange/onComposerSend`；textarea 绑定 state + Enter 发送 + 发送钮 disabled 门控；`App` 记住首条 prompt 为 `pendingWelcomePrompt`、打开项目后 `ChatWindow` 经 `pendingInitialPrompt` 自动发出一次（`pendingPromptFiredRef` 防重发）。
- **方向键排查**：代码层未发现任何对 Arrow 键的 `preventDefault`（Composer 仅拦 Ctrl+Enter，App 全局 keydown 仅拦 Ctrl+P），无禁用 `user-select` 的全局 CSS，Tauri 侧无 drag-region / 全局快捷键拦截。最可能根因是欢迎页那个**只读装饰 textarea**（空只读框里方向键移光标无可见效果）——本轮已改为真实可编辑输入框；真机需再验一次主 Composer。
- **证据**：
  - `cd apps/api && uv run pytest tests/test_assistant_sessions.py tests/test_agent_runs.py -q` → 58 passed（含新增 `test_assistant_session_list_filters_by_project_path` + WS 用例锁定 `project_path` 落库）。
  - `npm --prefix apps/desktop/frontend run typecheck` → 干净。
  - `npm --prefix apps/desktop/frontend run test` → 93 pass。
  - `pnpm openapi` 刷新契约（新增 `project_path` 字段/查询参数）；`pnpm.cmd lint` → 0 error，prettier 通过。
- **未验 / 不外推**：本轮走单测 + TestClient；**未**在真机 Tauri GUI 串「欢迎页输入 → 打开项目 → 自动发首条」「侧栏点历史会话恢复对话」端到端，方向键真机复验仍待人工。

## Agent loop PR-A：path-scoped 只读 fs 工具（2026-07-02）

- **背景**：Agent loop 三步计划（fs 工具 → loop runtime → 前端流程树真实化）第一步。Alpha 单机 sidecar 后端与项目文件同机，Agent 只读上下文获取从「前端 Tauri 预组装塞给后端」改为后端直读成为可能；本轮先落工具层与安全边界。
- **改动**：新增 `apps/api/app/domains/agent_runs/fs_tools.py`——`fs_list`（递归相对路径列表、跳过 .git/.storyforge/.codex/node_modules/__pycache__ 与点前缀目录、max_entries 截断标记）、`fs_read`（offset/limit 字符切片、单次上限 200K、二进制拒读、CRLF 归一化为 \n）、`fs_search`（默认 glob *.md、行号+摘录、max_matches 截断、可选正则、单文件扫描上限 512KB、文件数上限 2000）。所有入口 `_resolve_scoped` 以 project_root resolve 后前缀校验，`../`、绝对路径、符号链接逃逸一律 `FsToolError("路径越界")`；**无任何写接口**。
- **证据**：`uv run pytest tests/test_agent_fs_tools.py -q` → 12 passed（含 ../ 与绝对路径越界、二进制拒读、截断标记、正则无效报错、glob 过滤、subpath 作用域用例）；`uv run ruff check` 通过。
- **未验 / 不外推**：本轮工具尚未接入 runtime 工具注册表与 LLM 循环（PR-B），不改变现有任何行为。

## Agent loop PR-B：LLM 工具循环替代 chat 单轮回话（2026-07-02）

- **背景**：三步计划第二步。把自由文本对话从「单轮 chat_reply」升级为「LLM 自主调用只读 fs 工具后作答」；显式 intent（审稿/修订/写作任务按钮）保持旧管线，可单独回退。
- **改动**：
  - `book_generation_llm.py`：抽出 `_build_chat_payload` + `_request_chat_completions`（HTTP+重试核心，行为不变）；新增 `_call_llm_messages`（多轮 messages 版，允许 assistant 只回 tool_calls、content 为空——工具循环合法中间态；既无正文也无工具调用才报错）。`_call_llm` 语义与报错文案保持原样。
  - 新增 `agent_runs/loop_runtime.py`：`run_chat_loop` 工具循环主体——OpenAI tool-calling 协议（函数名 fs_list/fs_read/fs_search，内部映射回 registry 名）；最多 8 轮；工具输出预算 60K 字符，超限注入系统提示并撤走工具强制作答；末轮不给工具；未知工具/参数解析失败/工具异常一律作为观测反馈给模型不中断；每次工具调用落 `assistant_tool_calls` 证据（running→completed/failed）+ 历史消息带入（最近 12 条、每条截 4000）。首轮 LLM 失败（含 `BookGenerationPreflightError`，与 `BookGenerationError` 平级需同时接住）抛 `ChatLoopUnavailableError`。
  - `runtime.py`：注册 `fs.list/fs.read/fs.search` handler（复用 PR-A fs_tools，`project_root` 只来自请求 args、LLM 传入一律丢弃）；`_run_chat_explain` 前置 `_try_chat_loop`——有 project_path 且 LLM 已配置才试，首轮失败静默回落单轮（不发事件、不重复 plan）；成功路径增量发 `agent_plan_created` + 逐工具 `tool_trace` 事件，`_events_recorded=True`；落 `assistant.chat_loop` 汇总证据；`agent_result.chat_loop` 带 rounds/tool_call_count。
  - `tooling.py` + `role_catalog.py`：fs.* 三个 spec（auto/read/retry_safe/idempotent）；root_agent 与 context_explorer 的 allowed_tools 同步（投影测试强制一致）。
  - **附带修复 master 红测**：`test_alembic_heads.py` 把 head 钉死为 `20260630_0001`，PR #48 的迁移 `20260702_0001` 合并后即红（当时只跑了定向套件漏掉）；本轮更新钉死值复绿。
- **证据**：
  - `uv run pytest tests/test_agent_loop_runtime.py -q` → 4 passed（工具循环端到端 WS：fs.list/fs.read 事件+证据链+第二轮带回工具结果；未知工具反馈恢复；首轮失败回落单轮且 plan 事件仅 1 条；无 project_path 不进循环）。
  - `uv run pytest tests/test_runtime_tools.py tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_llm_context.py tests/test_agent_fs_tools.py -q` → 112 passed。
  - 其余全量 `uv run pytest`（排除上述已跑文件）→ 669 passed / 3 skipped。合计全套 785 passed。
  - `uv run ruff check` → 通过。
- **未验 / 不外推**：真·LLM tool-calling 实跑（真实 provider 对 tools 的行为、回落路径）未在本轮验证；循环暂不支持 pause/resume 边界（旧 chat 单轮路径本也没有）；前端流程树仍含预制骨架步骤（PR-C 处理）。

## Agent loop PR-C：前端流程树全事件驱动，删预制骨架步骤（2026-07-02）

- **背景**：三步计划第三步。此前 `runAuthorAgent` 预制 context/draft/orchestrate 三个前端骨架步骤并手动推状态，流程树「半演」；用户 2026-07-01 笔记明确要 Claude Code 式真实流程树。PR-B 后 chat 循环逐工具回传真实 plan/tool_trace 事件，骨架步骤失去存在理由。
- **改动（apps/desktop/frontend）**：
  - `ChatWindow.tsx`：`runAuthorAgent` 初始 steps 改为空数组，步骤只来自后端 plan/tool_trace 事件；删除全部 context/draft/orchestrate 的 `updateAgentStep` 编排（含错误路径与 catch）；写回确认与导出改为纯本地动作提前返回、不再创建 agent run；最终结果不再拼装「整理回复」伪步骤（`stepsFromAgentResult` 直出真实 plan+tool 步骤，approval 确认步保留——那是真实待确认态）；`agent_run_started` 不再映射伪步骤；Editor 回传修订结果时删除对已不存在 `revise` 步骤 id 的更新。
  - `display-utils.ts`：`runStatusText` 删除对 context/draft/orchestrate 死 id 的特判。
  - **`verify-agent-conversation.mjs` 双重陈旧修复**（该门禁在 master 上本已失效、与本轮改动无关）：①等待「扫描项目上下文」——但 `planStepTitle('context-agent')` 早已改名「选择上下文」，脚本从未同步；②勾选式 issue 面板（`review-issue-checkbox` 等 testid）已在 PR #46 删除，脚本仍在点击。重写断言为：等待事件驱动步骤「选择上下文」+ 最终 plan detail `mock context`（流式 detail 会被 agent_result 替换属预期）；显式断言四个前端伪步骤标题不出现；删除勾选流与第二条消息断言；保留首条消息完整 payload 契约断言（project_path/current_file/content/context_bundle/stream/run_id/pinned budget/excerpt）。
- **证据**：
  - `npm run typecheck` → 干净。
  - `npm run test` → 93 pass / 0 fail。
  - `npm run verify:agent-conversation` → **passed**（真 vite + playwright chromium；修复前在 master 基线同样命令失败于等待「扫描项目上下文」超时，已用 git stash 对照验证为先前存在问题）。
  - `pnpm.cmd lint` → 0 error（回到基线仅剩 Editor.tsx 先前存在的 exhaustive-deps warning），prettier 通过。
- **未验 / 不外推**：真机 Tauri GUI 下事件驱动流程树的观感（步骤到达节奏、真 LLM 工具循环多轮渲染）未验证；chapter.review / bookrun 等旧管线的步骤呈现路径未改动。

## 事实源文档刷新至 Agent loop 已落地边界（2026-07-02）

- **背景**：PR #47-#51 合并后，`current-phase.md` / `TODO.md` / `CLAUDE.md` / `next-step-plan.md` 仍停在「会话历史列表 / Agent loop 是下一步」的旧叙事；上一会话已改好 `current-phase.md` 未提交，本轮补齐其余三份并收口提交。
- **改动**：
  - `docs/internal/current-phase.md`：补 2026-07-02 已合并块（PR #47-#51：事实源刷新、会话历史列表 + 欢迎页接真、Agent loop 三步）；能力边界新增「会话历史与欢迎页接真」「Agent loop」两条；「仍未完成的验收项」改为真机端到端（含工具循环流程树 / 会话历史 / 首条 prompt / 方向键）+ Agent loop 真·LLM 实跑验证 + 质量轨；禁止宣称范围改为「不得宣称真·LLM tool-calling 实跑验证通过、不得宣称显式 intent 已工具循环化」。
  - `docs/internal/TODO.md`：执行入口补 PR #47-#51；事实边界的对话式 Agent 条目更新为工具循环已落地 + 新边界（只覆盖 chat 自由文本、真·LLM tool-calling 未实跑、写回红线不变）；下一步优先级收敛为四级（Agent loop 真·LLM 实跑 → 真机端到端 → 质量轨 → 文档同步）。
  - `CLAUDE.md`：§1.1 补 2026-07-02 已合并与 Agent loop 边界；§8 能做/不能做同步（意图路由旧禁止句换为 tool-calling 实跑与显式 intent 边界）；§8.1 换新优先级。
  - `docs/internal/next-step-plan.md`：2026-07-02 更新块追加执行状态（产品轨前两步已合并，剩余真·LLM 实跑 → 真机端到端）。
- **测试钉兼容**：措辞保持 `test_phase9_fact_sources.py` 全部事实钉——「会话历史列表」「工具循环」留在 TODO 下一步优先级的真机端到端行，「自然语言意图路由」等钉在 current-phase.md 原句保留，测试零改动。
- **证据**：`cd apps/api && uv run pytest tests/test_phase9_fact_sources.py -q` → 14 passed；`pnpm.cmd lint` → 0 error（仅先前存在的 Editor.tsx exhaustive-deps warning），prettier 全通过。
- **未验 / 不外推**：纯文档同步，无运行时行为变更；不改变任何「禁止宣称」边界本身；Agent loop 真·LLM 实跑与真机端到端仍未执行。

## Agent loop 真·LLM tool-calling headless 实跑验证（2026-07-02）

- **背景**：PR #49/#50/#51 落地的 chat 工具循环此前只有单测 + TestClient 证据；本轮按 TODO 优先级 1 执行真实 provider 实跑（真实 WS 路径，非 TestClient）。
- **环境**：`apps/api` 经 `run_windows.py` 单机起服（sqlite 自建表、无 docker/Redis；注意本机 venv 的 `uvicorn/loops/__init__.py` 顶层 `import uvloop`，`--loop asyncio` 也会炸，必须走 `run_windows.py`）；LLM 配置经 `STORYFORGE_LLM_CONFIG_FILE` 挂桌面 Alpha 写盘的 `llm-provider.json`（deepseek / deepseek-v4-flash，BYO-key）——`.env.local` 里的旧 key 已失效（provider 返回 401）。测试项目为临时中文小说项目（5 个 md，埋跨文件伏笔），WS 消息形状与桌面端一致。
- **结果（证据 `.codex/real-llm-agent-loop-20260702-165907`，README 有完整核对）**：
  - 工具循环主路径：消息一 4 轮 / 4 工具（fs.list + fs.read×3）98.1s、消息二同会话 2 轮 / 3 工具（fs.search×3，模型自主构造正则 `凿去|凿星|七星|北斗`）57.5s；回答全部接地（人物 / 章节数 / 铜镜凿星 / 摇光禁术），引用行号与真实文件一致，跨文件伏笔（凿痕「十几年」↔ 观澜「十七年前被除名」）被自主串起。
  - 事件渐进到达：0.2s run_started → 14.6s plan+fs.list → 34.3s → 55.9s → 98.1s agent_result；REST 事件流含 agent_plan_created + tool_trace×4 + agent_run_completed。
  - 证据链：`assistant_tool_calls` 逐调用 fs.*（input/output summary）+ `assistant.chat_loop` 汇总（rounds / tool_call_count / completion_tokens 808+804 / exhausted=false）。
  - 回落路径实证（意外收获）：旧 key 401 时首轮失败 → `ChatLoopUnavailableError` → 静默回落单轮 → 单轮同样 401 → 如实回话不伪造，run 以 agent_result 正常收尾、无 chat_loop 字段。
  - 质量观察：消息一把案件演绎为「井中尸体案」，正文只写「井里捞出来的东西」，属模型轻度过度演绎，非工具链问题。
  - 脱敏核查：证据目录扫描确认不含任何 API key。
- **事实源同步**：`current-phase.md`（已合并块边界、真实 LLM 证据新增 Agent loop 条目、未完成项改为「显式 intent 并入循环」、禁止宣称改为「headless 证据不得当真机验收」）；`TODO.md` / `CLAUDE.md` 同步同一边界。
- **证据（门禁）**：`uv run pytest tests/test_phase9_fact_sources.py -q` 与 `pnpm.cmd lint` 见本轮提交前复跑记录。
- **未验 / 不外推**：单一 provider（deepseek-v4-flash），未测其他 provider 的 tools 兼容性；真机 Tauri GUI 多轮渲染观感未验（并入桌面端到端验收项）；审稿 / 修订等显式 intent 仍未循环化；本证据不构成任何长程质量结论。

## Agent loop：审稿 / 修订并入工具循环（file.review / file.revise 作为循环内工具）（2026-07-02）

- **背景**：TODO 优先级 1。此前工具循环只挂只读 fs 工具，审稿 / 修订只能走关键词路由的固定管线；本轮把 `file.review` / `file.revise` 注册为循环内工具，chat 自由文本即可由 LLM 自主决策审稿与修订。显式按钮 / intent 路径保持旧管线不动（可回退）。
- **改动**：
  - `agent_runs/fs_tools.py`：新增 `resolve_project_file`（相对路径 → 越界拒绝的绝对路径，供补丁携带可写回真实路径）。
  - `agent_runs/loop_runtime.py`：`_TOOL_NAME_MAP` / `LOOP_TOOL_SCHEMAS` 增 `file_review`（path）与 `file_revise`（path + instruction）；系统提示补「补丁不写盘、须作者确认、一次最多一个补丁」；`ChatLoopOutcome` 增 `review_report` / `proposed_patch`；审稿反馈只回灌精简 issue 要点（id/category/severity/code/message/suggested_action，≤20 条，不回灌 agent_findings/traces），修订反馈不携带 before/after 全文（防模型把未确认补丁当已写回，也省预算）；补丁生成后后续轮撤下 `file_revise`，同轮第二次修订调用拒绝为观测反馈。
  - `agent_runs/runtime.py` `_try_chat_loop`：工具回调泛化——file.review/revise 由后端按 path-scoped 从盘上读稿（>200K 拒绝），LLM 传入的 content / file_path 一律丢弃；结果组装带 `proposed_patch` + `requires_user_confirmation` + `permission.confirm` plan 步，复用既有 `_record_result_artifacts` / `record_permission_required` 后处理（run 暂停、`writeback_blocked_until_user_confirms`、补丁 artifact 待确认）。前端 PatchReviewPanel 契约复用，零前端改动。
- **证据（单测 + TestClient）**：`uv run pytest tests/test_agent_loop_runtime.py tests/test_agent_fs_tools.py tests/test_runtime_tools.py tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → 112 passed（新增 4 用例：循环内审稿精简反馈 + report artifact；循环内修订补丁 → permission_required → run paused → 后续轮无 file_revise；同轮二次修订被拒且仅 1 个补丁 artifact；越界路径观测反馈恢复且零 artifact）；`uv run ruff check` 通过；`pnpm.cmd lint` 0 error；`tests/test_phase9_fact_sources.py` 14 passed。
- **真·LLM 实跑（证据 `.codex/real-llm-agent-loop-intents-20260702`）**：单条消息「审第二章然后修最明显的问题」→ deepseek-v4-flash 自主 file.review → fs.read → file.revise（3 轮 / 3 工具 / 55s）；补丁待确认、`permission_required` 发出、run 暂停 permission.confirm；跑完盘上原文未动（写回红线实证）；模型回话明确「确认后才会写盘」；脱敏扫描无密钥。
- **未验 / 不外推**：真机 Tauri GUI 上对循环产出补丁的确认写回观感未验；chapter.review / chapter.repair / bookrun.* 未并入循环；单一 provider；全量 API 回归见同日后台跑记录。
- **全量回归补记**：其余全量 `uv run pytest`（deselect 上述 5 个定向文件）→ 676 passed / 3 skipped / 1 failed；唯一失败 `test_book_generation_parallel.py::test_book_generation_parallel_runner_uses_workflow_metrics_and_exports_audit` 单独复跑通过（2.9s），为套件内顺序/环境 flake，与本轮 agent_runs 改动零交集（该轮全量运行本身 deselect 了本轮测试文件）；定向 5 文件 112 passed 见上。合计全套 788 passed。

## Agent loop：一致性观察工具 project.consistency 挂进循环（Q1-Q8 工具化第一步）（2026-07-02）

- **背景**：TODO 优先级 1 的 Q1-Q8 一致性工具化。现有 judge/story_state 一致性实现全部 DB/BookRun 绑定，workflow narrative 账本为 demo 硬编码（左臂旧伤/save-encrypt-sync）不可接；本轮按「api 侧自包含」路线新建纯文本、path-scoped 的机械观察扫描，遵守「不做未验证误报率的硬判定」护栏——工具只报观察，结论由 LLM 结合原文推理。
- **改动**：
  - 新增 `agent_runs/consistency_scan.py`：`consistency_scan(project_root, terms, subpath, glob)`——词条出现分布（逐文件 count + 首末行号，含缺席词条 missing 标记，≤30 词条）、中文叙事时间标记罗列（内置正则、按阅读顺序、≤80 条）、跨文件重复子句（标点切分、≥6 字、≥3 次，top20）；路径边界复用 fs_tools（越界拒绝），文件数/字节/输出全部设上限并带截断标记。
  - 注册：`tooling.py` spec（domain=project，auto/read，root_agent+context_explorer）+ `role_catalog.py` 两角色 allowed_tools（投影测试强制一致）+ `runtime.py` handler + `loop_runtime.py` schema/名称映射/输出摘要/系统提示（「先拿观察信号再抽读原文核实」）。
- **证据（单测 + TestClient）**：新增 `tests/test_agent_consistency_scan.py` 7 用例（词条分布与缺席、时间标记阅读序、跨文件重复子句阈值、subpath/glob 作用域、越界拒绝、词条去重截断、二进制跳过）；`test_agent_loop_runtime.py` 增循环集成用例（观察信号原样喂回模型、证据链落 project.consistency）。定向 `pytest tests/test_agent_consistency_scan.py tests/test_agent_loop_runtime.py tests/test_runtime_tools.py` → 22 passed；`tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_fs_tools.py` → 98 passed；全量其余 → 676 passed / 3 skipped / 1 failed（仍为 `test_book_generation_parallel` 已知顺序 flake，单独复跑 1 passed / 2.9s，与本轮零交集）；`ruff check` 通过（修 1 处 import 排序）。
- **真·LLM 实跑（证据 `.codex/real-llm-agent-loop-consistency-20260702`）**：单条消息「检查全书称谓/时间线/重复表达一致性」→ deepseek-v4-flash 自主 fs.list → 读设定/大纲 → project.consistency → 回原文抽查（5 轮 / 7 工具 / 27.8s）；正确把「裴少卿 / 裴砚」判为叙述与对话的合理称谓分工而非冲突误报，时间线连续性与重复扫描结论经人工核对属实、无伪造问题；脱敏扫描无密钥。
- **事实源同步**：current-phase / TODO / CLAUDE 增一致性工具边界（只报机械观察不下结论）与实跑证据；下一步改为剩余显式 intent 循环化 + 深度一致性能力（Character Bible / 语义 judge）工具化。
- **未验 / 不外推**：大项目截断路径只有单测覆盖未实跑；`project.consistency` 不具备语义一致性判定能力（时间标记不解析先后关系）；单一 provider；真机 GUI 未验。

## Agent loop：写作任务循环化——file.create 新文件起草补丁（跨栈）（2026-07-02）

- **背景**：TODO 优先级 1 的「写作任务等剩余显式 intent 循环化」。对本地项目作者线，写作任务的真实形态是「对话起草新章节文件」而非 DB 绑定的 BookRun；chapter.review / bookrun.* 绑定 DB 实体且 BookRun 已定位后台工具，**记为决定不并入循环**（如需可再议）。
- **后端改动**：
  - `assistant/service.py` 新增 `draft_file_content`（起草导向 system prompt，`assistant.draft` 证据链，不写盘）+ `AssistantDraftRequest/Response` schema（不加 REST 路由，OpenAPI 零漂移）。
  - `fs_tools.resolve_new_project_file`：尚不存在路径 → 越界拒绝的绝对路径（已存在 / 指向目录一律拒）。
  - `runtime.py`：`file.create` handler（补丁 `kind=file_revision` + `created_by_tool=file.create` + `before=""`，复用前端既有补丁 kind 契约）；`_execute_tool` 豁免集加 file.create；loop 回调分支（LLM 只给 path+instruction，绝对路径后端解析）。
  - `loop_runtime.py`：file_create schema + 名称映射；「一次对话一个补丁」守卫与工具撤下扩展为 `_PATCH_TOOLS`（revise+create 共享）；系统提示补新文件起草与红线。
  - `tooling.py` / `role_catalog.py`：file.create spec（confirm / write_pending，root_agent）投影一致；`event_sink` 的 permission_required `blocked_tool` 按补丁 `created_by_tool` 标记（revise 缺省不变）。
- **前端改动（补齐"补丁指向未打开文件"的既有缺口，新文件场景复用同一机制）**：
  - `assistant-events.ts`：`emitFileSuggestion` 增待领取缓冲 + `takePendingFileSuggestion`（一次性领取）。
  - `App.tsx`：Agent 补丁指向项目内未打开文件时自动打开目标文件。
  - `useSuggestionWriteback.ts`：直接命中即消费缓冲；新增 `adoptPendingSuggestion` 供加载完成后领取。
  - `useEditorFileLoader.ts`：文件不存在按新文件空内容打开（pathExists 不可用时回退旧行为）；加载完成领取待处理补丁。
  - 下游零改动：Monaco 空 before diff、Tauri write_file 自动建父目录、版本快照 / author-loop、hunk 分块对空 before 均现状兼容（前端侦察结论 + 新增单测锁定）。
- **证据**：
  - 后端定向：`tests/test_agent_loop_runtime.py`（13 用例，新增 file.create 起草补丁暂停 + 已存在路径拒绝）+ runtime_tools/agent_runs/orchestrator/fs/consistency/assistant_sessions → 17 + 109 passed；全量其余 → **673 passed / 3 skipped / 0 failed**（本轮连已知 flake 未触发）；ruff 通过。
  - 前端：typecheck 干净；单测 95 passed（新增待领取缓冲语义 + 空 before 纯插入 hunks）；`verify:agent-conversation` 真浏览器门禁通过。
  - `pnpm.cmd lint` 0 error；phase9 事实钉 14 passed。
- **真·LLM 实跑（证据 `.codex/real-llm-agent-loop-create-20260702`）**：单条消息「写第三章」→ deepseek-v4-flash 8 轮 / 12 工具：读大纲设定前两章 → file.create 起草 488 字 → **自主 project.consistency 复核**；守住大纲约束（后幕身份未提前揭晓）；双重红线实证——盘上不落新文件 + 模型两次读未确认新文件被拒；脱敏无密钥。
- **未验 / 不外推**：真机 GUI「自动打开新文件 + PatchReviewPanel 确认写回」观感未验（前端改动仅单测 + 浏览器 smoke 证据）；单一 provider；深度一致性（Character Bible / 语义 judge）未工具化——语义 judge 直读 os.getenv、不吃 llm-provider.json 覆盖链，迁 resolved_llm_env 后再挂。

## Agent loop PR-G1：resolved_llm_env 下沉 app/common + 语义 judge 吃 llm-provider.json 覆盖链（2026-07-02）

- **背景**：TODO 优先级 1「深度一致性（Character Bible / 语义 judge）工具化」的前置。`judge/semantic.py` 直读 `os.getenv`，不吃 `.env settings → llm-provider.json` 覆盖链，桌面私测 Alpha 写盘换模型对语义 judge 无效；且 `resolved_llm_env` 原在 `book_runs/book_generation_preflight.py`，book_runs 已 5 处依赖 judge，judge 反向 import book_runs 是循环依赖地雷——按设计下沉而非顺手接。
- **改动**：
  - 新增 `app/common/llm_env.py`：`resolved_llm_env` / `_apply_llm_config_file` / `LLM_SETTINGS_ENV_KEYS` 原样下沉（common 叶子，仅依赖 llm_http/config，行为零变化）；`book_generation_preflight.py` 改 facade re-export（宪法第 5/6 条），既有 assistant / ide / agent_runs / author_chat 调用方零改动。
  - `judge/semantic.py`：`STORYFORGE_LLM_*` 改走 `resolved_llm_env()` 覆盖链（env → .env settings → llm-provider.json），`STORYFORGE_JUDGE_LLM_*` 保持进程 env 独占最高优先级；`semantic_judge` / `semantic_judge_with_status` 增可选 `llm_env` 参数（显式配置源注入，向后兼容）；未配置 key 仍判「未启用」不判失败。
  - `tests/conftest.py` autouse 隔离补 delenv `STORYFORGE_LLM_CONFIG_FILE`（迁移后本机 llm-provider.json 真 key 不再可能泄入单测远程调用路径）。
- **证据**：新增 3 用例——judge 吃 llm-provider.json（baseUrl/model/apiKey 全生效 + Bearer 头）、`STORYFORGE_JUDGE_LLM_*` 仍压过配置文件、preflight facade 与 common 实现同一性钉。定向 `uv run pytest tests/test_judge_semantic.py tests/test_llm_config_file_override.py -q` → 11 passed；全量 `uv run pytest -q` → **802 passed / 3 skipped / 0 failed**（含 phase9 事实钉）；`uv run ruff check`（6 个涉改文件）通过。
- **未验 / 不外推**：语义 judge 尚未挂进 agent 工具循环（PR-G2 做）；`STORYFORGE_JUDGE_LLM_*` 独立 judge 端点与 auth_header（api-key 型）差异化未纳入覆盖链（judge 仍固定 Bearer，与迁移前一致）；无真·LLM 实跑（本 PR 为纯配置解析迁移，行为由单测钉住）。

## Agent loop PR-G2：深度一致性（Character Bible / 语义 judge）挂进工具循环 project.deep_consistency（2026-07-02）

- **背景**：TODO 优先级 1 的深度一致性工具化（前置 PR-G1 #57 已让语义 judge 吃 llm-provider.json 覆盖链）。本地作者项目没有 DB 版 character_bible 实体（chapter.review / bookrun.* 不进循环同理），Character Bible 数据源取本地项目文件：默认扫 `人物/` `设定/` 目录 md，或由模型显式传 `bible_paths`。
- **改动**：
  - 新增 `agent_runs/deep_consistency.py`：`deep_consistency_review(project_root, path, bible_paths, facts, llm_env)`——path-scoped 读目标稿件（24K 字预算）与 bible 文件（12 文件 / 单文件 2K / 总 12K 预算，全部带截断标记）；人物目录喂 judge 的「角色声音约束」槽位、其余设定文件与已核实 facts（≤40）喂「必含事实」槽位；经 `semantic_judge_with_status(llm_env=...)` 产出结构化 issue（类别 / 严重度 / span + 换算行号）。未配置 LLM 或远程失败一律显式 FsToolError（循环把它作为观测反馈给模型），不伪造「无问题」；不写盘、不落 judge DB 实体，输出带「advisory 参考信号」提示。
  - 注册四层：`tooling.py` spec（domain=project、auto/analyze、root_agent、required_capabilities=llm）+ `role_catalog.py` root_agent allowed_tools（投影测试强制一致）+ `runtime.py` handler + `loop_runtime.py` schema / 名称映射 / 输出摘要 / 系统提示（「先机械观察定位疑点再深查、结果须抽读原文核实」）；顺带把 loop_runtime 模块 docstring 的工具面描述补到当前真实面。
- **证据（单测 + TestClient）**：新增 `tests/test_agent_deep_consistency.py` 7 用例（bible 分槽喂入与 issue 行号序列化、未配置 LLM 显式报错、judge failed 显式报错、目标 / bible 越界与空文件拒绝、显式 bible_paths 优先、内容与摘录预算截断、facts 清洗去重截断）；`test_agent_loop_runtime.py` 增 2 用例（循环内语义 issue 信号喂回模型 + 证据链落 `project.deep_consistency`；未配置 LLM 时工具错误反馈不中断循环）。定向 `pytest tests/test_agent_loop_runtime.py tests/test_runtime_tools.py tests/test_agent_deep_consistency.py` → 26 passed；关联域 `tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_agent_consistency_scan.py tests/test_agent_fs_tools.py tests/test_judge_semantic.py` → 113 passed；全量其余（deselect 上述 5 文件）→ 698 passed / 3 skipped / 1 failed，唯一失败 `test_book_generation_parallel.py::test_book_generation_parallel_runner_defaults_to_precommit_revision_dependency` 为该文件已知时序 flake（本分支零触碰 book_runs；复跑 5 次单用例 + 整文件 12 用例全部通过）；`ruff check` 通过。
- **真·LLM 实跑（证据 `.codex/real-llm-agent-loop-deep-consistency-20260702`）**：第二章故意埋 6 处违背人物设定 / 世界观的矛盾（涨潮夜点灯 / 闪光次数 / 右臂拎重物 / 瞎眼打量 / 自称说谎 / 话痨），单条消息 → deepseek-v4-flash 4 轮 / 6 工具（fs.list → fs.read×4 → project.deep_consistency 自主传 bible_paths 三文件，58.7s）；语义 judge `issue_count=6`，模型分级结论 **6 处埋雷全中零漏报**（人工核对），另产出一条叙事层建议且正确引导走修订补丁确认流程；语义 judge 经 llm-provider.json 覆盖链真实出网（live 验证 PR-G1）；脱敏扫描无密钥。
- **事实源同步**：CLAUDE.md / current-phase / TODO 更新 Agent loop 边界（深度一致性入循环、语义 judge 迁移完成）、能力条目、真实 LLM 证据与禁止宣称范围（deep_consistency 为 advisory 信号，显性矛盾场景实证、隐性 / 跨章召回率未验）。
- **未验 / 不外推**：真机 GUI 观感未验；单一 provider；埋雷为显性矛盾，隐性 / 跨章长程矛盾召回率未验；`project.deep_consistency` 输出不构成质量判定。

## P1 修复：reasoning-leak 剥离大小写 bug + 有损剥离可观测化（2026-07-03）

- **背景**：真机 GUI e2e（证据 `.codex/real-gui-e2e-20260703/`）发现 file.create 起草的第03章首行「# 第三章 晨渡」写盘后只剩「渡」。取证：DB `agent_artifacts` 里补丁 `after` 即已截断且全文零 think 残留 → 事故形态是模型把 `</think>` 关闭边界吐在标题第 7 字后（成对块或 R1 式裸关闭），`strip_reasoning_leak` 忠实剥除、正文前缀随推理一起丢失；因原始响应不落任何地方，事后无法归因。复查代码另发现真实潜伏 bug：`llm_http.py` 的 `THINK_CLOSE_RE.search` 大小写不敏感、`rfind("</think>")` 大小写敏感，模型吐 `</Think>` 变体时 rfind 返回 -1，切片退化 `cleaned[7:]`——无条件砍掉正文前 7 个字符（本次事故未触发此形态，但同类静默损坏）。
- **改动**：
  - `app/common/llm_http.py`：`strip_reasoning_leak` 改用 `THINK_CLOSE_RE.finditer` 取最后闭合标签（与 search 同语义，杀掉 rfind 大小写退化）；剥离改动内容时打 `llm_reasoning_leak_stripped` 结构化警告（raw_chars/cleaned_chars/raw 头尾各 120 字），下次事故可归因。
  - `book_generation_llm.py`：`_call_llm` / `_call_llm_messages` 剥离改动内容时在结果带 `reasoning_leak_stripped=True`。
  - `assistant/service.py`：`draft_file_content` / `revise_file_content` 把该标记透传进 `assistant.draft` / `assistant.revise` 工具证据链 output_summary，人工可复核。
- **证据**：新增 3 用例（`</Think>` 裸闭合与小写同语义、变体在末尾返回空串走「仅含思维链」显式报错而非砍头静默损坏、revise 证据链带 reasoning_leak_stripped 标记）+ 干净路径断言不带标记。定向 strip 7 passed、assistant 12 passed；全量 `pytest tests/ -q` → **814 passed / 3 skipped / 0 failed**；`ruff check`（5 涉改文件）通过。
- **未验 / 不外推**：模型侧把正文写进 think 块属于上游输出畸形，代码无法找回内容——本修复保证的是「变体标签不再造成额外静默截断 + 一切有损剥离留痕可归因」；未做起草产物结构校验/自动重试（避免伪造兜底与成本放大，待有更多样本再定）。

## 深度一致性评审修复：issue 行号以 matched_text 反查为准 + judge configured 标志（2026-07-03）

- **背景**：外部代码评审指出两个已核实问题（优先级 一 与 四）。一：`project.deep_consistency` 的 issue 行号完全来自 LLM 自报的 0-based 字符偏移（中文正文下出了名不可靠），`_issue_from_llm_item` 只做钳位、matched_text 缺失时才从 span 反切——方向反了，行号错会推高作者核实成本。四：`deep_consistency_review` 前置复制了一份 judge 的 API key 探测表达式（judge 把「未配置」和「无问题」都表达成 `failed=False + issues=[]` 无法区分所致），key 解析细节两处口径将来必漂移。
- **改动**：
  - `judge/semantic.py`：新增 `_locate_matched_span`——matched_text 非空时在正文 `find` 反查真实偏移，多处命中取距模型自报位置最近的一处；反查不到（模型转述）回退钳位后的自报 span。作用于 `_issue_from_llm_item`，远程与 provider 注入路径同享。
  - `judge/types.py`：`SemanticJudgeOutcome` 增 `configured: bool = True`（frozen dataclass 带默认值，四处既有调用方零改动）；`semantic.py` 未配置 key 时返回 `configured=False`。
  - `agent_runs/deep_consistency.py`：删除复制的 key 探测与 `os`/`env_value` 依赖，改判 `outcome.configured`，报错文案不变（循环反馈与前端观感零变化）。
- **证据**：test_judge_semantic 新增 5 用例（反查修正错误自报 span、多处命中取最近、转述回退钳位 span、未配置 configured=False、provider 路径 configured=True）；test_agent_deep_consistency 新增 2 用例（跨行 span 行号换算 + 越界 span 钳位末行不崩；不打桩走真 judge 的未配置显式报错——空配置源零网络调用）+ 原未配置用例改 configured 口径。定向 22 passed；关联域（agent_loop_runtime/runtime_tools/judge_* 5 文件）31 passed；全量 `pytest tests/ -q` → **821 passed / 3 skipped / 0 failed**；ruff（5 涉改文件）通过。
- **未验 / 不外推**：反查以 matched_text 与正文逐字一致为前提，模型摘抄带省略号/改字仍会回退自报 span（行号仍可能偏）；未做真·LLM 实跑复验行号命中率；评审余项 二（few-shot 形状）、三（scene_id 哑值 + 魔数 100）、五（retry_safe 标注）未在本 PR 处理。

---

# 2026-07-03 夜跑 review 验收修复轮验证记录

- **范围**：PR #61（judge 复审余项收口）+ PR #62（夜跑 review 四项修复：F-001 配置事实源统一、F-004 事件序号唯一索引+重试、F-002 chapter.review 单补丁、F-003 前端 repair_patch 审批链路、intent 顺手项）。验收报告见 PR #62 描述（原 `.codex/overnight-review-20260703/acceptance-report.md`，验收后按约定清理）。
- `cd apps/api && uv run pytest`：830 passed, 3 skipped（新增 6 测试）。
- `npm --prefix apps/desktop/frontend run test`：96/96；`typecheck` 通过。
- `pnpm lint`：通过（含 `health/router.py` 存量 I001 修复）；`pnpm --filter @storyforge/shared test` 通过。
- `pnpm openapi`：快照零漂移。
- `node scripts/run-e2e.mjs --continue-on-error`：contract 18 pass / 9 fail，与干净 master stash 对照**完全一致**——9 个失败为 master 存量（疑似 UI 改版后 testid 漂移），与本轮变更无关，已开 issue 跟踪。
- 已知存量 flaky：`test_ten_chapter_wrapper_probe_only_passes_with_local_provider` 约 1/3 概率失败（假 HTTPServer 与 PS 探针时序），三连跑验证与代码变更无因果。
- 未联通能力：真机 GUI 观感未验（本轮均为 headless/单元/契约验证）；repair_patch 审批链路当前桌面 UI 不可达，属契约债修复。

---

# 2026-07-03 issue #63 修复：e2e contract 存量 9 失败（source-evidence 标记漂移）验证记录

- **范围**：仅改 5 个 e2e spec（`tests/e2e/ide-shell / ide-judge-repair / phase3 / phase4 / phase5-runtime-diagnostics`），零产品代码。逐条核对后 9 个失败**全部定性为标记漂移，无能力丢失**：
  - 前端拆分漂移：`App.tsx` 壳层拆 `components/app/*`（`editor-panel` testid 移 `RightWorkspace.tsx`，ChatWindow 挂 `WelcomeWorkspace`，ResourceExplorer 挂 `StoryNavigator`）；`api-client.ts` 拆 `lib/api/*`（assistant / agent-socket / types），api-client 保留 re-export 门面；Editor 修订闭环拆 `components/editor/useSuggestionWriteback.ts`。spec 改为拼接新源或指向新文件。
  - 后端拆分漂移：`domains/ide/service.py` 拆 `artifact_preview.py / _coerce.py / workspace_reads.py / command_registry.py`，marker 全数落位。
  - 文案/命名迁移：设置页「密钥引用」→「API Key」（BYO-key 改版）；provider 预设 `custom` → `openai-compatible`；`REVIEW_CURRENT_EVENT` 退役由 `REVIEW_ISSUES_EVENT` 接替（审稿并入 agent 循环）。
  - 契约扩展：`/api/runtime-tools` 变 agent_runtime + internal + mcp 三源合并——phase4 deepEqual 改为筛 `origin="internal"` 投影对比 registry，并新增三 origin 在场断言；phase7 治理清单更新 `RuntimeToolRead` 7→20 字段、`ModelRunRead` 18→29 字段（与快照/live OpenAPI 双向核对）。
- **证据**：`node scripts/run-e2e.mjs` 四阶段全绿（exit 0）——OpenAPI refresh+drift PASSED；contract **27 pass / 0 fail**（修前 18/9）；API verification 68 passed；workflow verification 69 passed。`pnpm.cmd lint` 通过（Editor.tsx 1 个存量 react-hooks warning，非本次引入）。
- **顺手发现（未处理，不扩范围）**：`requestRevision`（`lib/api/assistant.ts`）已无组件调用方，修订链路走 agent 循环 proposed patch 后属死代码残留；spec 仍断言其 API 面存在。
- **未验 / 不外推**：本轮为 headless 契约验证，不构成真机 GUI 观感验收；issue #63 内另记的 connectivity probe flaky（1/3 概率）与本修复无关，仍为存量。

---

# 2026-07-03 ultracode 架构评审与后续架构蓝图(docs-only)验证记录

- **范围**:仅新增 `docs/internal/arch-review-blueprint-2026-07-03.md`,零产品代码改动。内容为多 agent 架构审计(7 子系统测绘 + 8 维度评审 + 逐条双重对抗核查,14 条重大发现确认 / 4 条价值否决 / 20 条 advisory)与三方案架构竞标(A1 极简单机 / A2 Agent 内核 / A3 渐进绞杀,三裁判全票 A3 胜出)的综合蓝图:目标架构七件事、W0-W7 + E2E-1 路线图、推翻拍板清单与决策记录。
- **决策记录(2026-07-03 用户拍板)**:pre-push 加活路径快测集=接受;死域终局=彻底删除(W4 冻结→观察→删除路径不变);BookRun→managed run=质量轨重跑后必须重评;代码签名证书=先不买;§8 推翻项 2-5 随对应波次(W0/W2/W4/W5)PR 落地。
- **证据**:审计与竞标全量 JSON 存档于会话工作目录(audit-final.json 217KB / design-final.json 148KB,文档 §11 有指针);全部发现要求 file:line 亲读证据并经"事实核查 + 价值核查"双票存活。
- **未验 / 不外推**:本文件是规划文档,不代表任何波次已执行;各推翻项在对应波次 PR 合并前现行拍板继续有效。

---

# 2026-07-03 W0-A:sidecar-smoke 双档门禁 + sqlite WAL/busy_timeout + 快照保留上限 验证记录

- **范围**(蓝图 W0 第一刀,修 F13/F29/F37):
  - 新增 `scripts/sidecar-smoke.mjs`:交付形态自动化冒烟——临时 sqlite → 起服 → 轮询 `/health/ready`(记录冷启动耗时与预算)→ 无 LLM 的 assistant 会话 REST 往返 → Agent WS 一轮(未知消息类型换取确定性 error 帧)→ taskkill 进程树。daily 档(默认)跑源码 `run_windows.py` 并挂进 `pnpm verify`;packaged 档(`--packaged`)先构建 PyInstaller 冻结 exe 再对产物跑同套 smoke(`--skip-build` 可复用现有 exe),入口 `pnpm smoke:sidecar` / `pnpm smoke:sidecar:packaged`。
  - `app/db/session.py`:sqlite 引擎补驱动级 busy timeout(connect_args timeout=30,`STORYFORGE_SQLITE_BUSY_TIMEOUT_SECONDS` 可调)+ 文件库启用 WAL(connect 事件 PRAGMA);新增 `_enable_sqlite_wal` 可测缝。
  - `apps/desktop/frontend/src/lib/versions.ts`:`.storyforge/versions` 每文件快照保留上限 20 份,超出连同 meta 一起删,清理失败仅告警不阻断写回主路径。
- **证据**:
  - daily 档实跑两次全绿:`/health/ready` 就绪 2768ms(预算 60s),assistant 往返(session id 建/列)、WS error 帧往返、进程树清理与临时库删除全部通过。
  - packaged 档对 2026-07-01 存量冻结 exe 实跑,**第一次即抓到真实漂移**:旧 exe 拒绝 `project_path`(extra_forbidden 422)——该字段为 2026-07-02 PR#48 新增,装机产物落后源码一个版本,正是该档位设计要抓的故障类别。重建 exe(PyInstaller 6.21,130s)后 packaged 档全绿:冷启动 3674ms(预算 90s)。
  - `uv run pytest` 全量:832 passed / 3 skipped(test_db_session 新增 2 用例:busy timeout 选项 + WAL 模式实测;两处旧断言随新 connect_args 行为更新);ruff 通过;`npm run typecheck`/`test` 96/96;`pnpm.cmd lint` 通过(仅 Editor.tsx 存量 warning)。
- **未验 / 不外推**:smoke 覆盖起服/REST/WS 通道,不覆盖 LLM 出网与补丁写回链;packaged 档暂未接入每波合并强制流程(蓝图 W5 gate 落地);快照总量上限(跨文件)未做,当前仅每文件上限。

---

# 2026-07-03 W0-B1:e2e 契约化(废 assertSourceEvidence)+ drift 单实现 + 门禁去重 + 死码清理 验证记录

- **范围**(蓝图 W0,修 F07/F14 及 F33 部分,推翻项②的落地刀):
  - tests/e2e 六个 spec 契约化:删 43 处 assertSourceEvidence 源码字面子串断言 + 18 处 readFileSync 源码读取管道,helper 全仓清零;**同 PR 先补后删**——为被删标记名义守护的后端契约面补齐 OpenAPI 结构断言(ScenePacket/JudgeIssue/RepairPatch/BatchRefinery/workspaces/collaboration/commercial/analytics/evaluations/prompt-packs/artifacts/retrieval/ModelRun 等端点与 schema 字段在场断言);纯前端 testid/文案类标记无契约面直删。ide-shell.spec.ts 全文件为前端标记,整删并出清单;ide-judge-repair.spec.ts 重写为纯 OpenAPI 契约 spec(assistant/revise、context-snapshot、artifact preview、diagnostics/commands)。phase5 中「门禁测门禁」(锁 run-e2e.mjs/verify-local.ps1/generate-openapi.ps1/package.json 自身文本)两个测试删除,十组 assertSchemaFields 与 live app.openapi() deepEqual 实跑保留。
  - drift 收敛单实现:check-openapi-drift.mjs 是唯一实现,run-e2e.mjs 与 verify-local.mjs 均改为 spawn 它;run-e2e 内嵌 python 刷新脚本/基线复制/git diff --no-index 删除;run-e2e 收敛为「drift + 契约 spec」两阶段,pytest 3/4 阶段(20 API + 7 workflow 目标)删除(pnpm verify 已全量覆盖)。
  - 死码清理:requestRevision 前端链(assistant.ts 函数 + api-client.ts re-export + api-client.test.ts 两个测试块;后端 POST /api/assistant/revise 未动且新增 OpenAPI 断言护栏);verify-local.ps1(356行)/generate-openapi.ps1 双实现与 package.json verify:infra 入口;apps/desktop/src/ 两个游离 tauri-fs(零引用)。test_phase9_fact_sources.py 摘 3 条锁已删 CI 的断言;test_source_pruning.py:28 锁 verify-local.ps1 文本的读取一并摘除(超出清单的必要一改)。
- **证据**:`node scripts/run-e2e.mjs` exit 0(drift PASSED,契约 spec 6 文件 21/21,总时长秒级);`pnpm.cmd lint` 0 error(仅 Editor.tsx 存量 warning)+ Prettier 全过;desktop typecheck 干净、test 94/94(-2 为删除的 requestRevision 测试块);`uv run pytest tests/test_phase9_fact_sources.py tests/test_source_pruning.py -q` 29 passed;grep 复查 assertSourceEvidence/requestRevision 代码引用清零。
- **未验 / 不外推**:WS 消息 shape 校验属 W6 不在本刀;CLAUDE.md §4 门禁说明与 :51 的 verify-local.ps1 提及待 W0-B2 改写;「重命名前端组件不再触发 e2e 假红」由机制保证(e2e 不再读前端源码),未做专门实验。

---

# 2026-07-03 W0-B2:pre-push 活路径快测集 + CLAUDE.md 门禁改写 + schema 冻结公告 验证记录

- **范围**(蓝图 W0,修 F12,推翻项①落地——2026-07-03 用户已批准):
  - 新增 `scripts/fast-tests.mjs`(入口 `pnpm test:fast`):活路径 pytest 快测集(agent_runs/assistant/ide 命令/llm 配置 14 个文件 145 用例;test_ide_agent_orchestrator facade 套件与已知 flaky 探针不在集内,由 verify 全量覆盖)+ desktop 前端单测。
  - `.githooks/pre-push` 升级为 `verify:fast && test:fast`(lint + drift + 快测集)。
  - CLAUDE.md:验证门禁段改写(verify=全量一遍含 sidecar-smoke;e2e=契约-only 秒级;drift 单实现;packaged 档为波次合并/发版前强制;删 verify-local.ps1 提及);§6 置顶 **schema 冻结公告**(至 W2 落地:不合并 ORM 加列,新工具先做纯文件版,依据 F01)。
- **证据**:`pnpm test:fast` 实测 1m35s(快测集 145 passed + desktop 94/94),加 lint+drift 后 pre-push 总耗时约 2.8 分钟,在 3 分钟预算内;**拦截实验**——把 test_agent_fs_tools.py 临时替换为必败测试后 `pnpm test:fast` exit=1(蓝图 gate:pre-push 实测拦截一次故意注入的 pytest 失败),恢复后工作树干净;`pnpm.cmd lint` 通过。
- **未验 / 不外推**:hook 需 `pnpm hooks:install` 启用且可 `--no-verify` 绕过(拍板时已知形态);快测集文件清单会随 Q1-Q8 工具化演进,增补原则=「主产品路径新增测试文件默认入集,超预算再裁」。

---

# 2026-07-03 W0-B3:死码彻底删除(memory.resolve_conflict 假成功命令 + ChatWindow 弃用 props + .codex 上下文摘要归档) 验证记录

- **范围**(蓝图 W0,死域清理最后一刀,依据 2026-07-03 用户拍板「死域代码:彻底删除」):
  - 删 `memory.resolve_conflict` 零实现假成功写命令(`command_registry._BUILTIN_COMMANDS`):该命令返回 `accepted` 却无任何领域写回,违背证据链红线(前端会误判为已审计成功)。`test_ide_command_registry.py` 重写为 `noop_write_command` monkeypatch 夹具承载「持久审计事件 + WS 命令通道」机制护栏,并新增 `test_removed_fake_success_command_returns_404` 锁定删除后返回 404;`test_ide_commands.py` 删去 `memory.resolve_conflict` 参数保真测试。
  - 删 ChatWindow 四个弃用 props(`layoutMode`/`onCollapse`/`onFocusOnly`/`onRestoreLayout`)从 `chat-window/types.ts` `ChatWindowProps`;`ChatWindow.tsx` 解构去除;`WelcomeWorkspace.tsx` 的 `<ChatWindow>` 调用与 `AgentWorkspace` 函数签名同步去除现已无用的 `layoutMode`/`onFocusOnly`/`onCollapse`(`onRestoreLayout` 仍用于侧栏切换保留);`App.tsx` `<AgentWorkspace>` 调用点去除同名传参。
  - `.codex/context-summary-*.md`:261 个历史会话上下文摘要 `git rm`(仅存于 git 历史即可,不再占工作树)。
  - 删除本地 2.5G `apps/desktop/.tauri-target-smoke` 冗余构建缓存(非版本受控)。
- **证据**:desktop `typecheck` 干净(修掉 TS6133 未用 prop 报错)、`test` 94/94;`tests/test_ide_command_registry.py`+`test_ide_commands.py` 11 passed;`pnpm.cmd lint` 0 error(仅 Editor.tsx 存量 warning)+ Prettier 全过;`node scripts/run-e2e.mjs` 21/21 契约 spec 通过 + drift PASSED;grep 复查 `memory.resolve_conflict` 仅存于 test 的删除断言、`onFocusOnly`/`onCollapse` 无生产残留。
- **未验 / 不外推**:W0 门禁体系(sidecar-smoke 双档 / e2e 契约化 / pre-push 快测集 / 死码清理)四刀均已落地;本刀不触碰任何领域行为,仅删无写回路径的假成功命令与已无消费者的 UI props。

---

# 2026-07-04 W1:live 循环语义收口(为真机 e2e 让路) 验证记录

- **范围**(蓝图 `docs/internal/arch-review-blueprint-2026-07-03.md` §7 W1,修三条 high 级审计发现 F09/F10/F11,为 E2E-1 真机验收铺路;schema 冻结下零 ORM 变更):
  - **F09 live 循环可中断 + 起服收尸**:
    - `loop_runtime.run_chat_loop` 增 `should_interrupt` 回调,每轮开头(`before_round:N`)读 `run.status`;pause/stop 命中即置 `ChatLoopOutcome.interrupted/interruption` 并返回,不再烧新一轮 BYO-key。`runtime._try_chat_loop` 传 `should_interrupt=lambda b: self._runtime_interruption(run, boundary=b)`,中断走 `_runtime_interrupted_response`(不 append 消息、不 complete,run.status 保持控制通道写入的 stopped/paused)。粒度=每轮开头,不打断进行中的单轮 LLM 调用。stop 走另一条控制 socket 提交 `run.status`,循环线程独立 session 内 `session.refresh(run)` 读到已提交状态(WAL+busy_timeout,W0 已落)。
    - `service.reap_non_terminal_agent_runs`:起服把非终态(running/paused)run 收为 failed + 写 `reason=process_restart` 事件。`main.py` lifespan 在 `bootstrap_sqlite_database` 后调用;**仅 sqlite 单进程 sidecar 收尸**(`get_engine().dialect.name != "sqlite"` 即 return)——多 worker Postgres 部署下本 worker 起服绝不误收别的 worker 在跑的 run,且非 sqlite 时不触库连接(修掉测试/CI 无 DB 时卡连接超时的回归)。
  - **F10 断线可重建终态**:
    - `service._completed_event_payload`:AGENT_RUN_COMPLETED payload 富化(intent/assistant_session_id/summary 截断/requires_user_confirmation/has_proposed_patch/proposed_patch 摘要 id+created_by_tool+file_path/has_review_report/chat_loop rounds+tool_call_count),**不带补丁 before/after 全文**避免事件表膨胀;字段全取自现有键,零 ORM 列。
    - `event_encoders`:`AGENT_RUN_COMPLETED/FAILED` 新增 `_websocket_terminal_event` 编码,断线后前端拉 `GET /api/agent-runs/{id}/events` 重放即可重建终态;happy-path 仍据瞬时 `_STREAM_RESULT` settle,终态事件是幂等补充。
    - 前端:新增纯函数 `agent-run-events.ts::reconstructAgentResultFromEvents(events, ctx)`(从事件表还原 agent_result/error/待确认消息形状,缺 assistant_session_id 返 null 继续轮询);`agent-runs.ts::getAgentRunEvents`;`agent-socket.ts` 超时回调改为 close socket → 后台 REST 轮询(3s 间隔、5min 上限)取回终态即 resolve,拿不到 runId 才退回硬超时。
  - **F11 关键词表下线**:`intent._detect_intent` 删中文关键词分支与孤儿函数 `_is_file_review_request`/`_is_file_revise_request`;固定管线只认显式 intent + 结构化参数(book_id+blueprint_id→bookrun.start、issue_id→chapter.repair、reviewer role hint+文件上下文→file.review、scene_packet_id→chapter.review、写回确认→chat.explain),其余自由文本一律落 chat.explain 工具循环。
  - **Sidecar 版本握手(taskkill+respawn)**:新增 `app/common/version.py::APP_VERSION` 单点(main.py `FastAPI(version=)` + `/health/ready` 返回 `app_version` 共用);`main.rs` 起服预检命中已跑 API 时拉 `/health/ready` 比对 `app.package_info().version`,不符即 `kill_process_on_port`(Windows netstat→taskkill /F、非 Windows lsof→kill)强杀旧孤儿 sidecar 后重启。
  - **before 漂移拒写回红线**:`patch-hunks.ts::isWholeFileDrifted(current, before, normalizeEol)` 抽为纯函数;`useSuggestionWriteback.ts` 内联比较改调它;`patch-hunks.test.ts` 加可证伪行为测试;`editor.test.tsx` 源码断言强化为锁定走 `isWholeFileDrifted` 纯函数。
- **证据**:
  - `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_agent_loop_runtime.py tests/test_ide_agent_orchestrator.py -q` → **108 passed**(含新增:循环中途 stop 收尾/reap/complete payload 富化/terminal 编码器/F11 显式 intent 契约改写×3)。
  - `uv run pytest -q`(全量)首轮暴露 2 处 F11 关键词依赖失败(test_ide_agent_orchestrator 的显式 revise 覆盖 + revise 集成)已改显式 intent 修绿;`uv run pytest tests/test_health_probes.py -q` 8 passed(新增 app_version 断言)。
  - `uv run ruff check app tests` All checks passed。
  - `npm --prefix apps/desktop/frontend run test` → **101/101**(新增 patch-hunks 漂移行为 2 + agent-run-events 重建 5);`typecheck` 干净;`pnpm.cmd lint` 0 error(仅 Editor.tsx 存量 warning)+ Prettier 全过。
  - `node scripts/check-openapi-drift.mjs` 无漂移(/health/ready 无 response_model,加 app_version 不进 schema)。
  - `cd apps/desktop/src-tauri && cargo check` Finished(首轮 reqwest 未启用 json feature 报错,改 `.text()`+serde_json 解析修绿)。
  - **性能回归自捕**:`_reap_stale_agent_runs` 初版无 sqlite 守卫,`client` fixture 走 lifespan 时对默认 Postgres URL 连接超时,使每个用例 setup 挂 ~131s;加 dialect 守卫后单测 setup 131s→0.87s。
- **未验 / 不外推**(归 E2E-1 真机清单,本波只落条目不执行):真机 GUI 多轮渲染;点停止→事件表无后续 tool_trace 的桌面端观感;超时→转后台轮询实际取回结果的 socket/WS 生命周期;强杀宿主→重启无孤儿且连新 sidecar 的版本握手实机验证;补丁确认与自动打开新文件观感。F09 中断粒度为「每轮开头」,不打断进行中的单轮真模型调用(设计如此)。

---

# 2026-07-04 W2:sqlite schema 单一事实源(唯一定时炸弹 F01 拆除) 验证记录

- **范围**(蓝图 `docs/internal/arch-review-blueprint-2026-07-03.md` §7 W2,拆 critical 级审计发现 F01「发布态 sqlite 零迁移机制、双 schema 事实源已现漂移」):让 sidecar 起服跑 alembic 收口,alembic 成为 schema **前向演进**的单一事实源,解除 2026-07-03 起的 schema 冻结。
- **关键设计事实(先证后写)**:实测 `alembic upgrade head` 在全新 sqlite 上**跑不通**——历史迁移链在 `20260527_0001` 用 `op.create_foreign_key`,SQLite 无 batch 时 `NotImplementedError`,只建出 14/45 表即崩。故不重写 23 条历史迁移(A3「移动不重写、不压扁」),采**混合设计**:建表仍由 `create_all` 负责,alembic 只承担版本记账 + 前向 ALTER。这正是拆 F01 所需——发版新增列写成 batch 安全迁移,存量库起服 `upgrade head` 补列,不再 create_all 只建表不 ALTER 而崩服。
- **落地**:
  - `apps/api/app/db/migrations.py`(新):`_alembic_script_location()` 兼顾源码(`parents[2]/alembic`)与冻结 exe(`sys.frozen`→`_MEIPASS/alembic`);`build_alembic_config` 编程构造 Config(不读盘 alembic.ini);`stamp_head` / `upgrade_head` 经 `config.attributes["connection"]` 注入现有连接复用 WAL 引擎;`head_revision` / `current_revision`;`backup_sqlite_database`(SQLite backup API 一致快照,命名 `<库>.pre-alembic-<版本>.bak`,`_prune_backups` 保留最近 3 份)+ `quick_check`。
  - `apps/api/alembic/env.py`:`run_migrations_online` 优先用注入连接(无则自建 NullPool),`_run_migrations_with_connection` 对 sqlite 置 `render_as_batch=True`。
  - `apps/api/app/db/session.py::bootstrap_sqlite_database` 重写为三分支:已纳管(有 `alembic_version`)→`upgrade_head`;存量 create_all 库(有业务表、无 `alembic_version`)→`_adopt_legacy_sqlite_database`(quick_check 失败即抛错中止 → 备份 → create_all 补表 → 补 agent_run_events 唯一索引[镜像迁移 20260703_0001,create_all 不给存量表补索引] → `stamp_head`);全新库→create_all + `stamp_head`。任一 alembic 步骤异常回退纯 create_all + 唯一索引并告警,保证 sidecar 仍起服(create_all 保留为回退)。删每次起服都跑的 `_ensure_agent_run_event_sequence_unique` 调用,收敛为仅纳管/回退触发。
  - `apps/api/app/main.py::_log_sqlite_schema_state`:起服后记 `sqlite_schema_ready revision=/head=/managed=`,冻结 exe 漏打 alembic 脚本 → 回退 create_all → managed=false 即暴露。
  - `apps/desktop/scripts/build-api-sidecar.mjs`:加 `--add-data <alembic>{;|:}alembic` 把迁移脚本打进冻结 exe。
  - `scripts/sidecar-smoke.mjs`:两档 smoke 收尾断言 `sqlite_schema_ready` 存在且 `managed=true`(剥 ANSI 后正则),把「冻结 exe 漏打脚本/收口静默失败」变成红。
- **证据**:
  - **F01 拆除实证**:`tests/test_sqlite_migrations.py::test_managed_db_applies_pending_migration` — 已纳管库删 `project_path` 列 + stamp 到该列引入前版本,起服 `bootstrap_sqlite_database` 走 `upgrade head` 把列补回、版本推到 head。**这是 create_all-only 时代必崩、混合设计已拆的定时炸弹场景**。
  - `cd apps/api && uv run pytest tests/test_sqlite_migrations.py tests/test_db_session.py -q` → **18 passed**(8 迁移 + 10 既有 db_session)。覆盖:全新 stamp head;存量库纳管后逐表逐列 == 全新库 + 留一份备份;唯一索引纳管补回;head down/up 往返(downgrade 可用性);备份保留 3 份;quick_check 失败回退不 stamp;非 sqlite 直接返回。
  - `node scripts/sidecar-smoke.mjs`(daily 档,源码 run_windows.py):就绪 3350ms,assistant 往返 + WS 一轮 + **sqlite schema managed=true** 全绿。
  - `node scripts/sidecar-smoke.mjs --packaged`(packaged 档,PyInstaller 冻结 exe):构建成功、就绪 4164ms、**冻结 exe 内 alembic 脚本可达、schema managed=true** 全绿——证明 `--add-data` 打包 + `_MEIPASS` 定位在发布形态真跑通。
  - `uv run ruff check app/db app/main.py tests/test_sqlite_migrations.py alembic/env.py` All checks passed。
  - `pnpm.cmd lint` 0 error(仅 Editor.tsx 存量 warning)+ Prettier 全过。
  - `cd apps/api && uv run pytest -q`(全量回归):**844 passed / 3 skipped**(6 条 warning 均为既有、与本波无关),起服路径改写零回归。
- **未验 / 不外推**(归 E2E-1 真机清单):真机「旧版 NSIS 存量库换新 exe 起服 → 会话史完整 → schema 纳管」端到端;存量库纳管的 backup/quick_check/stamp 只在 fixture 与本机 smoke 验证,未在真实旧版安装包库上跑。历史 pg 迁移(24 条)未压扁(蓝图定的止损点),pg 侧仍走既有 `alembic upgrade head` 部署路径,本波不改。混合设计的边界:SQLite 建表仍靠 create_all,新迁移必须 batch 安全 + 带 downgrade(约定见 `CLAUDE.md` §6),否则 `upgrade head` 会在存量库上崩——此约束靠评审与 downgrade fixture 守,未加 lint 硬约束。

---

# 2026-07-04 W3(首刀):LLM 单一 chat 通道 + story_state 漏迁修复 + 密钥脱敏 验证记录

- **范围**(蓝图 `docs/internal/arch-review-blueprint-2026-07-03.md` §7 W3,拆 high 级 F16「出网通道碎片化 + 依赖倒挂」的核心):把 chat/completions 出网收敛到唯一通道,切断 live 循环对已降级 book_runs 域的寄生,并修复 story_state grounding 在 sidecar 下静默失活的真 bug。本刀取 F16 中最高价值、可零测试改动落地的部分;judge/story_state 的 httpx 传输统一、embedding/reranker、workflow 第 7 客户端(W5 将删)留作后续。
- **落地**:
  - `app/common/llm_client.py`(新,唯一出网点):自 `book_runs/book_generation_llm.py` **原样下沉**带重试 urllib 客户端(`_call_llm`/`_call_llm_messages`/`_request_chat_completions`/退避 + Retry-After/双鉴权/token 记账/成本估算)。errors 由本模块定义 `LLMError`(502)/`LLMConfigError`(422),`common` 不再反向依赖任何 domain。新增 `redact_secrets(text, secrets)` 兜底脱敏。
  - `book_runs/errors.py`:`BookGenerationError = LLMError`、`BookGenerationPreflightError = LLMConfigError` **别名(同一类对象)**——既有 `except`/`isinstance`/502/422 状态码零改动(DomainError handler 只序列化 status_code + str(exc),不含类名,已核)。
  - `book_runs/book_generation_llm.py`:降为 re-export shim(保留 book_runs 专属 `_total_cost_estimate`),facade `book_generation.py` 链路不变,所有历史 monkeypatch 目标(`generation._call_llm`/`loop_runtime._call_llm_messages`/`assistant_service._call_llm` 等)全部继续有效。
  - `agent_runs/loop_runtime.py`(**F16 靶心**):live 工具循环改 `from app.common.llm_client import ...`,不再 import book_runs——主产品循环彻底脱离已降级域。
  - `story_state/semantic.py`(**真 bug 修复**):grounding 配置从裸 `os.getenv` 改吃 `resolved_llm_env` 覆盖链(env → .env → llm-provider.json),`STORYFORGE_JUDGE_LLM_*` 仍为最高优先级 env 覆盖(与 judge/semantic 对齐);此前它漏迁 resolved_llm_env,sidecar 下读不到 llm-provider.json → grounding 静默失活。失败日志经 `redact_secrets` 脱敏。
  - `judge/semantic.py`:失败日志 `error=redact_secrets(str(exc), [api_key])`。
  - `pyproject.toml`:启用 ruff `TID` + banned-api 禁 `urllib.request`(chat 出网只走 llm_client),per-file-ignore 仅放行 `llm_client.py`、assistant `/models` 探针、S3 presigned 回读测试——防新代码另起碎片化 urllib 客户端。
- **证据**:
  - `tests/test_llm_client_channel.py`(新,11 passed):双鉴权(bearer 走 Authorization / api-key 走 api-key 头,互斥)、两路径 429→重试→成功一致(尝试 2 次)、`<think>` 剥离、messages 版允许纯 tool_calls;**密钥红线**——4xx 异常消息与日志均不含 key 子串、`redact_secrets` 脱敏、story_state 失败日志不含 key;**漏迁修复**——grounding 读 resolved_llm_env(Authorization 命中注入 key)、无 key 静默返回空。
  - `tests/test_book_generation_llm_retry.py`(直接 import `_call_llm`)→ 5 passed:移动后真 urllib 重试行为逐条不变。
  - 高风险面回归:`pytest test_agent_loop_runtime test_book_generation test_judge_semantic test_llm_config_file_override test_story_state test_assistant_revise test_cross_chapter_consistency test_agent_llm_context test_ide_agent_orchestrator test_agent_runs` → **208 passed**(别名 + re-export + loop_runtime 重指 + story_state 改写零回归)。
  - `uv run ruff check .`(全 apps/api,含新 TID banned-api)All checks passed。
  - `cd apps/api && uv run pytest -q`(全量回归,零测试改动 gate):**855 passed / 3 skipped**(= master 844 + 本刀新增 11 channel 测试,既有用例零改动)。移动 + 别名 + loop_runtime 重指 + story_state/judge 改写零回归。
- **未验 / 不外推 / 本刀不做**(登记备查):judge/story_state 仍走 httpx(未统一到 urllib 通道,只统一了配置源与脱敏);retrieval embedding/reranker(独立 `STORYFORGE_EMBEDDING_*`/`RERANKER_*` 命名空间)、workflow `provider_client.py`(第 7 客户端,W5 将随 workflow 吸收删除)本刀不动;usage 记入 assistant_tool_calls + 流式回调缝、fake-provider bearer/api-key×429×reasoning-leak 的三客户端一致性矩阵(本刀只覆盖单通道自身)属 F16 后续;`headless 复跑证据续期` 需真 key,归真机/真跑轨,未在本刀执行(与 W1/W2 一致,代码级 gate 用 fake-provider 矩阵 + 全量 pytest 兜底)。banned-api 只禁 `urllib.request`,不禁 httpx(judge/story_state/embedding/reranker 仍合法用 httpx)。

---

# 2026-07-04 W4(batch-1):死域冻结隔离 验证记录

- **范围**(蓝图 §7 W4,拆 F04「38 域/45 表超配、AI 上下文噪音」):建立 `DOMAINS.md` 三档清单(live/backing/frozen)作新会话第一入口,并卸载第一批 frozen router。**discovery-first**:先派 Explore 逐域实证调用面(前端 grep + 跨域 import + 测试),否决蓝图「9 可直删」的乐观清单——实证 9 域是 **models-only / service-live**(workspaces.models←live ide 审计/artifacts/events;assets.models←live scene_packets;prompt_packs.models←live model_runs;studio.service←live ide;style_packs.service←live book_runs 生成链),目录与 models/service **必须保留**。
- **本刀只卸载 4 个零耦合 frozen router**(零前端 + 零 backing 域 import 其 service):`analytics`、`batch_refinery`、`collaboration`、`commercial`。`collaboration`/`commercial` 的 `models.py` 仍在 `app/models.py` 聚合建表,故**保留目录**。studio/style_packs/workspaces/assets/prompt_packs/series/worldbuilding/evaluations 的 router 卸载(service/models 是 live 依赖或蓝图 batch-2)留后续,已在 DOMAINS.md 登记。
- **落地**:
  - `app/domains/DOMAINS.md`(新):全域三档表 + models-only/service-live 逐条注明「不可删目录」的 live 依赖点 + 冻结/删除红线;`CLAUDE.md` §5 加指路(新会话第一入口)。
  - `main.py`:删 4 域 import + `include_router`(回滚 = 加回一行)。
  - 护栏 `tests/test_api_surface.py::test_frozen_domain_routers_stay_unmounted`:4 前缀不得进 `app.routes`(过滤 `/__test__/` 限流探针,避开 test_api_middleware 向全局 app 注入的 batch 探针路由),重新 include_router 即红——可证伪。
  - 删 4 个纯 HTTP 测试文件(analytics/batch_refinery/collaboration/commercial);改 `test_source_pruning.py`(batch-refinery 的 present 断言移交 test_api_surface 护栏)、`tests/e2e/phase2-contract.spec.ts` / `phase3-contract.spec.ts`(移除已卸载域的契约断言,保留 series/style-packs/workspaces/provider-gateway)。
- **证据**:
  - `pnpm openapi` 刷新:契约 paths **109 → 100**,removed 恰为 4 前缀下 9 条,**zero added**(逐 path set 比对)。
  - `pnpm e2e`(drift + 契约):**21/21 pass**,drift 绿。
  - `uv run ruff check`(main.py + 改动测试)All checks passed;`pnpm.cmd lint` 0 error(仅 Editor.tsx 存量 warning)+ Prettier 全过。
  - `pytest test_api_surface test_source_pruning test_api_middleware` → 35 passed(护栏 + batch 限流分层不受 router 卸载影响)。
  - `cd apps/api && uv run pytest -q`(全量):**847 passed / 3 skipped**(= W3 855 − 9 删除的冻结域 HTTP 测试 + 1 新增 frozen-guard;delta 恰为本刀意图,零意外回归)。
- **未验 / 不做**(登记):桌面全功能真机冒烟归 E2E-1(sidecar-smoke 已覆盖 assistant+WS 起服无损,但非全 GUI);frozen 域**物理删除**(打 attic tag + 逐域 grep)不在 W4,按判据后评;batch-2(workspaces/assets/prompt_packs/evaluations)与 service-live 域(studio/style_packs)router 卸载留后续增量。models 一行不删——打碎 `app/models.py` 建表会连累 live。

---

# 2026-07-04 W5(core):workflow 分层 prompt + 技能审计迁入 API(修 F05 装机死路) 验证记录

- **范围**(蓝图 `docs/internal/arch-review-blueprint-2026-07-03.md` §7 W5 核心,拆 F05「装机 exe 内 bookrun.start prompt 装配走 importlib 跨进程桥接、相邻 apps/workflow 目录不存在 → 运行时才炸」):把 workflow 的**纯函数**分层 prompt 构建器与技能审计投影迁入 API 进程内包,拆掉两座 importlib 文件路径桥,让 prompt 装配随 `collect_submodules('app')` 打进冻结 exe。W5 的高风险步(物理删除整个 `apps/workflow` app + 删第 7 LLM 客户端)本刀**不做**,留后续增量。
- **discovery-first 关键结论**(派 Explore 逐文件核实):`storyforge_workflow/prompts/`(7 文件 ~1150 行)+ `skills/audit.py` 均为**纯函数**——只 stdlib + 内部 `prompts.*` 互引,**零回引 workflow 运行时**(langgraph/runtime/graph),故可干净迁移。因 `apps/workflow` 本刀不删、其自身测试仍依赖原文件,采**复制而非移动**(重复暂存,随 workflow 物理删除时回收)。
- **落地**:
  - 新包 `apps/api/app/domains/book_runs/prompts/`(8 文件):`__init__.py` / `builder.py` / `context.py` / `models.py` / `_render.py` / `_sections.py` / `_continuity_budget.py` + `audit.py`。内部绝对导入 `storyforge_workflow.prompts.*` → `app.domains.book_runs.prompts.*`(9 处,sed 批改后 grep 核零残留)。
  - 两个 wrapper 就地重置:`build_draft_prompt_from_state`(原 `workflow_prompt_bridge`)并入 `prompts/__init__.py`(直接调 `narrative_context_from_state` + `build_draft_prompt`,不再 importlib 按路径加载);`derive_book_run_skill_chain` + `_to_jsonable`(原 `workflow_skill_audit_bridge`)并入 `prompts/audit.py`。
  - 3 处导入点改指进程内包:`book_generation.py`(draft prompt 装配)、`exports/book_markdown_exporter.py`(审计报告技能链)、`tests/test_prompt_assembly.py`;`prompt_assembly.py` docstring 同步(不再提「跨进程边界」)。**删两座桥** `workflow_prompt_bridge.py` / `workflow_skill_audit_bridge.py`(`git rm`,全仓 grep 零残留引用)。
  - `main.py` 起服自检 `_log_prompt_layer_state()`:import 进程内 `build_draft_prompt_from_state` 并 `logger.info("prompt_layer_bundled", callable=...)`——给 sidecar-smoke 一个直指 F05 的确定性断言锚点(旧桥指相邻 apps/workflow,装机 exe 内不存在会 bookrun.start 才炸;现随 `collect_submodules('app')` 打包,此处即证装配可达)。`book_generation` 已被 `ide/router.py` + `assistant/service.py` 在起服链模块级 import → 新包成为起服硬依赖,漏打即起服炸。
  - `scripts/sidecar-smoke.mjs` 加 `assertPromptLayerBundled`(比对 `prompt_layer_bundled` + 拒 `callable=false`),daily/packaged 两档均断言。
  - PyInstaller **无需改 spec**:新包在 `app.domains.*` 下,`collect_submodules('app')` 自动打包。
- **证据**:
  - `tests/test_prompt_assembly.py`(改导入路径)+ `tests/test_book_run_recorded_skill_runs_export.py` → **11 passed**:迁移后 draft prompt 分层装配与审计技能链投影逐条不变。
  - book_runs + export 全面:`pytest test_book_export_epub test_book_exporter test_book_generation{,_llm_retry,_long_wrapper,_parallel,_parallel_wrapper} test_book_run_{budget,resume,start,workflow_dispatch} test_book_runs test_exports` → **151 passed**(deterministic BookRun 最小闭环 + EPUB/Markdown/审计报告导出资产无损)。
  - **packaged 冻结 exe 冒烟(F05 硬门禁)**:`pnpm smoke:sidecar:packaged` → 构建冻结 exe(bundle 新包)→ 起服 4672ms → assistant 往返 + Agent WS + `managed=true`(W2 不回归)+ **`分层 prompt 构建器已随 exe 打包(F05 死路已收口)`** → 全绿。即证 prompts 已随 exe 打包、bookrun.start 装配路径在装机态可达(旧桥此处会 ModuleNotFound 起服炸)。
  - `uv run ruff check .`(全 apps/api)All checks passed(顺手删 W3 遗留 `tests/test_llm_client_channel.py:17` 死 import `from app.common import llm_client`——bare 模块名全文件未用、行 18 已具名导入符号,1 行 F401 清理保 ruff 门禁绿)。
  - `cd apps/api && uv run pytest -q`(全量,零测试改动 gate):**847 passed / 3 skipped**(= W4 基线,迁移只改导入路径不增删用例,零回归)。
  - `pnpm e2e`(drift + 契约):**21/21 pass**,drift 绿(本刀无路由变更,`main.py` 只加起服日志函数,OpenAPI 不变)。
- **未验 / 不外推 / 本刀不做**(登记备查):`apps/workflow` app **物理删除**(打 attic tag + 逐引用 grep + 迁移其自身测试)与**第 7 LLM 客户端 `workflow/provider_client.py` 删除**是 W5 高风险步,本刀不做,留后续——故 prompts 目前在 api 与 workflow **双存**(api 是 live 唯一装机路径,workflow 副本随物理删除回收)。真机「装机 exe 双击 → bookrun.start 真装配」归 E2E-1(sidecar-smoke 已证 exe 内装配可达 + 起服硬依赖,但非真机 GUI 全程)。真 key headless 长程复跑归真跑轨,未在本刀执行。

---

# 2026-07-04 W7:前端行为测试基建（vitest+happy-dom）+ 修 F26/F27 验证记录

- **范围**（蓝图 §7 W7）：引入 vitest + happy-dom 作前端行为测试基建，落三条可证伪红线行为测试，并顺手修两条 advisory 真 bug——F26（会话切换竞争：run 完成强切回旧会话、污染当前会话）与 F27（写盘非原子 + 快照失败照写）。F26/F27 属 advisory 未经对抗核查，本刀先经 discovery 逐文件证实**均为真 bug**（见证据）再动手。
- **discovery-first 结论**（Explore 逐文件核实）：
  - F26 **真**：`ChatWindow.tsx` `runAuthorAgent` 终态块（await `sendAgentUserMessage` 后）与 `applyResumedAgentResult` 均**无守卫**地 `onAssistantSessionChange(run 的 session)` + `setMessages` + 发建议；ChatWindow 未按 session key 重挂，在飞闭包跨会话存活。裸 `agentRunIdRef===runId` 守卫**不足**（纯切会话不改 runId），须比对「run 起跑会话 vs 当前活动会话」。
  - F27 **两处均真**：TS `useSuggestionWriteback.writeAcceptedSuggestion` 的 snapshot `try/catch` 只 `console.error` 吞错、write 照走；Rust `fs.rs::write_file` 是裸 `fs::write` 原地覆盖（非原子）。
- **落地**：
  - **F27-Rust 原子写**（`apps/desktop/src-tauri/src/fs.rs`）：`write_file` 改「同目录临时文件 + `sync_all` + 原子 `fs::rename` 覆盖」。拆 `stage_atomic_write`（写暂存返回临时路径，**尚未替换目标**）+ rename 两步，使「暂存绝不改动目标」这一原子性不变量可被单测**证伪**。
  - **F27-TS 快照阻断**（`src/lib/writeback.ts` 新纯核心 `performGuardedWriteback` + `useSuggestionWriteback.ts`）：把「内容有变→先成功快照（推进分支头）→写盘→记录」次序抽成纯函数，**删除吞错 try/catch**——快照 reject 直接向上传播，write/record 不执行（快照失败即阻断写回）。
  - **F26 会话守卫**（`src/components/chat-window/session-guard.ts` 新纯核心 `isRunResultForActiveSession` + `ChatWindow.tsx`）：`runAuthorAgent` 起跑时记 `runStartSessionId`，await 返回后先判 `runSuperseded`(agentRunIdRef≠runId) / `sessionSwitched`(当前活动会话≠起跑会话)，任一成立即收尾返回不写回当前会话（仅切会话无新 run 接管时清残留 `agentBusy` 避免僵死 spinner）；`applyResumedAgentResult` 入口加同一会话守卫（run 身份在调用处 `shouldApplyAgentControlAck` 已守卫）。
  - **基建**：`npm i -D vitest happy-dom`（frontend 是独立 npm 工程、非 pnpm workspace）；`vitest.config.ts`（env happy-dom，`include tests/behavior/**/*.vitest.ts`）；`package.json` `test` 改 `verify-unit.mjs && vitest run`（双跑：既有 19 文件/101 子测走 node:test 自制 runner，新增 3 红线走 vitest）。`.vitest.ts` 后缀被 verify-unit 的 `/\.test\.(ts|tsx)$/` 过滤天然排除，**零改 verify-unit**。lockfile 经 npmmirror 装机后把 35 条 `registry.npmmirror.com` URL 回改为 `registry.npmjs.org`（整合 integrity 与官方源一致，避免镜像污染）。
- **证据**：
  - **三条红线行为测试各自可证伪**（`tests/behavior/*.vitest.ts`，`npx vitest run` → 2 files / **9 passed**）：①before 漂移拒写（`isWholeFileDrifted` 漂移判真/仅 CRLF 差异判假）；②快照→写盘→记录时序 + **快照失败 write/record 均不执行**（`performGuardedWriteback` reject 且 `vi.fn` 零调用）；③会话切换红线（`isRunResultForActiveSession` 全决策表：同会话→应用、切走→拒、新会话 null/null→应用、新会话后切走→拒）。可证伪：吞错回归→②的「write 未调用」红；守卫恒真→③的「切走→false」红；漂移误判→①红。
  - **F27-Rust**：`cd apps/desktop/src-tauri && cargo test fs::` → **9 passed**（含新增 `write_file_stages_out_of_place_so_target_is_replaced_atomically` 证暂存阶段目标仍旧内容=原子性不变量、`write_file_overwrites_content_and_leaves_no_temp_residue` 证提交后无 `.tmp` 残渣）。
  - **零回归**：`npm run typecheck` 绿；`node scripts/verify-unit.mjs`（既有 19 文件）→ **101 passed / 0 fail**（F26/F27 改动不破既有行为）；`pnpm.cmd lint` 0 error（仅 Editor.tsx:308 存量 warning）+ Prettier 全过。双跑 `npm run test` 冷启 vitest ~9.6s、暖跑 ~0.5s，verify 总时长增量可忽略。
- **未验 / 不做**（登记备查）：既有 19 测试文件**迁入 vitest + 删 verify-unit.mjs** 是「双跑一个 PR 周期后」的后续，本刀不做（故仍 node:test/vitest 双 runner 并存）。三条红线测的是**抽出的纯核心决策**（happy-dom env 已就位，DOM/组件挂载级行为测试随 19 文件迁入时补）；ChatWindow 全量 happy-dom 挂载（monaco/WS 依赖重）不在本刀。真机「切会话中途 run 完成不串台 / 快照失败不落盘 / 崩溃不留截断文件」桌面观感归 E2E-1。F27 原子写的「崩溃中途」属结构性保证（temp+rename），单测只证「暂存不碰目标」这一不变量，非真崩溃注入。

---

# 2026-07-04 F32:交互路径 BYO-key 成本记账进证据链 验证记录

- **范围**（架构审计 advisory F32「BYO-key 成本可观测名存实亡」，蓝图 §4/§6 red-line「可观测=证据链本身，补 usage 记账」）：成本在唯一出网点 `llm_client._call_llm_messages`/`_call_llm` 已算出（`cost_cny_estimated` + `cost_breakdown`），但 **live 交互面**——agent 工具循环与 assistant 单轮（explain/revise/draft）——只把 `completion_tokens` 记进证据链，`cost_cny_estimated`/`prompt_tokens` 直接丢弃。**对抗核查结论**（Explore）：F23 已被 W0 删除+回归测试锁定（NOT-REAL）、F36 泄漏进前端改造面、F35 是功能级设计非 bug；**F32 是四条里唯一「真 + 高证据链价值 + 自包含 backend-only 低爆炸半径」的**（book_runs 侧成本已记账+Prometheus，故只补交互面，不外推「全部成本可观测」）。
- **落地**（纯 backend、additive、零 schema/OpenAPI 变更——只往 free-form `output_summary` dict 加键，镜像既有 `completion_tokens` 管线）：
  - `agent_runs/loop_runtime.py`：`ChatLoopOutcome` 加 `prompt_tokens` / `cost_cny_estimated` 字段；每轮 LLM 结果里 `prompt_tokens` / `cost_cny_estimated` 与 `completion_tokens` 一并累加（`cost` 收 `int|float` 且排除 `bool`）。
  - `agent_runs/runtime.py`：`assistant.chat_loop` 证据 `output_summary` 补 `prompt_tokens` / `cost_cny_estimated`。
  - `assistant/service.py`：explain/chat（:283）、revise（:360）、draft（:486）三条单轮证据 `output_summary` 各补 `prompt_tokens` / `cost_cny_estimated`（取自 `result.get(...)`）。
- **证据**：
  - 新增 `test_agent_loop_runtime.py::test_chat_loop_records_byo_key_cost_in_evidence`：两轮 fake provider 返回成本，断言 `assistant.chat_loop` 证据 `output_summary` 的 `prompt_tokens`=320 / `completion_tokens`=14 / `cost_cny_estimated`≈0.032（逐轮累加）。
  - 扩 `test_assistant_revise.py` 首用例：fake 返回成本，断言 `assistant.revise` 证据 `output_summary` 含 `prompt_tokens`=310 / `cost_cny_estimated`≈0.031。
  - `pytest test_agent_loop_runtime test_assistant_revise test_assistant_tool_calls test_agent_runs test_agent_llm_context` → 96 passed；`uv run ruff check`（改动文件）绿。
  - 全量 `uv run pytest -q`：**848 passed / 3 skipped**（= W7 基线 847 + 本刀 1 新用例，零回归）。`pnpm e2e` 21/21 + drift 绿（`output_summary` 是 `dict[str, Any]` free-form，加键不动契约）。
- **不外推 / 不做**：只补 live 交互面（agent 循环 + assistant 单轮），`book_runs` 成本记账（records + `book_generation_cost_cny_total` Prometheus）本已存在不动；成本仅进 **证据链 output_summary**，未加进 REST response schema（避免契约变更）、未做前端展示（前端改造中）、未做跨 key/跨 run 成本聚合面板（F32 记账是前提，聚合展示留后续）；成本为**估算**（`_cost_breakdown` 按价目表估，非 provider 实际账单）。

---

## E2E-1 剩余项行为层验证（2026-07-07，W6 收口后）

**目标**：E2E-1 硬门禁 G.1 = Part 1–4 全 PASS。Part 0/1 全 + Part 4（除 4.3）已在 0.1.1 真机 PASS（见 [[project_e2e1_plumbing_run]]）。
剩余 4.3 + Part 2 + Part 3 需真机 GUI（人在屏幕前点，Claude 代跑不了）。**本轮把 GUI 之下的行为层尽数跑绿**，
使真机 GUI 那趟是「确认」而非「发现」，并给出 runsheet（`.codex/e2e-1-runsheet-remaining.md`）。

**新壳 Part 2/3 接线审计（Explore 子代理，只读）**：核心闭环全部真接线且跑通——
diff 面板（PatchReviewPanel 内联 diff）→ 接受 → 写回前快照护栏（快照失败即阻断写盘，F27）→ 写盘 → 作者闭环记录 → 分支血缘推进；
before 漂移拒写（W7①）活；ChatWindow 是右栏活 agent-run 驱动。
非门禁缺口三处（chrome 就位、信号/交互未接，不阻塞 G.1）：ObsPanel 观测面板真信号未灌（诚实空态占位，redesign 明确 park）、
composer prompt 历史方向键召回未实现、file.create 无独立 kind（走空 before 的 file_revision 通用路径覆盖）。

**行为层测试结果（本机跑绿）**：
- 前端 vitest：**23 passed**（3 文件）——覆盖 Part 3 写回闭环（快照→写盘→记录时序、快照失败阻断）、W7① before 漂移拒写、
  原子写、F26 会话切换不污染；Part 2 事件桥 / `isAgent*` 守卫 / F10 `reconstructAgentResultFromEvents` 终态重建。
- 前端 verify-unit（node --test）：**102 passed**——含 fs 缓存失效、写回纯核心。
- 后端 agent pytest（`-k "agent or loop or intent or ws_contract or loop_tool"`）：**183 passed / 703 deselected**——
  覆盖工具循环运行时、审稿 file.review、修订 file.revise、F11 intent 关键词表下线、WS 契约金测、循环工具 schema 单点派生。

**4.3 的诚实边界**：`ChatWindow` 发 run 不传 `timeoutMs`（`agent-socket.ts:770`），走死常量 `DEFAULT_AGENT_TIMEOUT_MS=360_000`。
真机制造超时只能 (A) 临时把常量改小重建（推荐，确定可复现，验完还原不提交）或 (B) 真 >6min run。
核心 `reconstructAgentResultFromEvents` 已有 vitest 金测；4.3 验的是真机上「挂钟超时→close socket→REST 轮询事件表→重建终态」这条活链路。

**结论**：Part 2/3 的**代码/行为层已全绿、无阻塞真机验收的缺口**；4.3 路径已接线（需 rebuild 触发）。
残留是**不可自动化的人在屏幕前 GUI 观感与点击**（Monaco 渲染、点接受、看 diff 面板、切主题观感），
定义上属用户在真机执行；runsheet 已逐项就绪，我可在用户机 PowerShell 抓 GUI 日志协助定位失败。

---

## E2E-1 真机 Part 3 逮 bug + 修复（2026-07-07）

**发现（真机 3.5 新文件起草）**：让 Agent 起草新文件、确认写回后，左栏资源树**不立即显示新文件**，
需切视图或等 ~5s 才「过一会」加载出来。

**根因**：写回链路（`useSuggestionWriteback.writeAcceptedSuggestion` → `TauriFileSystem.writeFile`）
与手动新建（`App.handleNewFile`）都只调 `invalidateListDirCache` 清 FS 缓存，**不触发 React 重拉**。
`ResourceExplorer` 的 fetch effect 依赖 `[projectPath, refreshVersion]`，而写回路径从不 bump `projectRefreshVersion`
（此前仅示例项目创建 / 故事初始化两处 bump）。新文件靠后续无关重挂载（视图/页签切换）+ 5s 缓存 TTL 才偶然刷出。

**修复（`fix/file-tree-refresh-after-writeback`）**：
- `lib/tauri-fs.ts`：新增 `FS_MUTATION_EVENT`；`invalidateListDirCache`（写/建/删/改名/watch 命中的唯一汇聚点）
  调 `emitFsMutation` 广播；`emitFsMutation` 双重守卫 `window` + `dispatchEvent`（node:test runner 有 window 无 dispatchEvent，弱守卫会炸 verify-unit）。
- `App.tsx`：监听 `FS_MUTATION_EVENT`，debounce 120ms（合并一次「接受补丁」触发的快照写+正文写两次 mutation）
  后 bump `projectRefreshVersion`，覆盖手动新建 / Agent 起草 / 删除 / 改名全路径。

**验证**：typecheck 通过；vitest **23 passed**；verify-unit **102 passed**（含 fs 缓存失效用例）；lint 绿（Editor.tsx 一条 pre-existing warning）。
写回链路本身不变（红线不动，后端仍不写文件）；刷新即时性需真机重装复验。

---

## E2E-1 首轮真机验收 —— 门禁 G.1 PASS（2026-07-07）

真机项目 `D:\test`（正式 0.1.1 + PR#109 修复重装）。硬门禁 G.1 = Part 1–4 全 PASS，达成：

- **Part 0 / Part 1**：会话前已全绿。
- **Part 2（对话式 Agent 基础，7 项）**：全 PASS。欢迎页首条 prompt（run 23）、工具循环流程树事件驱动、会话历史列表、intent=chat.explain 未抢跑固定管线（F11）、composer Ctrl+Enter 发送 + 方向键不误触。
- **Part 3（审稿→修订→diff→写回→版本，核心闭环）**：
  - 3.1/3.2 后端 headless 坐实（file.review 5 issue 稳定 id / file.revise 真 proposed_patch 546→691）。
  - 3.3/3.4/3.5/3.6/3.7 真机 PASS：写回+版本快照、防重复、新文件起草自动打开+即时刷新、before 漂移拒写（W7①）、切会话不污染（F26）。
  - 3.8 快照失败阻断 / 3.9 原子写：记 **N/A**（真机难可靠构造；机制已由 W7 vitest「快照失败阻断」+ Rust 临时文件原子 rename + 2 条 cargo 原子写测试覆盖）。用户拍板放过。
- **Part 4 / 4.3 前端超时转后台轮询**：真机复现坐实（临时 `DEFAULT_AGENT_TIMEOUT_MS=3_000` 重建 → 审稿 run 29 后端 18s > 3s 超时 → 前端未硬失败、转后台轮询、9-issue 报告最终渲染；`agent_run_completed` payload 带齐 F10 重建字段）。常量已改回 360_000。

**真机逮到并修复的真 bug（PR#109 已合并 master）**：新文件写回/起草后左栏资源树不即时刷新（写回只清 FS 缓存不 bump projectRefreshVersion，靠视图切换重挂载+5s TTL 才「过一会」显示）→ invalidateListDirCache 广播 FS_MUTATION_EVENT，App debounce 120ms bump projectRefreshVersion。真机重装复验：新文件立即显示。

**诚实边界**：该修复「症状消失」已真机复验，但「missing bump 即唯一根因」为代码事实推断、未做确定性复现 instrument（症状与 remount+TTL 一致但未观测）。写回红线不变（后端不写文件）。3.8/3.9 为单测兜底非真机跑通。

**G.1 判定：PASS。** E2E-1 首轮通过 → 解锁 W6 权限四轨（F24/F25）。

---

## W6 权限四轨收敛（F24/F25）——2026-07-07，E2E-1 PASS 后补做（PR #111/#112）

**背景**：W6 slices 1-3 合并时权限四轨收敛被显式跳过，理由「`requires_confirmation` 无法纯从 `risk_level` 派生（`bookrun.pause` 是 long_running 却 confirm=False）」。E2E-1 首轮 PASS 解锁后补做。**破局**：`requires_confirmation` 单看 `risk_level` 确实推不出，但加上 `execution_mode` 共同作输入即可——`bookrun.pause/resume/retry` 是 `execution_mode="control"`、`bookrun.start` 是 `long_running`。经 15 个 agent_runtime spec 逐条核验，规则成立：
`requires_confirmation = risk_level∈{write_pending,high_cost,propose_patch,network} OR (risk_level==long_running AND execution_mode!=control)`；`permission_level = confirm if requires_confirmation else auto`。

**F25 两半 + 隐藏第 5 轨**：(a) `permission_level`/`requires_confirmation`/`risk_level` 三字段人工并列声明、100% 相关但可各自漂移；外加 `runtime.py:1401` 手写允许名单 `{file.revise,file.create,bookrun.start,judge.repair}`（≡ 确认集，第 5 轨）。(b) `PermissionGate.decide` 4 profile 分支中 `full_allow`/`autonomous_approval`/`step_confirm` 不可达（live 入口 `run.permission_profile` 恒默认 `risk_confirm`，前端只读回传从不发送），`require_approval` 被 1401 名单抵消。

**slice 1（PR #111，纯 additive 先绿）**：`tooling.py` 加 `derive_requires_confirmation`/`derive_permission_level`/`confirming_tool_names` 三纯函数；`test_runtime_tools.py` 加平价元测试 `test_permission_fields_derive_from_risk_and_execution_mode` 断言派生值逐条==当前声明值、`confirming_tool_names()=={file.revise,file.create,judge.repair,bookrun.start}`（钉死==runtime 手写名单）。
- `uv run pytest tests/test_runtime_tools.py -q` → **7 passed**；ruff 绿。
- 可证伪实证：临时把某 spec 的 `risk_level="write_pending"` 改 `"read"` → 元测试红（`test_runtime_tools.py:104 AssertionError`）；还原 → 复绿。

**slice 2（PR #112，先切）**：`AgentRuntimeToolSpec` 的 `permission_level`/`requires_confirmation` 降为读 slice1 派生函数的 `@property`、删 15 spec 字面量两 kwarg；`runtime._execute_tool` 放行名单改 `not tool.requires_confirmation`（拆第 5 轨）；`PermissionGate.decide` 删 3 不可达 profile 分支，只留 `risk_confirm` + `read`/未知 fallthrough 放行（补 WHY 注释：真正的写回确认在 proposed_patch 工件层由前端完成）；demo fixture（`test_loop_tool_schemas.py`）删两 kwarg。
- `uv run pytest`（全量）→ **884 passed, 3 skipped**；ruff 绿。
- `node scripts/generate-openapi.mjs` → **OpenAPI 零漂移**（contracts 无 git 变更）——行为保持实证。

**诚实边界**：行为保持是「派生值逐条==旧声明值」的代码事实 + 全量 pytest + 零 OpenAPI 漂移三重佐证，非真机 GUI 复验（本刀是后端纯 refactor，权限确认的真机观感归 E2E-1 Part 2/3 UI 闭环）。边界：只收敛 agent_runs 15 spec；internal/MCP（`runtime_tools/service.py`）另一套词表已各自单点派生，未动；未拆 1401 放行本身、不改工件层写回红线（不做「Full rewire the gate」）。

---

## Canon 存储骨架 + 薄不变量闸（防漂移 slice 1）——2026-07-08（分支 feat/canon-store-thin-gate）

**背景**：对话式 agent 的防漂移 live 路径此前只有无状态 `project.deep_consistency`（每次现读截断 12k 字设定，无累积真值，原理上抓不到跨章涌现漂移）。旧 `story_state` 引擎（12 类 typed CHANGES + 事件源 fold）已判「以后不走」（机制过期、delta 脆、scope 锁 book_run_id、live 一行不调）。用户拍板从「暂搁」转「开做」，锁定：canon 存 `.storyforge/canon/` 项目文件（派生缓存，类比 Cursor `.cursor/`）；首刀 = 存储骨架 + 薄不变量闸（确定性、无 LLM、无 key 可验）。现代形状立场：正文 = 唯一真值源，canon = 从正文可重建的可弃缓存（漏更下次 rebuild 自愈），scope 接 project_path。

**交付物**：
- `app/domains/agent_runs/canon_store.py`：落盘 IO。`_canon_dir` 后端硬拼 `.storyforge/canon`；`read_canon`（缺失返空骨架不伪造）；`scaffold_canon_if_missing`（空模板确立格式）；`write_derived`/`read_derived`（派生文件名白名单 `presence.json`/`report.json` + 路径断言仍在 canon 目录内）；`_atomic_write_json`（temp file + fsync + os.replace，纯 Python 镜像 W7 Rust 原子写）。复用 `fs_tools._resolve_root`。
- `app/domains/agent_runs/canon_rebuild.py`：`rebuild_presence` 从正文重建实体在场分布，复用 `consistency_scan` 逐行 term 统计 + 按实体归并表面形；`_chapter_ordinals` 按 `_iter_project_files` 路径序编章序（供生命期闸）。
- `app/domains/agent_runs/canon_gate.py`：薄不变量闸（纯函数）。硬矛盾（blocking）= `single_holder` 章窗交叠（移植 `edge_constraints._ranges_overlap` 纯 Python）+ `timeline_order` 声明成环（DFS + `_MAX_REACH_DEPTH` 护栏）；advisory（medium，不硬断）= `lifespan` 退场后仍出场（带命中章节 / 行号）。稳定 issue id（sha1）。不接 `continuity_edges` DB 表（避免重引 book_id 耦合），只移植纯算法。
- 接线：`tooling.py` 加 `project.canon` spec（`risk_level=read`、进循环、`allowed_roles=(root_agent,context_explorer)`）；`runtime.py` `_register_tools` + `_project_canon` handler（scaffold→read_canon→rebuild_presence→write_derived→gate.check→write_derived report）；`role_catalog.py` root_agent + context_explorer 两角色 `allowed_tools` 加 `project.canon`（护栏 `test_runtime_tools.py` 要求角色投影一致）；`loop_runtime.py` `_tool_output_summary` 分支 + `_SYSTEM_PROMPT` 一句。
- `tests/fixtures/loop_tool_schemas_golden.json`：重生（新增 `project_canon` 派生 schema）。
- `tests/test_agent_canon.py`：15 例（落盘/骨架/越界白名单/presence 重建 + 章序/missing/single_holder 交叠 blocking + 不交叠 clean/timeline 成环 blocking + 无环 clean/lifespan advisory + clean/可弃缓存自愈/循环可见性）。

**本地验证结果**：
- `uv run pytest tests/test_agent_canon.py -q` → **15 passed**。
- `uv run pytest tests/test_loop_tool_schemas.py tests/test_runtime_tools.py tests/test_agent_loop_runtime.py -q` → 全绿（golden 重生后 9 passed；role catalog 投影一致）。
- `uv run pytest -q`（全量）→ **897 passed, 3 skipped, 2 failed**；两 failed 复跑隔离全绿：`test_loop_tool_schemas`（golden 待重生，已重生）+ `test_book_generation_parallel_...`（已知 flaky，与本刀无关——只动 agent_runs + role_catalog，未碰 book_runs）。重生 golden 后复跑相关全绿。
- `uv run ruff check app/domains/agent_runs/ tests/test_agent_canon.py` → All checks passed。
- `node scripts/check-openapi-drift.mjs` → **OpenAPI 零漂移**（不新增路由，纯工具面 + 文件层）。

**诚实边界**：
- 薄不变量的**硬矛盾只校验作者在 canon.json 声明的内部一致性**（single_holder / timeline_order），**不从正文自动抽取**声明——自动抽取 holder/timeline 要么需生成缝要么需 LLM，超本刀。作者未声明时如实返回「无可校验项」，不伪造 clean pass。
- `lifespan` 是确定性检测但语义存疑（退场后表面形可能是回忆 / 提及 / 同名），故退 advisory + 提示作者核实，非硬断。
- 富 view（每实体 NL canon dossier + provenance）、LLM 辅助抽取声明、前端 canon 面板 UI 均留后续 slice。
- 红线例外仅授权**派生缓存写盘**（`.storyforge/canon/derived/`，后端计算路径、白名单文件名），手稿正文写回红线不变（仍走 proposed_patch 前端确认）。
- 未做真机 GUI 观感（agent 真调 project_canon 的桌面渲染归 E2E-1）；无 LLM 实跑（本刀确定性，不烧 token）。

---

## 2026-07-08 现代防漂移 slice 2：canon dossier 富 view 骨架（确定性事实投影 + provenance）

**背景**：slice 1（PR#114）落地 canon 骨架 + 薄不变量闸；富 view（每实体 NL canon dossier）当时列为「留后续 slice」。本刀补上富 view 的**确定性事实投影骨架**——把 canon.json 声明 + 正文在场分布按实体归并成人可读 dossier（身份 / 别名 / 出场跨度 + 章分布 / 绑定声明 / provenance 文件行号）。**全字段可从 canon + presence 机械导出，无 LLM 推断**（LLM 辅助的自然语言侧写 / 模糊态策展仍留后续 slice）。dossier 是可弃派生缓存（从正文重建自愈），非作者手稿、不回写 canon.json。

**做了什么**：
- `app/domains/agent_runs/canon_dossier.py`（新增，纯函数无 LLM）：`build_dossiers(canon, presence)` 按 `canon.entities` 序归并每实体事实卡（appearance 出场跨度/章分布、holdings 该实体为 holder 的声明持有、lifespan 绑定生命期、provenance 出现文件+行号，`_MAX_PROVENANCE=20` 封顶防长书撑爆）；`render_dossiers_markdown` 渲染聚合人可读 md（带「派生缓存勿手改」抬头）。
- `app/domains/agent_runs/canon_store.py`：`_atomic_write_json` 抽出共享 `_atomic_write_text` 核（同目录 temp + fsync + os.replace 不变量不变）；新增 `_ALLOWED_DERIVED_TEXT_NAMES` 文本白名单（`dossier.md`）+ `write_derived_text`；越界断言抽成共享 `_resolve_derived_target`（JSON / 文本两白名单复用同一双保险）。
- `runtime.py` `_project_canon` handler：report.json 落盘后 `build_dossiers` → `write_derived_text("dossier.md", render...)`；output 加 `dossier` 段（entity_count / path / missing_entities）。**summary-only 回 LLM**（dossier 全文不灌上下文，防噪声）。
- `tooling.py` `project.canon` loop_schema 描述加一句 dossier 投影说明。
- `tests/test_agent_canon.py`：+5 例（dossier 声明归并 + provenance / missing 实体 / markdown 含事实 / 空态诚实 / write_derived_text 往返 + 双白名单拒绝越界）。

**顺手修复 master 红**：`tests/fixtures/loop_tool_schemas_golden.json` 重生。核查发现 **slice 1（PR#114）的 golden 重生被漏出提交**（`git show HEAD:...golden.json | grep project_canon` = 0），导致 `test_derived_loop_schemas_match_frozen_golden` **在 master 上本就红**（golden 8 工具缺 project_canon，tooling 已有）。本刀 golden 重生同时纳入 slice-1 缺的 project_canon + slice-2 描述改动，顺带修复该 master 红。

**本地验证结果**：
- `uv run pytest tests/test_agent_canon.py -q` → **20 passed**（15 slice1 + 5 slice2）。
- `uv run pytest tests/test_loop_tool_schemas.py -q` → **7 passed**（golden 重生后绿；diff 确认仅新增 project_canon 20 行 + 描述变更）。
- `uv run pytest tests/test_runtime_tools.py -q` → 7 passed（role catalog 投影一致）。
- `uv run pytest -q`（全量）→ **904 passed, 3 skipped, 0 failed**（含上轮 flaky 的 book_generation_parallel 本轮直接绿；golden 已修复）。
- `uv run ruff check app/domains/agent_runs/canon_dossier.py canon_store.py runtime.py tooling.py tests/test_agent_canon.py` → All checks passed。
- `node scripts/check-openapi-drift.mjs` → **OpenAPI 零漂移**（不新增路由，纯工具面 + 文件层，无 ORM / 无 alembic）。

**诚实边界**：
- dossier 是**确定性事实投影**——只机械归并 canon 声明 + presence 分布，**不做任何 LLM 语义抽取 / 自然语言侧写 / 模糊态策展**（那些仍留后续 slice）。
- provenance 每实体封顶 20 处（超出置 `provenance_truncated=true` 只留计数）。
- dossier.md 是可弃派生缓存，删后下次调用自愈；**非作者手稿**、不回写 canon.json；改事实须改 canon.json（红线例外仅派生缓存写盘，与 slice 1 一致）。
- 未做真机 GUI 观感（dossier 桌面渲染 / agent 真调归 E2E-1）；无 LLM 实跑（确定性不烧 token）。
- 前端 canon / dossier 面板 UI 仍留后续 slice。

---

## 2026-07-08 受控全项目重构第一轮：health 契约、WS 类型收敛、废弃手测入口隔离、OpenAPI 生成链补齐

**启动分支**：`codex/refactor-overnight-20260708`。

**启动时已有未跟踪内容**：`.agents/`、`.codex/agents/`、`.codex/config.toml`、`.codex/e2e-1-runsheet-remaining.md`、`.codex/hooks.json`、`.codex/hooks/`、`.trellis/`、`AGENTS.md`。这些不是本轮产生的配置内容，未纳入自动 stage 范围。

**执行计划**：新增 `REFACTOR_PLAN.md`，先审计再执行 B1-B4：
- B1：`/health/live`、`/health/ready` 增显式 Pydantic response model；Desktop runtime health 前端改用 OpenAPI 生成契约。
- B2：Desktop Agent WS 前端消息类型从 `generated/agent-ws.ts` 派生，保留 runtime guard 后的字符串收窄。
- B3：删除三个无引用 ad-hoc WS 手测入口：`scripts/test-agent-websocket.py`、`scripts/test-file-revise-llm.py`、`apps/desktop/frontend/test-agent-websocket.html`。
- B4：`pnpm openapi` 补跑 `@storyforge/shared generate:types`，`check-openapi-drift` 把 `packages/shared/src/generated/api-types.ts` 纳入漂移检查。

**验证结果**：
- `cd apps/api && uv run pytest tests/test_health_probes.py -q` → **9 passed**。
- `cd apps/api && uv run ruff check app/domains/health tests/test_health_probes.py` → **All checks passed**。
- `pnpm.cmd openapi` → **通过**；生成 `storyforge.openapi.json`、`agent-ws.schema.json`、前端 WS 类型、shared OpenAPI TS 类型。
- `npm --prefix apps/desktop/frontend run typecheck` → **通过**。
- `npm --prefix apps/desktop/frontend run test` → **102 node tests passed + 23 vitest tests passed**；存在既有 React SSR `useLayoutEffect` warning，不阻断。
- `pnpm.cmd --filter @storyforge/shared test` → **tsc --noEmit 通过**。
- `pnpm.cmd run check:drift` → **OpenAPI 契约无漂移**。
- `pnpm.cmd lint` → **通过**；仍有既有 `Editor.tsx` exhaustive-deps warning（0 errors，Prettier 全绿）。
- `git diff --check` → **通过**。
- `rg -n "test-agent-websocket|test-file-revise-llm" . --glob "!node_modules/**" --glob "!.git/**"` → 只剩 `REFACTOR_PLAN.md` 对已删除入口的计划记录。

**OpenAPI / generated drift 说明**：`storyforge.openapi.json` 预期新增 `LivenessResponse` / `ReadinessResponse` schema，并将 `/health/live`、`/health/ready` 的 200 schema 从匿名 object 改为 `$ref`。`packages/shared/src/generated/api-types.ts` 此前未被 `pnpm openapi` / drift 门禁覆盖，已落后于当前 OpenAPI（仍含部分已卸载 frozen paths）；本轮重生后与当前 OpenAPI 对齐，并把该文件加入 drift 检查。

**诚实边界**：本轮未改 DB schema、未改手稿写回链路、未改 proposed patch diff confirmation 语义；未做真机 Tauri GUI 复验、未跑真实 LLM、未跑 `pnpm verify` / `pnpm e2e` 总门禁。

---

## 2026-07-08 Agent Debug Handoff 规划文档

**背景**：用户提出希望利用程序已有日志、事件和报错，让开发 agent 能快速接手定位问题；随后进一步明确核心场景是“别人发来日志，开发者能对照日志去找 StoryForge 程序 bug”。参考本地小项目 `C:\Users\kanye\Documents\ai-dev-Context Pipeline`，确认其 `Collect -> Redact -> Budget -> Render` 范式适合 StoryForge 诊断接手包。

**做了什么**：
- 新增 `docs/internal/agent-debug-handoff-plan.md`，定义开发者诊断接手包目标、第一版范围、数据收集器、输出目录、`AI_CONTEXT.md` contract、脱敏/预算、实施分期、测试计划和 PR 拆分。
- 计划锁定第一刀为外部日志 CLI：`pnpm diagnose:log -- --log path/to/failure.log` / `Get-Clipboard | pnpm diagnose:log -- --stdin`，先证明“日志 -> 错误块 -> 疑似源码 -> AI_CONTEXT.md”；`diagnose:agent`、`diagnose:latest`、`diagnose:cmd`、Desktop/sidecar 日志集成后续再做。
- 明确该功能不做通用日志平台、不上传日志、不默认收集稿件全文，输出必须脱敏并服务 AI coding agent 快速排障。

**本地检查**：
- `Get-Content docs/internal/agent-debug-handoff-plan.md | Measure-Object -Line -Word -Character` → 616 lines / 2233 words / 18858 chars。
- 只读查看 `scripts/` 现有脚本风格、`.gitignore`、`.codex/verification-report.md`，用于确定计划与仓库现有轻量 Node 脚本风格对齐。

**未验证项**：docs-only 规划变更，未跑 `pnpm lint`、前端测试、API pytest、OpenAPI 或总门禁；未实现诊断 CLI，未改 API/DB/Desktop 行为。

---

## 2026-07-08 Desktop/API boundary hardening

**做了什么**：
- API 增共享 redaction：422 validation error、events/model_runs/artifacts/timeline/retrieval/IDE audit、Agent summary、LLM upstream error text 均在写入或响应边界脱敏。
- Desktop 路径边界收敛到 `lib/project/path.ts`：拒绝绝对外部路径、`..`、sibling-prefix 误判；context bundle/pinned path、@context、新建文件、版本元数据、命令面板等调用统一 helper。
- 编辑器保存握手改为失败/超时阻断：Agent 读盘前保存失败不再放行；手动保存改走 guarded writeback 顺序，快照失败不覆盖正文。
- 运行通道 hardening：Writing Run SSE 从 `EventSource` 改为 fetch stream + `X-StoryForge-API-Key`；Agent WS 不再把 key 放 URL query，改用 subprotocol 传递，后端保留 query 兼容。
- Tauri/本地 artifact guardrail：资源枚举跳过 symlink；smoke API 配置日志不打印 key；`.gitignore` 默认忽略 `.codex/*`，只 allowlist config/hooks/agents/verification report。
- TimelineEvent 校验 `project_id == book.workspace_id`（存在 workspace 时）；`volume_id` 当前无真实 volume 表，仍只作为 caller-provided display metadata。

**本地验证**：
- `cd apps/api && uv run pytest tests/test_redaction_boundaries.py tests/test_timeline_events.py tests/test_ide_websocket_auth.py tests/test_ide_command_registry.py tests/test_llm_client_channel.py -q` → **34 passed**。
- `cd apps/api && uv run pytest -q` → **918 passed, 3 skipped, 6 warnings**。
- `cd apps/api && uv run ruff check app/common/redaction.py app/common/llm_client.py app/domains/ide/router.py app/domains/timeline tests/test_redaction_boundaries.py tests/test_timeline_events.py tests/test_ide_websocket_auth.py` → **All checks passed**。
- `npm --prefix apps/desktop/frontend run test` → **105 node tests passed + 24 vitest tests passed**；仍有既有 React SSR `useLayoutEffect` warning，不阻断。
- `npm --prefix apps/desktop/frontend run typecheck` → **通过**。
- `npm --prefix apps/desktop/frontend run test:behavior -- tests/behavior/event-bus-contract.vitest.ts tests/behavior/writeback-guard.vitest.ts` → **20 passed**。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml fs:: --quiet` → **10 passed**。
- `pnpm.cmd lint` → **通过**；仍有既有 `Editor.tsx` exhaustive-deps warning（0 errors，Prettier 全绿）。
- `pnpm.cmd run check:drift` → **OpenAPI 契约无漂移**。
- `git diff --check` → **通过**。

**未验证项 / 边界**：
- 未跑 `pnpm verify` / `pnpm e2e` / 真机 Tauri GUI；本轮覆盖 focused API、frontend、Rust fs checks。
- Tauri raw fs command 签名保持兼容，项目 containment 仍由前端统一 helper 在调用前执行；Rust 层已补 symlink 不跟随。
- Agent WS subprotocol 避免 key 出现在 URL，但仍是本地长 lived sidecar key，不等同短期 token。

---

## 2026-07-08 Desktop/API boundary hardening review follow-up

**做了什么**：
- 修复 frontend proposed patch 路径回归：`ChatWindow` 在发出 file suggestion / suggestion result 前，把后端 `proposed_patch.file_path` 解析为项目内绝对路径；相对路径、项目内绝对路径均规范化，`..` 和项目外绝对路径被拒绝并显示阻断消息。
- 修复 AgentRun recovery/read projection 读时脱敏：`save-points` 最终投影统一过 `redact_sensitive`，兜住绕过 service 写入脱敏的 legacy event/artifact。
- 修复 AgentRun WS replay 读时脱敏：重放 `run.goal`、role hints/mentions、agent plan step/detail/status 时统一过文本脱敏。
- 新增回归：relative proposed patch path 解析为绝对项目路径；legacy save-points 与 WS replay raw secret 不外泄。

**本地验证**：
- `cd apps/api && uv run pytest tests/test_agent_runs.py -q` → **64 passed**。
- `cd apps/api && uv run pytest tests/test_redaction_boundaries.py -q` → **8 passed**。
- `cd apps/api && uv run ruff check app/domains/agent_runs tests/test_agent_runs.py` → **All checks passed**。
- `npm --prefix apps/desktop/frontend run typecheck` → **通过**。
- `npm --prefix apps/desktop/frontend run test:behavior -- tests/behavior/event-bus-contract.vitest.ts` → **15 passed**。
- `cd apps/desktop/frontend && node scripts/verify-unit.mjs chat-window` → **21 passed**。

**未验证项 / 边界**：
- 未跑 `pnpm verify` / `pnpm e2e` / 真机 Tauri GUI；本轮为 code review follow-up，覆盖新增风险点的 focused tests。
- 未改 OpenAPI / DB schema / 手稿写回链路；后端仍只产出待确认 patch，写回红线不变。

记录时间戳：2026-07-08 21:23:27 +08:00。

---

## 2026-07-10 Desktop/API boundary hardening 基于 PR #116 重植收口

**背景**：原分支 PR #117 与已先合入 master 的 PR #116 同题异构，直接合并产生 33 个语义冲突。本轮以 `origin/master@73728839` 为基线，保留 master 已有的更完整 redaction、path parser、三态保存、SSE 和 smoke 密钥布尔化实现，只重植原分支的真实增量。

**做了什么**：
- Agent WS 删除 `?api_key=` 通道；浏览器 subprotocol 鉴权成功后在 101 响应回显被选协议。sidecar daily smoke 改用 Node WHATWG WebSocket 严格握手，能直接守住“已鉴权但未回显协议”的浏览器失败。
- 新增 Rust `read_project_file(project_root, path)`：canonicalize 根与候选路径，拒绝项目外路径、目录和项目内 symlink 逃逸；`@context`、context bundle、当前文件发送和跨章读取统一走该命令。
- 当前文件在构建 context bundle 前先完成编辑器 flush 并读取，避免 bundle 先读到磁盘旧稿；flush 失败继续阻断发送。
- App 统一 dirty editor 导航守卫，覆盖文件/预览/项目/会话入口/当前项目移除/新文件/设置/固定与预览页签；确认与实际 transition commit 分离，后续选择取消或 IO 失败不会提前清掉 dirty guard。文件切换同时取消 pending autosave 并清 dirty ref。
- Monaco shell 补 `min-h-0` / `overflow-hidden`、ResizeObserver relayout 和共享 Unicode highlight 选项，避免长稿撑开壳层与中文标点被误标。
- timeline 的 `summary`、`evidence_refs`、`payload` 均在写入和读取边界脱敏；无 `workspace_id` 的 book 不再接受任意 `project_id`。LLM upstream error 同时精确脱敏 resolved source 中的 `STORYFORGE_LLM_API_KEY` / `STORYFORGE_LLM_AUTH_TOKEN`。
- 重植 master 存量 Workflow Ruff import 排序修复，使总门禁可通过。

**验证结果**：
- `pnpm.cmd run verify` → **退出码 0，所有本地核心门禁通过**：
  - lint / Prettier 通过；仅保留既有 `Editor.tsx` exhaustive-deps warning（0 errors）。
  - Desktop typecheck、Shared `tsc --noEmit` 通过。
  - Desktop tests：**118 node tests + 24 vitest tests passed**。
  - API：**924 passed, 3 skipped, 6 warnings**；API Ruff 通过。
  - sidecar daily smoke：health、assistant REST、严格 Agent WS subprotocol 握手/收发、Alembic managed schema、prompt bundle 全绿。
  - Workflow：**323 passed**；Workflow Ruff 通过。
  - OpenAPI / Agent WS schema / generated types 刷新后 **零漂移**。
- `uv run pytest tests/test_ide_websocket_auth.py tests/test_timeline_events.py tests/test_llm_client_channel.py tests/test_book_run_workflow_dispatch.py -q` → **40 passed**。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml fs::tests` → **12 passed**（含直接外部路径与 symlink escape 拒绝）。
- `rustfmt --edition 2021 --check apps/desktop/src-tauri/src/fs.rs`、`git diff --check` → **通过**。
- `npm.cmd run build` → **Vite production build 通过**。

**未验证项 / 诚实边界**：
- 未运行 `pnpm e2e`，未做真机 Tauri/WebView2 人工流程；Node WHATWG strict smoke 能验证 RFC 子协议回显，但不能替代 GUI 多轮渲染、补丁确认和真实写回观感。
- 本轮只把 Agent/context **读侧**收口到 Rust canonical containment；兼容用裸 `read_file` 及写/删/改名命令仍存在，写侧能力政策留后续 capability/command 边界收口。
- 未改变 proposed patch 红线：后端仍只产出待确认 artifact，只有前端 diff confirmation 后才能写回本地稿件。
- 未跑真实 provider/真实 LLM；所有 token 均为测试假值，验证报告不含私有凭据。

记录时间戳：2026-07-10 17:02:00 +08:00。

---

## 2026-07-10 W4 batch-2a：死域冻结第二波（clean 3：prompt_packs / series / worldbuilding）

**背景**：承 W4 batch-1（analytics/batch_refinery/collaboration/commercial）与 `app/domains/DOMAINS.md` 的 batch-2 前置评估，本波卸载 6 个候选冻结域中**测试无纠缠的 3 个**。剩余 `assets`/`evaluations`（织进 live 集成测试 `test_phase1_closed_loop_api.py`）与 `workspaces`（`test_api_middleware.py` 拿 `/api/workspaces` 当「通用受保护端点」测 auth/CORS，8 处）需 test 手术，留 batch-2b。分档判据：只在本波动「专属可删 HTTP 测试」的域，不碰 live/共享集成测试（家法：小步、不顺手改无关测试）。

**做了什么（纯 router 卸载，`models.py` 全保留）**：
- `main.py`：删 `prompt_packs`/`series`/`worldbuilding` 三 router 的 import + include（各 2 行，共 6 行）。三 router 仅在 `main.py` 被 import（grep 全 `app/` 证），models 走 `app/models.py` 聚合建表不受影响。
- `tests/test_api_surface.py`：三前缀（`/api/prompt-packs`、`/api/series`、`/api/worldbuilding`）入 `FROZEN_UNMOUNTED_PREFIXES`；删 `worldbuilding` 正向 surface 断言（`workspaces` 断言保留，仍挂载）。
- 删 4 个专属 HTTP 测试文件：`test_prompt_packs.py`、`test_series_memory.py`、`test_series_worldbuilding_api.py`、`test_worldbuilding_center.py`（只测已冻结 HTTP 面，无 live 模型/服务覆盖）。
- e2e 契约：`phase2-contract.spec.ts` 摘 series 路径 + `SeriesMemoryCreate` schema 断言（保留 style-packs）；`phase4-contract.spec.ts` 摘 prompt-packs 路径断言（保留 evaluations / model-runs 等）。
- `pnpm openapi` 重新生成：`storyforge.openapi.json` + `api-types.ts` 净减约 2100 行（三域 paths + schemas 下线）。
- `DOMAINS.md`：记 batch-2a 已卸载；剩余 batch-2b（assets/evaluations/workspaces）标注各自卸载前置手术。

**验证结果**：
- 靶向 pytest（`test_api_surface` + `test_api_middleware` + `test_phase1_closed_loop_api` + `test_assets_api` + `test_evaluations` + `test_workspaces_api`）→ **43 passed**（保留域仍挂载、guardrail 认新前缀、middleware 拿 workspaces 测 auth 不受影响）。
- `cd apps/api && uv run pytest -q`（全量）→ **916 passed, 3 skipped**（相对 master 基线 924 减去 4 删除文件的 8 个用例，数目自洽）。
- `uv run ruff check app/main.py tests/test_api_surface.py` → **All checks passed**。
- `npm --prefix apps/desktop/frontend run typecheck`（`tsc --noEmit`）→ **通过**（dropped schemas 无前端消费者）。
- `pnpm --filter @storyforge/shared test`（`tsc --noEmit`）→ **通过**。
- `pnpm e2e` → **21/21 契约测试通过 + OpenAPI 零漂移**。
- `pnpm lint` → **0 errors**（仅既有 `Editor.tsx` exhaustive-deps warning）。

**未验证项 / 诚实边界**：
- 未卸载 `assets`/`evaluations`/`workspaces`（batch-2b，需 test 手术）；三域 router 仍挂载、面仍在契约。
- 未删任何 `models.py`（冻结红线：models 在 `app/models.py` 聚合建表，删会连累 live）；本波纯 router 卸载 + 死测删除，行为对 live 面零变更。
- `pnpm verify` 全量超 10min 窗口未整体跑完（sidecar smoke 冻结 exe 构建 + workflow 用时占大头）；改跑上述分项门禁，等价覆盖 API/前端/契约/lint，跳过与本改无关的 sidecar smoke / workflow。

记录时间戳：2026-07-10 18:44:26 +08:00。

---

## 2026-07-10 W4 batch-2b：死域冻结第三波（delicate 3：assets / evaluations / workspaces，batch-2 收官）

**背景**：承 batch-2a，卸载 batch-2 剩余的 3 个「测试有纠缠」域。至此 W4 batch-2 六域 router 全部卸载（合 batch-1 共 **10 个 frozen router 全卸**）。`models.py` 全保留（live 依赖）。

**做了什么（纯 router 卸载 + test 手术）**：
- `main.py`：删 assets/evaluations/workspaces 三 router 的 import + include。
- `test_api_surface.py`：三前缀入 `FROZEN_UNMOUNTED_PREFIXES`；删 workspaces 正向 surface 断言。
- **手术 1（workspaces / `test_api_middleware.py`）**：8 处 `/api/workspaces`（当「通用受保护端点」测 auth 401 + CORS preflight）→ 改指 `/api/agent-runs`。理据：auth 中间件对任意 `/api/*` 缺/错凭据在 **routing 之前**即返 401（同文件 `test_api_key_auth_shares_settings_fact_source` 用 `/api/__nonexistent__` 已证），CORS preflight 亦由中间件在 routing 前处理；无「合法凭据期望 200」用例 → 端点存在与否不影响结果，行为等价。
- **手术 2（assets / `test_phase1_closed_loop_api.py`）**：`_create_asset` 从 `/api/assets` POST 改 session 直建 `Asset`（`create_asset` 唯一非平凡逻辑是 `lineage_key=uuid4()`，下游 scene-packet 按 asset id + payload 引用，session 直建保留闭环 live 覆盖）。
- **手术 3（evaluations / `test_phase1`）**：删该测尾段 `/api/evaluations` 评测块（frozen 面覆盖，非 live 闭环）。
- 删 3 个专属 HTTP 测试：`test_assets_api.py`、`test_evaluations.py`、`test_workspaces_api.py`。
- e2e 契约：phase1（assets path + `AssetCreate`）/phase3（整个 workspaces 端点 test + `WorkspaceCreate`）/phase4（evaluations path + `EvaluationRunRead`）同步摘除。
- `pnpm openapi` 重生成；`DOMAINS.md` 记 batch-2b + batch-2 收官。

**验证结果**：
- 靶向 pytest（`test_phase1_closed_loop_api` + `test_api_middleware` + `test_api_surface`）→ **21 passed**（asset session 直建 + 中间件 repoint + guardrail 全绿）。
- `cd apps/api && uv run pytest -q`（全量）→ **894 passed, 3 skipped**（相对 batch-2a 基线 916 减去 3 删除文件的 22 个用例，自洽）。
- `uv run ruff check`（改动文件）→ **All checks passed**。
- frontend typecheck / shared `tsc --noEmit` → **通过**（dropped schemas 无消费者）。
- `pnpm e2e` → **20/20 契约测试 + OpenAPI 零漂移**（相对 batch-2a 的 21 少 1 = 删除的 phase3 workspaces 端点 test）。
- `pnpm lint` → **0 errors**（仅既有 `Editor.tsx` warning）。

**未验证项 / 诚实边界**：
- 未删任何 `models.py`（冻结红线）；本波纯 router 卸载 + test 手术，对 live 面行为零变更。
- workspaces 中间件 repoint 到 `/api/agent-runs`：该端点是 live 核心（永不冻结），且这些测试只依赖中间件层（auth/CORS）而非路由层，故耦合安全。
- 物理删除（attic tag + 逐域 grep）+ service-live 域（studio/style_packs）router 卸载仍留后续增量。

记录时间戳：2026-07-10 19:19:41 +08:00。

---

## 2026-07-10 冻结域死码物理清理（frozen HTTP 层删除，收官 W4「死域彻底删」）

**背景**：承 W4 batch-1/2a/2b（10 个 frozen router 全卸），用户拍板「彻底清死代码」。本刀物理删除所有冻结域的 HTTP 层，keep models（`app/models.py` 聚合建表红线）。**apps/workflow 不在本刀**——它仍被 `book_runs/book_generation_parallel.py`（managed 整书生成链）用 importlib 加载 BookLoop/NovelLoop/arc_consistency，受质量轨红线保护（n=1 稳定后重评），本刀不碰。

**删了什么**：
- **10 冻结域 × router.py + service.py + schemas.py 物理删除**（30 文件）。三个无 models 域 `analytics`/`batch_refinery`/`worldbuilding` **整目录删除**（含 `__init__`）；`assets`/`collaboration`/`commercial`/`evaluations`/`prompt_packs`/`series`/`workspaces` 只剩 `models.py` + `__init__.py`。
- 删 3 个 `*_service_acceptance` 死测（phase1/3/4，纯测冻结 service）。
- **conftest 手术**：删 `_reset_domain_caches` autouse fixture（唯一逻辑是调 `worldbuilding.service.invalidate_worldbuilding_cache`，服务已删、该 cache 无 live 生产方）。
- **test_source_pruning 手术**：删 worldbuilding/batch_refinery 两个 `__init__` 卫生测（目录已删，`read_text` 会 FileNotFound）；judge/story_memory 卫生测保留。
- **test_redis_cache_strategy 手术**：删 3 个 worldbuilding/asset 缓存测 + 相关 import/fixture patching；**保留 artifacts 缓存测 + redis_cache util 测**（artifacts 是 live/backing、redis_cache 是 live common util，coverage 不丢）。

**验证结果**：
- OpenAPI 重生成 **零变更**（router 早已卸载、frozen schema 早已不在契约 → 删 .py 不动契约面）；`git status packages/shared` 空。
- pytest **collection 887 tests 零 import 错误**（删除无 dangling 引用）。
- `cd apps/api && uv run pytest -q`（全量）→ **884 passed, 3 skipped**（相对 batch-2b 基线 894 减 10：3 acceptance 文件 5 例 + redis_cache 3 例 + source_pruning 2 例）。
- `uv run ruff check app/ tests/`（**全量 api**）→ **All checks passed**（无 unused import / dangling 引用）。
- frontend typecheck / shared `tsc --noEmit` / `pnpm e2e`（**20/20 + 零漂移**）/ `pnpm lint`（**0 errors**）全绿。

**未验证项 / 诚实边界**：
- `models.py` 一行未删（红线）；7 个 models-only 域目录只剩 `models.py` + `__init__.py`。
- **apps/workflow + 第 7 LLM 客户端未动**（质量轨红线：`book_generation_parallel` 仍用它跑 managed 生成；`runtime_tools` 仍桥到 workflow registry 供 `/api/runtime-tools`）。workflow 降级/删除待质量轨翻案（D1 级决定）或 n=1 后重评。
- `studio`/`style_packs`（service-live 冻结域）router 未卸、service 保留（live ide / book_runs 依赖）。

记录时间戳：2026-07-10 20:10:33 +08:00。

---

## 2026-07-10 project.prose_check 文笔气味静态检查工具（workflow → IDE-agent 能力迁移首刀）

**背景**：承 W4/W5 收官 + 迁移 ledger（`docs/internal/workflow-capability-migration-ledger.md`，PR #122）。ledger §3 退役路径第 1 步 = 「dogfood 需要时把一个 tier-1 闸做成 advisory agent 工具」，pivot 方向（编辑器原生连载 / 作者即 oracle）要求给 live agent 补「丰富文笔气味检测」缺口（§1 可见缺口，`project.consistency` 只做机械计数）。本刀把 tier-1 的 `quality/prose_static_check.py`（确定性、无 LLM、碰不到质量轨红线）抢救进 live agent 工具循环。

**做了什么**：
- **新增纯模块 `apps/api/app/domains/agent_runs/prose_scan.py`**：从 `apps/workflow/storyforge_workflow/quality/prose_static_check.py` 逐字节抢救 `StaticProseIssue` + `check_prose_static_quality`（自包含纯 stdlib，零 workflow 依赖，faithful copy 保留完整签名留后续 slice 接 canon 事实 / 人物禁止表现）；加 path-scoped 只读包装 `prose_static_scan(project_root, path)`（复用 fs_tools `_resolve_root/_resolve_scoped/_read_text`，越界拒绝、空文件显式报错、24K 内容预算 + 截断标记），返回 advisory issue（维度 / 严重度 / snippet / message / suggestion + dimension_counts / severity_counts rollup）。
- **接进工具循环 `project.prose_check`**（同 canon slice 建法，spec 单点派生）：`tooling.py` 加 `AgentRuntimeToolSpec`（domain=project、risk=read、retry_safe/idempotent=True、带 `loop_schema`）；`runtime.py` 加 handler + `_project_prose_check` 实现；`loop_runtime.py` 加 output_summary 分支 + 系统提示一句引导；`role_catalog.py` 加进 `root_agent` + `context_explorer` allowed_tools。
- **重生成 golden** `tests/fixtures/loop_tool_schemas_golden.json`（9→10 工具，CRLF 行尾对齐、minimal diff 仅 +19 行 prose_check 块）。
- **写回红线不变**：只读观察工具、无 LLM、不写盘、不落 DB；结论由循环 LLM 结合原文判断，修改仍走待确认补丁。

**验证结果**：
- 靶向 pytest（`test_agent_prose_scan`（10 例，确定性无 key）+ `test_loop_tool_schemas`（7）+ `test_runtime_tools`（7））→ **24 passed**。
- 循环集成 pytest（`test_chat_loop_prose_check_feeds_static_smells`：真 WS → runtime → prose_static_scan 端到端，确定性 issue 喂回模型 + 落证据链）→ **passed**。
- `cd apps/api && uv run pytest -q`（**全量**）→ **895 passed, 3 skipped**（相对物理清理基线 884 + 11 新用例，零回归）。
- `uv run ruff check`（改动文件）→ **All checks passed**。
- `pnpm openapi` + `node scripts/check-openapi-drift.mjs` → **OpenAPI + Agent-WS 契约零漂移**（loop 工具非 HTTP 路由，契约面不动）。
- 工作树 diff：6 改 + 2 新，无 stray 生成物 churn。

**未验证项 / 诚实边界**：
- slice-1 工具入口只喂正文，`check_prose_static_quality` 的角色一致性 / 连续性 / beat 约束维度不触达（留后续 slice 接 canon 事实）；这些维度纯函数分支有单测覆盖但工具未喂。
- `apps/workflow` 侧 `prose_static_check.py` 仍在（迁移是复制非删除；workflow 物理删除待质量轨翻案 / n=1 后，见 ledger §4 红线）。
- 真机桌面 GUI 多轮渲染 / 作者实感归 E2E-1 未验；本刀只到 headless 循环端到端。
- `project.prose_check` 是 advisory 观察信号，非文笔质量判定或验收结论。

记录时间戳：2026-07-10 13:46:03 +08:00。

---

## 2026-07-10 第二轮过夜重构（受控执行）

**启动状态**：
- 起点：`master@129dd3b4`；启动时 `master...origin/master`，仅 `REFACTOR_PLAN.md` 为既有未提交改动。
- 工作分支：`codex/refactor-overnight-20260710`。
- 执行事实源：仓库根目录 `REFACTOR_PLAN.md`；未跟踪本机脚手架永不 stage，不 push、不开 PR。

**基线（业务代码修改前）**：
- `cd apps/api && uv run pytest -q` → **895 passed, 3 skipped**，6 warnings，耗时 211.44s。
- `cd apps/desktop/frontend && node scripts/verify-unit.mjs` → **118 passed, 0 skipped**。
- `cd apps/desktop/frontend && npx vitest run` → **24 passed, 0 skipped**（3 test files）。
- B2 合并 runner 的用例数硬门槛：**至少 142 tests**（118 + 24），且不得新增 skip。

**批次状态**：
- B1 `project.collapse_check`：done，提交 `e363265c`。
- B2 Vitest 单 runner 收口：done，提交 `beaf35f6`。
- B3 judge/story_state `llm_client` 收敛：done，提交 `7b0b239f`。

**B1 `project.collapse_check`**：
- 新增 `collapse_scan.py`，只复制 `collapse_judge.judge()` 与正文调查模板五桶规则；`judge_fact`、`NarrativeSceneFact`、phase policy 和 gate harness 均未搬。模块自包含，零 `storyforge_workflow` import。
- 工具为 advisory-only：输出 `pass | warn` verdict、`rule / severity / detail / snippet` issues 和短 summary；loop 只把 summary 回灌模型，完整 verdict 留工具证据。
- 参数保持诚实缺席语义：未传字段跳过对应规则，显式空串 / 空数组作为“无”参与判定；测试显式区分未传与空不可逆后果。
- `uv run pytest tests/test_agent_collapse_scan.py tests/test_agent_loop_runtime.py -q` → **25 passed**。
- 加 schema/golden 对账：`uv run pytest tests/test_agent_collapse_scan.py tests/test_agent_loop_runtime.py tests/test_loop_tool_schemas.py -q` → **32 passed**。
- `uv run pytest -q`（最终 B1 diff）→ **904 passed, 3 skipped**，6 warnings，耗时 205.40s；相对基线新增 9 例，零回归。
- `uv run ruff check .` → **All checks passed**。
- `node ../../scripts/check-openapi-drift.mjs` → **OpenAPI 契约无漂移**，Agent WS / shared / frontend 生成物零 diff。
- 红线审计：`apps/workflow`、`apps/desktop/frontend/src/components`、models/Alembic 零 diff；golden 与 `loop_runtime.py` 保持既有 CRLF；无真实 key / env 读取。

**B2 Vitest 单 runner 收口**：
- 盘点 21 个 `tests/**/*.test.ts(x)`：全部只从 `node:test` 导入 `test`，无 `describe` / hook / mock / 回调 `t` 上下文；逐文件仅替换为 `import { test } from 'vitest'`，`node:assert/strict` 与测试体、断言语义全保留。
- 旧 runner 的环境职责：手工转译 TS/TSX、改写相对 import、转发 React runtime、为 Monaco/Tauri 注入 runtime stub；Vitest 改由 Vite 处理 TS/TSX 与模块解析、happy-dom 提供 window。首跑 21/24 files、122 tests 通过，3 个 TSX suite 因 `monaco-editor` 无 Vite 可解析入口在 import 阶段失败；按旧 runner 等价行为新增 `tests/stubs/monaco-editor.ts` alias 后全绿。Tauri 实际模块无需额外 stub。
- `vitest.config.ts` include 同时覆盖 `tests/**/*.test.{ts,tsx}` 与 `tests/**/*.vitest.ts`，环境统一 happy-dom；`package.json` 的 `test` 收敛为 `vitest run`，无消费者的 `test:behavior` 删除，`scripts/verify-unit.mjs` 删除。
- `npm --prefix apps/desktop/frontend run test` → **24 files passed, 142 tests passed**；等于基线 118 + 24，零失败、零新增 skip。
- `npm --prefix apps/desktop/frontend run typecheck` → 通过。
- `pnpm.cmd lint` → **0 errors**；保留既有 `Editor.tsx:336` `react-hooks/exhaustive-deps` warning，B2 未触碰源码。
- 红线审计：`apps/desktop/frontend/src`、lockfile、`apps/workflow`、API 零 diff；无新增依赖；21 个旧测试文件各自只有一行 runner import 变化。

**B3 judge/story_state chat 出网统一到 common `llm_client`**：
- discovery 仅命中 `judge/semantic.py`、`story_state/semantic.py` 两个真实 POST；`judge/service.py` 的 `httpx` 只是测试 monkeypatch facade。retrieval embedding/reranker 未触碰。
- common `_request_chat_completions` 新增可选 `timeout_seconds` / `max_attempts`，未传时继续读取既有 env 默认，现有调用方行为不变；新增真实协议测试证明 per-call timeout 原样传给 urllib、`max_attempts=1` 覆盖通用三次重试。
- judge/story_state 继续在域内构造原 `model / messages / temperature=0 / reasoning_effort` payload 并使用原解析器；只把规范化 base URL、专属 key、固定 bearer overlay 交给 common transport，显式传专属 timeout 与 `max_attempts=1`。
- 异常行为保持：两域原有 `except Exception` 继续把 common `LLMError` / 配置 / 解析异常收敛为 `SemanticJudgeOutcome(failed=True)` 或 `semantic_grounding_failed` advisory；failure marker 与日志脱敏测试全绿，无异常类向上泄漏。
- mock 点从 `judge_service.httpx.Client` 迁到 `app.common.llm_client._request_chat_completions`，断言原 payload 字段集、覆盖链、bearer、timeout 与单次尝试；book generation 集成替身只截获两个语义 system prompt，writer 仍走真实本地 HTTPServer。
- `uv run pytest tests/test_judge_semantic.py tests/test_judge_failure_marker.py tests/test_story_state.py tests/test_llm_client_channel.py tests/test_book_generation.py -q` → **97 passed**。
- `uv run pytest -q` → **907 passed, 3 skipped**，6 warnings，耗时 210.64s；相对 B1 后新增 3 个等价性测试，零回归。
- `uv run ruff check .` → **All checks passed**。
- `rg "import httpx" apps/api/app/domains/judge apps/api/app/domains/story_state` → 零命中。
- 红线审计：改动仅 4 个生产文件 + 4 个测试文件；retrieval、workflow、desktop、models/Alembic、shared 零 diff。

**最终全仓门禁**：
- `pnpm.cmd verify` → **通过**：根 lint / Prettier（0 errors；保留既有 `Editor.tsx:336` hook warning）、frontend typecheck、shared typecheck、frontend **24 files / 142 tests**、API **907 passed / 3 skipped**、API ruff、daily sidecar smoke（health / assistant / Agent WS / Alembic managed / prompt bundled）、workflow **323 passed**、workflow ruff、OpenAPI/Agent WS drift 全绿。
- `pnpm.cmd e2e` → **20 passed / 0 skipped**，6 个 contract specs 全绿，OpenAPI 刷新后零漂移。
- 最终业务提交：`e363265c`（B1）、`beaf35f6`（B2）、`7b0b239f`（B3）；均为本地提交，未 push、未创建 PR。

**未验证项 / 诚实边界**：
- 未读取真实 key，未执行真 LLM 可选验收；B1 只证明确定性规则 + mock loop，B3 只证明 transport/payload/失败语义等价。
- 未执行真机 Tauri GUI 多轮渲染或补丁确认；本轮没有 UI 组件改动，不能外推为真机 GUI 验收。
- lint 的 `Editor.tsx:336` `react-hooks/exhaustive-deps` warning 为既有告警，本轮按“UI 源码零改动”红线未处理。

记录时间戳：2026-07-10 23:18:00 +08:00。

---

## 2026-07-11 第三轮过夜重构（受控执行）

**启动状态**：
- 起点：`master@ab832a2e`；启动时 `master...origin/master [ahead 5]`，仅 `REFACTOR_PLAN.md` 为既有未提交改动。
- 工作分支：`codex/refactor-overnight-20260711`。
- 执行事实源：仓库根目录 `REFACTOR_PLAN.md`；严格按 B1-B8 顺序与退出条件执行，不自由发挥；不 push、不开 PR。
- Trellis 任务：`.trellis/tasks/07-11-third-overnight-refactor`（inline 模式，主会话直接实现与检查）。

**执行前置**：
- 已通读 `AGENTS.md`、`CLAUDE.md`（含 §6）、`CONTEXT.md`、workflow 能力迁移 ledger、`DOMAINS.md` 与相关 agent/desktop 架构文档。
- 已分块通读 `git show bfb5c75c` 与 `git show e363265c` 全 diff；已完整读取 canon store/gate/rebuild/dossier、common `llm_client.py` 及 ChatWindow 会话 effect/终态/恢复/流事件/编辑器回传接线。
- 当前线程未暴露项目首选的 `desktop-commander`、GitHub MCP 或 `tool_search`，已向用户说明后降级为本地 PowerShell/`rg`/`git`；不涉及远端状态变更。

**基线（业务代码修改前）**：
- `cd apps/api && uv run pytest -q` → **907 passed, 3 skipped**，6 warnings，耗时 207.77s。
- `npm --prefix apps/desktop/frontend run test` → **24 files passed, 142 tests passed**，耗时 3.13s。
- `cd apps/api && uv run ruff check .` → **All checks passed**。

**批次状态**：
- B1 `project.entity_budget_check`：done，提交 `ee0b31b9`。
- B2 `project.canon_delta`：done，提交 `8eaecaf5`。
- B3 retrieval transport：done，提交 `1760e552`。
- B4 草稿会话 nonce：done，提交 `32c27c36`。
- B5 切会话清 run 面板：done，提交 `71573f0a`。
- B6 Revise 死类型：done，提交 `9a764729`。
- B7 探针去 flaky：done，提交 `20ae68f4`。
- B8 usage 字段对齐：done，提交 `f27be73e`。

**B1 `project.entity_budget_check`**：
- 新增自包含 `entity_budget_scan.py`，逐条复刻 workflow `EntityBudgetGate.validate` 的 3 条章节阈值与 4 条数量预算规则；零 `storyforge_workflow` import，不修改 workflow 源文件。
- 工具参数完整覆盖计划指定的 6 组新增项、可选 chapter 与 6 个 `EntityBudget` 预算字段；字段未传跳过对应规则，显式空数组参与判定；chapter 未传时直接复用 `_iter_project_files(root)` 的 1-based 阅读序。
- 路径沿用项目 scope 守卫，文件不存在、越界或空内容均抛 `FsToolError`；输出为 `{path, chapter, verdict, summary}`，loop 只回灌短 summary，完整 verdict 留 tool trace 证据。
- 按既有迁移模板接入 ToolSpec、runtime handler、loop prompt/output summary、root/context_explorer role 与 frozen golden；golden diff 仅新增一个工具块，文件保持纯 CRLF。
- `uv run pytest tests/test_agent_entity_budget_scan.py tests/test_agent_loop_runtime.py tests/test_loop_tool_schemas.py -q` → **41 passed**。
- `cd apps/api && uv run pytest -q` → **924 passed, 3 skipped**，6 warnings，耗时 210.79s；相对基线新增 17 例，零回归。
- `uv run ruff check .` → **All checks passed**。
- `node ../../scripts/check-openapi-drift.mjs` → **OpenAPI 契约无漂移**，Agent WS / shared / frontend 生成物零 diff。
- 红线审计：`apps/workflow`、models/Alembic、desktop `src`、shared 生成物、依赖/lockfile 均零 diff；无真实 key / env 读取。

**B2 `project.canon_delta`**：
- 新增 `canon_delta.py`，不调用 LLM：复用 canon surface forms、presence cache/rebuild 和 gate；实体按 canonical name/alias 分类 known/new，新实体 id 为 `ent_` + name sha1 前 8 位。
- salvage `name_registry` 核心冲突语义：单一提议表面形命中多个既有实体、或一个提议实体的表面形横跨多个既有实体时，返回 `alias_conflict` advisory，不做歧义合并。
- deep-copy 原 canon 后仅追加新实体与 holder/exit/timeline claims；原 canon 与合并草稿分别跑 gate，按稳定 issue id 差集只返回提案新增 conflicts/advisories。
- 派生 JSON 白名单仅新增 `proposals.json`；presence 缓存缺失会确定性重建并回填；合并后的完整 canon 草稿写 `proposals.json`，不写 `canon.json` 或正文。
- 单测覆盖 canonical/alias known 命中、新实体稳定 id、两种 alias conflict、正反例、single-holder 新冲突且过滤基线冲突、lifespan 新 advisory、全空参数、presence 自愈、白名单外拒写，以及 **`canon.json` 调用前后 byte 完全一致**。
- `uv run pytest tests/test_agent_canon_delta.py tests/test_agent_canon.py tests/test_agent_loop_runtime.py tests/test_loop_tool_schemas.py -q` → **56 passed**。
- `cd apps/api && uv run pytest -q` → **935 passed, 3 skipped**，6 warnings，耗时 226.30s；相对 B1 新增 11 例，零回归。
- `uv run ruff check .` → **All checks passed**。
- `node ../../scripts/check-openapi-drift.mjs` → **OpenAPI 契约无漂移**，Agent WS / shared / frontend 生成物零 diff。
- 红线审计：`apps/workflow`、models/Alembic、desktop `src`、shared 生成物、依赖/lockfile 均零 diff；golden 相对 B1 只新增 canon_delta 条目且保持纯 CRLF。

**B3 retrieval embedding/reranker 出网统一**：
- 前置异常依赖核查覆盖 retrieval/story_memory/scene_packets/book_runs：无调用方 catch/isinstance `httpx.*`，生产 `httpx` import 仅剩 embedding/reranker 两处，满足计划实施条件。
- `app/common/llm_client.py` 新增 `post_json_with_retry`：复用既有 429/5xx 判定、Retry-After/指数退避、响应读取错误集合和 `LLMError`；最终失败消息与 warning 日志均经 `redact_secrets`，不做 token 记账。
- 非 chat JSON body 对齐 httpx 0.28 的 `ensure_ascii=False + separators=(',', ':') + allow_nan=False` 字节编码；新增测试直接断言 UTF-8 请求体。
- embedding/reranker 只把 `http_client_factory` 换成可注入 `post_json` callable；URL、body 字段、Bearer/Content-Type、timeout=30、embedding batch 分批、空文本替换、响应解析及畸形响应 RuntimeError 路径保持。
- `resolve_embedding_client` / `resolve_reranker_client` 的 `STORYFORGE_EMBEDDING_*` / `STORYFORGE_RERANKER_*` 裸 env 语义零 diff；chat `_request_chat_completions` / `_call_llm*` 零 diff。
- `test_retrieval_real_providers.py` 替身迁为 `_FakePostJson`，继续断言 URL/headers/body，并新增 timeout/max_attempts/service_label 断言；common 测试覆盖 429→成功、失败日志/异常脱敏和 body 字节。
- `uv run pytest tests/test_retrieval_real_providers.py tests/test_retrieval_embedding.py tests/test_llm_client_channel.py -q` → **55 passed**。
- `cd apps/api && uv run pytest -q` → **938 passed, 3 skipped**，6 warnings，耗时 218.72s；相对 B2 新增 3 例，零回归。
- `uv run ruff check .` → **All checks passed**；ruff banned-api 新增 `httpx` 禁令。
- `rg "import httpx|from httpx" apps/api/app` → **零命中**。
- 红线审计：改动仅 common transport、两个 retrieval client、ruff 配置与两测试文件；workflow、desktop、models/Alembic、shared、依赖/lockfile 均零 diff。

**B4 草稿会话 nonce + 复合 conversation key**：
- `session-guard.ts` 新增 `conversationKey`，已保存会话与草稿会话分别使用 `saved:<id>` / `draft:<nonce>`；守卫改为比较 key，两个 `null` 不再天然相等。
- `ChatWindow.tsx` 使用模块级确定性计数器生成 draft nonce；新建会话 handler 与 non-null→null prop 转移两处轮换 nonce。run 起跑时捕获 key，恢复结果、流事件、成功终态、catch 终态、Suggestion 回传和 AuthorLoop 回传六处统一比较 key；持久化成功后推进为 saved key。
- 决策表覆盖 saved 同/异号、同 draft、draft A→B、draft→saved、saved→draft；靶心用例明确断言 draft A 起跑后切 draft B 为 false。
- `npm --prefix apps/desktop/frontend run test` → **24 files / 145 tests passed**；`npm --prefix apps/desktop/frontend run typecheck` → 通过。

**B5 真切换会话清理 run 面板 state**：
- 新增纯函数 `shouldResetRunPanels` 与决策表；真切换补清 `agentRun`、`writingRunProjection`、`retryRequest`，不改 `agentBusy` 或既有 messages 行为。
- 草稿首次持久化前记录 `selfPersistedSessionIdRef`，null→后端 id 的自我转移只消费并清除豁免，不把刚完成的流程树清掉。
- `npm --prefix apps/desktop/frontend run test` → **25 files / 148 tests passed**；`npm --prefix apps/desktop/frontend run typecheck` → 通过。

**B6 Revise 死类型清理**：
- 重新搜索消费者后，仅删除 `ReviseResult`、`ApiAssistantReviseRequest`、`ApiAssistantReviseResponse` 及 barrel 的两行 re-export；`ReviseRequest` 本体保留，`codecs.ts` 的 `contextBundle` live 取形不变。
- typecheck 通过；前端 **25 files / 148 tests passed**；`pnpm.cmd lint` 退出码 0、Prettier 全绿，仅保留既有 `Editor.tsx:336` hook dependency warning。

**B7 连通性探针测试 harness 加固**：
- 三个本地 `HTTPServer` 用例在启动 PowerShell 前等待 socket connect；子进程 harness timeout 由 20s 放宽到 60s，被测 `-TimeoutSeconds=5` 不动；finally 统一 `shutdown()` + `server_close()` + `thread.join()`。
- 精确请求序列、输出 gate、凭据不回显和“不启动真实长程”断言均原样保留；handler 的 `requests` / `chat_count` 每用例显式重置。
- 目标文件连续 **10 遍**运行，每遍均为 **10 passed**；API 全量 **938 passed, 3 skipped**；目标 ruff 通过。

**B8 usage 证据字段对齐**：
- `ChatLoopOutcome` 累加 `token_usage`，保留 `token_usage_source` 并合并每轮 `cost_breakdown`；`assistant.chat_loop` output summary 补齐三字段。
- assistant `chat` / `revise` / `draft` 三条单轮 evidence 纯 additive 补 `token_usage`、`cost_breakdown`、`token_usage_source`；响应 DTO、DB、OpenAPI、embedding/reranker 记账均未改。
- 新矩阵测试用带 usage 的 mock 结果分别驱动 ModelRun、真实 Agent WebSocket loop evidence、assistant chat/revise/draft evidence，统一断言公共字段集。
- 矩阵目标 **1 passed**；受影响组合 **28 passed**；API 全量 **939 passed, 3 skipped**；ruff 与 OpenAPI drift 均绿。

**最终全仓门禁**：
- `pnpm.cmd verify` → 通过：lint/Prettier、Desktop typecheck、shared typecheck、Desktop **25 files / 148 tests**、API **939 passed / 3 skipped**、API ruff、daily sidecar smoke、Workflow **323 passed**、Workflow ruff、OpenAPI/Agent WS drift 全绿。lint 仅有既有 `Editor.tsx:336` 非阻断 warning。
- `pnpm.cmd e2e` → **20 passed / 0 failed**，OpenAPI 刷新后零漂移。
- `git diff ab832a2e..HEAD` 红线审计：`apps/workflow`、任何 `models.py` / schema / Alembic / migration、依赖与 lockfile、OpenAPI/WS/shared/frontend 生成物均零 diff；前端 `src` 仅计划白名单六文件；`panels.tsx` 零改动；生产 `httpx` import 与新增 `storyforge_workflow` import 均为 0。
- canon 审计：golden 同时包含 `project_entity_budget_check` / `project_canon_delta` 且保持 CRLF；派生白名单仅新增 `proposals.json`；测试两处以 `read_bytes()` 证明 `canon.json` 不变。
- 八个业务批次均独立本地提交，未 push、未创建 PR；本机 `.agents/`、`.trellis/`、`AGENTS.md`、`.codex/config.toml` 等脚手架零提交。

**未验证项 / 诚实边界**：
- 未读取或使用真实 LLM key，未执行真实 provider 调用；B1/B2/B8 只证明确定性规则、mock LLM 与本地证据链，B3 只证明 transport/payload/错误语义。
- 未执行真机 Tauri GUI 多轮渲染、会话切换和补丁确认；B4/B5 的结论来自纯函数决策表、前端单测、typecheck 与全仓门禁，不能外推为真机 GUI 完整验收。
- 未做真实 3–5 万字长程质量验收，也未将自动测试或模型自评表述为人工通读。

记录时间戳：2026-07-11 02:38:00 +08:00。

## 2026-07-11 S4 文档事实源同步（拍板重排后首步）

- **背景**：2026-07-11 用户拍板重排下一步序列——08-31 盛夏寻章征文不当锚，「窗口倒排」骨架作废，改为「编辑器优先」两段序列：①编辑器做到「安全可日更」（S7 装机前两小刀 → S14 尾巴 → S8 重建 0.1.2 → S9 AI 装机预验 → S10 真机第二轮观感波 → S11 修复锁版）②在编辑器上写作品（S3 手稿保险挪至开写前夕 → 接续 n=1 连载）。愿景 = 写 → 发 → 收集信号 → 喂 → 进化编辑器 → 写出更有风格的作品。S6 政策哨兵删除（侦察 2026-07-07 已完成）。n=1 创作资产（黄金三章 spec / Ch1 定稿过 Gate-0 / Ch2 待审 / playbook v0 / 预注册跟读率预测表，源自 2026-07-07 会话）已抢救存档至仓库外 `D:\记事本\StoryForge-n1连载-末世吞噬-创作资产存档-20260707.md`，不入库。
- **变更**：`CLAUDE.md`（§1.1 补 2026-07-05 至 07-11 合并事实与 pivot 拍板链、§8.1 换新序列）、`docs/internal/TODO.md`（执行入口 / 事实边界 / 下一步优先级刷新至 2026-07-11）、`docs/internal/current-phase.md`（当前阶段补 07-05 至 07-11 段落与 pivot 拍板链、门禁状态补 2026-07-11 快照、仍未完成验收项改 G.1 已 PASS + 第二轮观感波、质量轨标注 D1 换锚、重跑 DoD 转档案判据）。纯文档变更，零代码。
- **验证**：`cd apps/api && uv run pytest tests/test_phase9_fact_sources.py -q` → **14 passed**（护栏钉住的章节结构与句子全部保留）。
- **未联通能力**：编辑器「安全可日更」波（S7-S11）尚未开始；真机第二轮观感波未执行；n=1 连载未在编辑器接续；文档所述 2026-07-11 全量门禁数字（API 939 / 前端 vitest 148）引用自第三轮过夜重构回填记录，本次未重跑全量。

## 2026-07-11 编辑器优先路线详版计划落仓

- **背景**：用户要求重新规划下一步计划。07-10「窗口倒排」规划的失败模式 = 规划全文只留在会话里导致状态丢失（该轮规划因此漏掉 07-07 n=1 已创作启动的事实）；本次详版计划直接落仓修复该模式。
- **规划前事实核对**（钉住计划的三处依据）：① `apps/desktop/src-tauri/src/fs.rs:60` `write_file` 裸收路径、写侧无 canonicalize containment（读侧已由 PR #118 补齐）→ S7a 确实开放；② `src-tauri` 无 single-instance 插件 → L7 双开守卫确实开放；③ `tauri.conf.json` version=0.1.1 → 重建即 bump 0.1.2。
- **变更**：新增 `docs/internal/editor-first-plan-2026-07-11.md`（Phase A 安全可日更 A1-A7 / Phase B 写作品 B1-B3 / Phase C 发+信号 / Phase D 喂+进化，含每步事实依据、DoD、归属、阶段门、小刀池、不做清单、拍板点 P1-P3）；`docs/internal/TODO.md` 下一步优先级补指针。
- **验证**：`cd apps/api && uv run pytest tests/test_phase9_fact_sources.py -q` → 14 passed。
- **未联通能力**：Phase A 各步均未开始执行；A1/A2 的 cargo 用例尚未编写；本记录只证明计划文档落仓与护栏零回归。

## 2026-07-11 编辑器优先 Phase A：A1-A5 实施与 0.1.2 装机预验

- **A1 Rust 写侧 containment**：`write_file` / `create_dir` / `delete_path` / `rename_path` 改为显式 `project_root`；现存目标 canonicalize，本不存在目标先校验最近已存在祖先，建父目录后再 canonicalize；拒绝外部路径、symlink 父目录逃逸与项目根删除。前端 `TauriFileSystem` 四个 mutation 签名及全部调用点同步携带项目根；示例项目首次创建以用户选中的父目录为 root。RED 证据：新增越界写测试先因 `write_file` 仅 2 参数编译失败；GREEN：Rust fs 17/17，最终 cargo 19/19。
- **A2 单实例**：接入 `tauri-plugin-single-instance 2.4.2`，插件位于 Builder 链首；第二次启动对 `main` 执行 show / unminimize / set_focus。Rust check/test 绿；真实双开聚焦仍归 A6 人工项。
- **A3 Agent 右栏状态保留**：新增 `AssistantPanelFrame`；项目打开后 `ChatWindow` 常驻，折叠只用 `hidden` + CSS `hidden/flex`，无项目仍不挂载。happy-dom RED 为模块缺失，GREEN 证明原 DOM node 跨隐藏保持 connected 且 state=1；前端全量 26 files / 149 tests。
- **A4 0.1.2 构建**：`APP_VERSION`、API pyproject/uv lock、Tauri config、Cargo package/lock 全部升至 0.1.2；OpenAPI 仅预期更新 `info.version`。`npm --prefix apps/desktop run build` 成功产出 MSI 与 NSIS；NSIS=`apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_0.1.2_x64-setup.exe`，SHA256=`FDA5D4FC6EBF95A2FFDABB877CB3716BDDEC70B21338C44434D799CA063A1697`。
- **A5 安装态预验**：静默覆盖安装后注册表 `DisplayVersion=0.1.2`。packaged sidecar smoke 5.244s 就绪，assistant REST、严格 WS 子协议回显/收发、Alembic managed=true、prompt layer bundled 全绿。另以安装前保留的 0.1.1 sidecar 占 8000，0.1.2 Desktop 日志明确检出 `Some("0.1.1")`、强杀 PID 11504、拉起 0.1.2；ready 返回 0.1.2。安装态最小 WS 对话返回 `agent_result` / session 7 / `chat.explain`，SSE 200 `text/event-stream` 回放 started/plan/system_job/artifact/completed。存量库升级前 6 sessions / 62 messages / 34 runs / 317 events，预验后 7 / 64 / 35 / 323，旧记录未丢，revision=`20260703_0001`。预验进程正常关闭，sidecar 随 Desktop 退出。
- **门禁**：API 939 passed / 3 skipped + ruff；前端 149 passed + typecheck；cargo 19 passed；lint 0 errors（保留既有 `Editor.tsx` 1 warning）；`pnpm.cmd verify` 全绿（另含 Workflow 323 passed、daily sidecar）；`pnpm.cmd e2e` 20/20；OpenAPI 刷新后零漂移；`git diff --check` 绿。
- **规范/交接**：Trellis Desktop quality/state specs 已补写 mutation canonical containment 与可折叠 Agent 面板常驻契约。A6 新 runsheet=`.codex/e2e-2-runsheet-0.1.2.md`。
- **未验证 / 不外推**：A6 真机第二轮观感波尚未由用户执行，故双开聚焦、IME、WS/SSE GUI 观感、canon dossier GUI、权限四轨 GUI、暂停/停止 UI、超时轮询 UI 尚不能宣称通过；A7 blocker 修复与 `v0.1.2` tag 未执行，Gate A→B 仍未通过。未做 3-5 万字长程或人工通读，不把自动门禁当作该类验收。

记录时间戳：2026-07-11 13:15:30 +08:00。

## 2026-07-11 Agent 服务端 WebSocket 退役收尾

**任务边界**：
- Desktop Agent 已在 `8cdd96db` 切到本地 SSE `/stream` + REST `/control`；本轮删除 API 侧最后一条 WebSocket route、subprotocol 鉴权、WS send adapter 与 WS-only `command + run_id` 事件复制。
- 按用户拍板直接退役 command-to-AgentRun 重复关联，不新增 HTTP 替代；REST command registry 的 `EventLog(ide_command_executed)` 与 `audit_event_id` 保持。
- `ws_messages.py` / `ws_schema.py` / `agent-ws.*` / `websocket_*` encoder 名称作为历史兼容路径保留；schema 标题、注释、架构文档与 Trellis spec 已改为 transport-neutral Agent frame 契约。

**实现与回归**：
- API 测试从 `TestClient.websocket_connect` 迁到公共 SSE/REST helper；helper 对非 2xx、错误 content-type、非法 JSON、空流和缺终态显式失败。
- 实证发现 Starlette `TestClient.stream` 会缓冲 ASGI streaming response，不能证明实时顺序；实时测试改为直接异步消费 `_agent_user_message_payloads`，在观察 `context.load` frame 后放行阻塞工具。
- SSE 迁移暴露 `permission_required.confirmation_action` 实际可为 bookrun action object、schema 却只允许 string；Pydantic/JSON Schema/generated TS 已扩为 `string | object | null`，golden 覆盖对象形状。
- `verify-agent-conversation.mjs` 删除 `MockWebSocket`，改用 `fetch + ReadableStream` 分批发送 SSE data frames，并断言 POST、Accept/API-key header、request body、中间帧和终态渲染。
- sidecar smoke 真实 POST `/stream`：空消息在 provider 前确定性得到 `agent_run_started + error` 两帧；另独立验证 `/control` 未知类型 error。日志不再把仅 control 往返宣称为 SSE 成功。
- 当前权威架构、域清单、TODO/current-phase/editor-first plan 与 A6 runsheet 已同步。用户确认 A6“壳子新 UI 全流程”“SSE / REST 真机观感”“中文 IME”“单实例与运行控制”均无问题，runsheet 第 1/2/3/6 组已标 PASS。

**验证结果**：
- 初始迁移基线：受影响 6 个 API 文件 **128 passed / 2 failed**；两处均为未完成迁移（`TestClient.stream` 假实时、permission action schema 不匹配），修复后聚焦组合 **155 passed**。
- `pnpm.cmd verify` → **通过**：Desktop frontend **26 files / 149 tests**，API **955 passed / 3 skipped**，Workflow **323 passed**，shared/frontend typecheck、API/Workflow ruff、daily sidecar、OpenAPI drift 全绿。lint 仅保留既有 `Editor.tsx:337` exhaustive-deps warning。
- `pnpm.cmd e2e` → **20 passed / 0 failed**，OpenAPI/Agent frame contract 刷新后无非预期漂移。
- `npm --prefix apps/desktop/frontend run verify:agent-conversation` → 通过，真实 `ReadableStream` SSE mock 驱动新壳子完成发送与终态渲染。
- `pnpm.cmd smoke:sidecar:packaged` → 通过：重新冻结当前 API，ready **4668ms**；assistant REST、Agent SSE **2 帧**、control REST、Alembic managed=true、prompt layer bundled 全绿，零 LLM/零外网。
- `rg 'websocket_connect|@router.websocket|WebSocketDisconnect|_accept_or_reject_agent_socket|record_agent_command_event|MockWebSocket|new WebSocket' apps/api apps/desktop/frontend scripts` → 活代码零命中。
- `git diff --check` → 通过。

**诚实边界 / 剩余项**：
- packaged smoke 是 headless 本地 sidecar 传输证据；SSE/REST、单实例与运行控制现已另有用户真机验收，仍不能替代权限四轨与 canon dossier 的剩余人工观感验收。
- 用户已明确确认壳子新 UI、SSE/REST、中文 IME、单实例与运行控制；A6 仍余 canon dossier 与权限四轨，A7 blocker 修复与 `v0.1.2` tag 仍未完成，Gate A→B 尚不能宣称通过。
- 未调用真实 provider/LLM，未做 3–5 万字长程质量验收或人工通读。

记录时间戳：2026-07-11 18:31:18 +08:00。

## 2026-07-11 Canon 场景约束修复后重打包与安装态复测

**范围与结论**：
- Canon 场景约束头保持确定性接线：`run_chat_loop` 从 `canon_context.build_scene_constraint_block(project_path, current_file)` 读取非空约束块，并以 system message 注入；无 Canon / 无约束时不增加消息。
- 清理 `loop_runtime.py` 三处尾随空白后，完整工作区 `git diff --check` 通过。
- A6 runsheet 5.3 已记 `N/A`：当前 ToolSpec/Registry 没有注册可联网工具，`network` 只是通用风险等级；不把无法触发的权限场景伪记为 PASS。5.1、5.2、5.4 仍保留未验状态。

**代码与契约验证**：
- `cd apps/api && uv run pytest tests/test_agent_canon.py -q` → **32 passed**。
- `cd apps/api && uv run pytest tests/test_agent_loop_runtime.py -q` → **19 passed**。
- `cd apps/api && uv run ruff check app/domains/agent_runs/canon_context.py app/domains/agent_runs/loop_runtime.py tests/test_agent_canon.py` → **All checks passed**。
- `pnpm.cmd e2e` → **20 passed / 0 failed**，OpenAPI / Agent frame 刷新后零漂移。

**新包与冻结 sidecar**：
- `pnpm.cmd desktop:build` → 通过；重新冻结 API sidecar，并产出 MSI / NSIS。
- 新 NSIS：`apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_0.1.2_x64-setup.exe`，大小 **51,959,290 bytes**，时间 **2026-07-11 21:06:50 +08:00**，SHA256=`23343DEE1EC641D250E74FABC5FC64A3FC3BF8BBE826C6AEC735626C6FBC5D6A`。
- `pnpm.cmd smoke:sidecar:packaged` → 通过：ready **4167ms**；assistant 会话 REST、Agent SSE **2 帧**、control REST、Alembic `managed=true`、prompt layer bundled 全绿，零 LLM / 零外网。

**覆盖安装与安装态证据**：
- 新 NSIS `/S` 静默覆盖安装 → `InstallerExitCode=0`；注册表 `StoryForge IDE / DisplayVersion=0.1.2`。
- 安装目录文件时间与本次构建一致：`storyforge-api.exe` 2026-07-11 21:04:20、`storyforge-desktop.exe` 2026-07-11 21:06:24。
- 从安装目录启动 Desktop 后 `/health/ready` → `status=ready / app_version=0.1.2 / db=ok`。
- 安装态日志：`sqlite_schema_ready head=20260703_0001 managed=True revision=20260703_0001`、`prompt_layer_bundled callable=True`；Agent SSE `POST /api/ide/agent/sessions/.../stream` 返回 200。
- 正常关闭 Desktop 后，Desktop 与 PyInstaller sidecar 父/子进程全部退出。

**总门禁例外与诚实边界**：
- `pnpm.cmd verify` 未全绿：Desktop **149 passed**；API **963 passed / 3 skipped / 1 failed**。唯一失败为 `tests/test_phase9_fact_sources.py::test_todo_records_current_phase9_next_actions`，旧断言要求当前未提交 `docs/internal/TODO.md` 的下一步段仍含“会话历史列表”，与用户已有的新路线文档变更不一致；本任务不擅自改写该无关未提交文档或护栏。
- 本轮证明 Canon 修复已进入新冻结 sidecar、完成覆盖安装并通过安装态 headless/日志检查；未执行 Canon dossier 4.1-4.3 或权限 5.1/5.2/5.4 的人工 GUI 观感，不宣称 A6 总门禁或 Gate A→B 已通过。

记录时间戳：2026-07-11 21:16:00 +08:00。

## 2026-07-11 A6 Canon GUI 复测即时 blocker 修复

- **长 Canon 结果弹窗被视口裁切**：共享 `AppDialogHost` 增加视口最大高度、消息区内部滚动/长路径换行与固定操作区；小窗口下标题和按钮不再被顶出。新增长消息布局回归。
- **Canon 派生目录生成但 GUI 树不刷新**：磁盘实证 `D:\test\.storyforge\canon\derived\dossier.md`、`presence.json`、`report.json` 均已生成；`canon.refresh` 成功后新增 `projectRefreshVersion` 递增，驱动 StoryNavigator / ResourceExplorer 重拉。
- **未编辑切文件却反复弹“放弃未保存修改”**：根因是程序性加载的第二次 Monaco `setValue(loadedContent)` 触发 change listener，更新 clean version 后未把 dirty state 清回 false。现于同一 effect 在 clean version 更新后 `setIsDirty(false)`；真实用户编辑仍按 alternative version 差异标脏。
- 前端全量最高记录 **26 files / 152 tests passed**；typecheck 通过；受影响 ESLint 0 error / 0 warning；本轮五个前端文件定向 `git diff --check` 通过。完整工作区随后因并行出现的 `project.hooks_delta` / golden 等 API 改动带 CRLF 尾随空白而转红，本轮未覆盖该并行工作。
- 最终覆盖安装 NSIS SHA256=`C88C32ACC1BC346BAB4CDEC4D16EC722299543717FD17B22BC059C9436CCB9E4`，安装器退出码 0，构建时间 2026-07-11 21:56:08 +08:00。
- 边界：本轮消除“加载即 dirty”的假守卫；真正未保存的文件切换仍受单 buffer 防丢稿确认保护。VS Code 式多文件 dirty model / hot-exit 尚未实现，不宣称等价。

记录时间戳：2026-07-11 21:57:00 +08:00。

## 2026-07-11 Canon GUI 同类缺陷审计收口

- 项目文件可见性下沉 `lib/project/entry-visibility.ts`：ResourceExplorer 与 `Ctrl+P` 共用规则，均公开 `.storyforge/canon/**` 的 Markdown 事实卡，并继续隐藏 versions / author-loop 等内部制品；Agent context index 仍排除所有 `.storyforge` 派生缓存，避免重复灌入上下文。
- CommandPalette 增加视口最大高度与内部结果滚动，矮窗口不再因固定 `pt-24 + max-h-80` 把底部内容裁出视口。
- 前端 **27 files / 154 tests passed**，typecheck 与受影响 lint 通过。
- 覆盖安装 NSIS SHA256=`36D3138CD9A5BBDDEE0EC413F334E41356E4B9FCB55538EA4415DF6CD11C9423`，安装器退出码 0。
- VS Code 式多文件 dirty model / hot-exit 仍是独立结构任务；本轮不以删除防丢稿确认冒充完成。

记录时间戳：2026-07-11 22:31:30 +08:00。

## 2026-07-11 Desktop 小缺陷全量修复与最终安装态复测

**修复范围**：
- 闭合 `.codex/desktop-small-bug-audit-2026-07-11.md` 的 14 个 P1/P2 确认缺陷；侧栏搜索、真实 observation store、剧情分支画布 3 个明确未接线能力仍不冒充回归修复。
- 文件编辑改为 VS Code 式多标签内存模型：按路径保留 Monaco model、undo/redo、光标与 view state；切文件不确认，脏预览首次编辑自动固定，关闭脏标签/切项目才确认，设置页只隐藏不卸载 Editor。
- 修复保存/加载竞态：加载中新文件先 detach 旧 model 并只读；保存捕获 root/path/model/content/branch，完成时以 cache/model/path token 提交；关闭已 dispose 标签后晚到保存不重加 dirty；全局 flush 事件通过 ref 使用最新保存闭包。
- Canon 边界明确：过滤文件树空根节点，扩展名大小写不敏感，`canon.json` 可见可编辑，`.storyforge/canon/derived/**` 只读，刷新前 flush 当前脏稿、成功后失效目录缓存并刷新树。
- 错误/不可用/空态分离：sidecar 连接失败、观测未接线、Ctrl+P 目录失败、Agent 上下文索引失败、历史会话失败、欢迎页 Provider/模型保存失败均不再伪装成成功空态；相关入口提供重试或回滚提示。Alert/Confirm/Prompt 统一支持 Escape。

**Frontend 门禁**：
- `npm --prefix apps/desktop/frontend run test -- --run` -> **33 files / 177 tests passed**。
- `npm --prefix apps/desktop/frontend run typecheck` -> 通过。
- `pnpm.cmd lint` -> 通过，0 error；仅保留既有 `Editor.tsx` `handleExport` exhaustive-deps warning。
- `git diff --check -- apps/desktop/frontend` -> 通过。
- 独立 Phase 2.2 reviewer 额外发现并修复最新保存闭包与历史会话 A/B 内容归属两个问题，定向测试后并入上述全量门禁。

**重打包与冻结 sidecar**：
- `pnpm.cmd desktop:build` -> 通过；Vite production build、PyInstaller sidecar、Rust release、MSI/NSIS 均成功。
- NSIS：`apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_0.1.2_x64-setup.exe`，大小 **51,971,981 bytes**，构建时间 **2026-07-11 23:53:28 +08:00**，SHA256=`B227A391125A64DFF4488522508EAA9BC8F0A6D9F77C96ECE43618412784B3DD`。
- `pnpm.cmd smoke:sidecar:packaged` -> 通过：ready **5748ms**；assistant REST、Agent SSE **2 帧**、control REST、Alembic `managed=true`、prompt layer bundled 全绿，零 LLM / 零外网。

**覆盖安装与安装态证据**：
- NSIS `/S` 静默覆盖安装 -> `InstallerExitCode=0`；注册表 `StoryForge IDE / DisplayVersion=0.1.2`。
- 安装目录 `storyforge-desktop.exe` 时间 **2026-07-11 23:52:58**；从安装目录启动后 `/health/ready` -> `ready / app_version=0.1.2 / db=ok`。
- 安装实例 Agent SSE 确定性空消息复测 -> `agent_run_started + error` 两帧；未调用 provider、未出网。
- 安装库只读核对：Alembic revision=`20260703_0001`，`assistant_sessions=7`、`assistant_messages=72`、`agent_runs=42`，存量记录可读。
- 正常关闭 Desktop 后 `StoryForgeProcessesAfterClose=0`，Desktop 与 PyInstaller sidecar 父/子进程全部退出。

**diff-check 例外与诚实边界**：
- 完整工作区 `git diff --check` 当前仍被并行中的 `apps/api/app/domains/agent_runs/loop_runtime.py` 与 `apps/api/tests/fixtures/loop_tool_schemas_golden.json` CRLF 尾随空白阻断；这些文件含用户/并行 API 工作，本轮未覆盖或格式化。Desktop 任务范围的 diff-check 已通过。
- 本轮自动化与安装态 headless 证据不等于真机 GUI 人工观感；未执行真实 provider、3-5 万字长程质量或人工通读，也不宣称 3 个已知未接线能力完成。

记录时间戳：2026-07-11 23:58:34 +08:00。

## 2026-07-12 Phase A A7 修复锁版与 v0.1.2

**A6 / A7 判定**：
- 用户确认 A6 全项完成；runsheet 第 4 组 Canon dossier、第 5 组权限四轨已回填，5.3 保持 `N/A`，A6 总判定 **PASS**，无未修 blocker。
- A7 复核覆盖本轮 Canon 场景约束、hooks delta、Desktop 多标签编辑与错误态修复；新 Canon hooks 代码的 3 个 ruff 阻断已做零行为清理。
- Git 对仓库既有 CRLF 文件启用 `core.whitespace=cr-at-eol` 后，完整 `git diff --check` 通过；没有改写 golden 行尾或制造整文件换行 diff。

**最终锁版门禁**：
- Canon/loop/tool schema/role 聚焦组合：**92 passed**；相关 ruff 全绿。
- `tests/test_phase9_fact_sources.py`：**14 passed**，TODO/current-phase/编辑器优先计划已切到 Phase B 事实。
- `pnpm.cmd verify`：通过；Desktop **177 passed**，API **980 passed / 3 skipped**，Workflow **323 passed**，shared/typecheck、API/Workflow ruff、daily sidecar、OpenAPI drift 全绿。lint 仅保留既有 `Editor.tsx` exhaustive-deps warning。
- `pnpm.cmd e2e`：**20 passed / 0 failed**，OpenAPI 刷新后无漂移。

**最终源码对应制品**：
- `pnpm.cmd desktop:build`：从最终 API/Desktop 源码重新冻结 sidecar 并生成 MSI/NSIS。
- NSIS：`apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_0.1.2_x64-setup.exe`，大小 **51,969,989 bytes**，时间 **2026-07-12 03:07:04 +08:00**，SHA256=`320C4BD6BACB03B7D14A302A1F1445470C1CBFAE415F18A245BD747A175B41B7`。
- `pnpm.cmd smoke:sidecar:packaged`：通过；ready **6758ms**，assistant REST、Agent SSE 2 帧、control REST、Alembic managed=true、prompt layer bundled 全绿，零 LLM / 零外网。

**最终覆盖安装复测**：
- 安装前检测到既有 StoryForge 进程，先正常关闭并确认父子进程为 0；随后 NSIS `/S` 覆盖安装退出码 `0`，注册表 `DisplayVersion=0.1.2`。
- 安装目录启动后 `/health/ready` -> `ready / app_version=0.1.2 / db=ok`；安装实例 SSE `installed-lock-v012` 返回 `agent_run_started + error` 两帧。
- Alembic revision=`20260703_0001`；`assistant_sessions=7`、`assistant_messages=72`、`agent_runs=42`，存量记录可读。
- 正常关闭后 `StoryForgeProcessesAfterClose=0`。

**锁版结果**：
- 轻量 tag `v0.1.2` 指向本轮最终锁版提交；不 push、不创建 PR。
- Gate A->B 通过；下一步进入 Phase B 的 S3 手稿保险与 n=1 连载接续。

记录时间戳：2026-07-12 03:10:55 +08:00。

## 2026-07-12 UIUX 九问 · 速赢包（对齐 v2 壳子原型）

**范围**：`StoryForge壳子原型-整端-v2.html` 九问优化第一刀，纯前端壳子，零后端/契约变更。分支 `feat/uiux-quick-wins-20260712`（基于 `chore/retire-ws-server-20260711`）。

**改动**：
- Q2 滚动条：`index.css` 细滚条改 hover-only（thumb 平时透明，`:hover` 容器或 `.scrolling` 才现）；`App.tsx` 补捕获式 scroll effect 给滚动容器挂 `.scrolling`（700ms 衰减）；`useMonacoEditor` 加 `scrollbar { useShadows:false }`。
- Q7 顶栏：`Titlebar.tsx` 删 `projectName` prop 与渲染，`App.tsx` 不再传 `activeProject`——顶栏不再露 `D:\test` 裸路径，项目名唯一入口留左栏切换器。
- Q9 格字对齐：`options.ts` 新增 `STORYFORGE_EDITOR_FONT_GRID`（CJK 2:1 等宽栈，monospace 兜底），`useMonacoEditor` 设 `fontFamily` + `minimap { enabled:false }`。
- Q6 键位：审计确认现状不吞 Ctrl+C/A/V/X/Z/F（仅接管 S/P/B/,/Shift 组合），本刀不动键位。

**未联通/留后续**：Q9 双轨散文字体切换与内置开源字体打包（改 Tauri 构建 + `AppSettings`）；`.scrolling` 真机滚轮观感归 E2E-1；键位 Ctrl+W/Tab 随去重刀补。

**门禁**：
- `npm --prefix apps/desktop/frontend run typecheck`：绿。
- `npm --prefix apps/desktop/frontend run test`：**178 passed / 33 files**（含新增 Q9 字体栈守卫）。
- 变更文件 `prettier --check` 与 `eslint`：绿。
- `node scripts/check-openapi-drift.mjs`：无漂移（纯前端，契约未动，重生成幂等）。

**诚实边界**：自动化/单测证据不等于真机 GUI 人工观感；hover 滚动条、CJK 对齐（依赖本机/装机字体）、顶栏观感均待真机第二轮观感波核验。

记录时间戳：2026-07-12（速赢包）。

## 2026-07-12 UIUX 九问 · 去重包（对齐 v2 壳子原型）

**范围**：九问优化第二刀「去重包」，纯前端壳子，零后端/契约变更。分支 `feat/uiux-dedup-20260712`（stacked 于速赢包分支）。

**改动**：
- Q8 活动栏瘦身：`ActivityBar` 上排只留 文件 / 搜索，底部只留 设置；删会话（Sparkles）、质检（Flag）与命令面板（Command，与顶栏搜索框同功能）图标；`useShellState` 的 `SidePanelView` 收窄为 `explorer | search`；`App` 键位 viewMap 去掉 Ctrl+Shift+C/M。
- Q5 会话移位：会话历史从左栏活动栏移入右栏对话头下拉。`ChatWindow` 挂载即按项目 scoped 拉 `listAssistantSessions`（切换 / 新建后随 assistantSessionId 刷新），`ConversationHeader` 标题变会话切换下拉（列表 + 新建）；切换走既有 `onAssistantSessionChange`（switch 机制不变，只挪触发 UI），下拉内联 absolute 不 portal（token 在 :root 内）。`SidePanel` 的 SessionsView / QaView 退役。
- Q3b（最小）左栏去重：删掉重复的「故事」标签行，把 +新建文件 并进项目切换行；左栏头由三行降到两行。

**未联通/留后续**：Q3b 完整 VS Code 折叠分区堆叠（打开的编辑器 / 时间线 / 分区显隐菜单）；Q3a 编辑区单行（并入布局刀，与 Q4 编辑区 reopen-right 一次改到位）。

**门禁**：
- typecheck：绿。
- vitest：**179 passed / 33 files**（新增 Q8 活动栏精简守卫 + Q5 会话下拉守卫；chat-window-error-states 补 stub `listAssistantSessions` 避免打真端口）。
- 变更文件 prettier / eslint：绿。

**诚实边界**：自动化/单测不等于真机观感；会话下拉切换、右栏头下拉浮层、活动栏瘦身手感待真机核验。

记录时间戳：2026-07-12（去重包）。

## 2026-07-12 UIUX 九问 · Q4 布局三态（slice 3a 壳子第一刀）

**范围**：九问 Q4「编辑区/交互区各占满」，纯前端壳子，零后端/契约变更。分支 `feat/uiux-layout-modes-20260712`（stacked 于去重包分支）。用户拍板「先壳后行间对话、拆两 PR」：本刀是壳子部分的布局三态；行间对话（Ctrl+K，slice 3b）另开。

**改动**：
- `useShellState` 引入 `layoutMode`（editor / balanced / chat），`rightCollapsed` 由其派生（= editor），`toggleRight`/`showRight` 映射到布局态，新增 `setLayoutMode`。
- editor：右栏隐藏、编辑占满；balanced：编辑 + 384 右栏（现状默认）；chat：编辑区隐藏、右栏经 `AssistantPanelFrame` `wide` 占满中右（ChatWindow 内部 max-w-800 居中）。ChatWindow 始终挂载于右栏、只改宽度，切布局不丢会话 / 在飞 run。
- 就地控件：`ConversationHeader` 平衡态给「对话占满 Ctrl+3 / 收起编辑占满 Ctrl+1」，对话态给「回到编辑 Ctrl+2」；顶栏收起键仍在 编辑↔平衡 间切。Ctrl+1/2/3 键位（守卫 projectOpen）；root 加 `data-layout-focus`。

**留后续**：Q1 欢迎「发送即开书」（要定默认书库目录 + 文件系统建骨架，有产品决策）与 Q3a 编辑区单行（Editor.tsx 手术，从去重包挪来）待用户拍板；行间对话 = slice 3b。

**门禁**：typecheck 绿、vitest **180 passed / 33 files**（+布局态默认守卫 + 对话头三态控件守卫 + AssistantPanelFrame 宽度护栏更新）、prettier / eslint 绿。

**诚实边界**：自动化/单测不等于真机观感；三态切换手感、chat 占满居中比例、Ctrl+1/2/3、就地控件均待真机核验。

记录时间戳：2026-07-12（Q4 布局三态）。

## 2026-07-13 UIUX 九问 · Q1 发送即开书（slice 3a 壳子第二刀）

**范围**：Q1 欢迎页「发送即开书」，纯前端壳子 + Tauri 文件系统建骨架，零后端/契约变更。分支 `feat/uiux-welcome-newbook-20260713`（stacked 于 Q4 布局三态分支）。

**改动**：
- `lib/project/initialize.ts` 新增 `deriveNewBookName`（首行 + 剔文件系统非法字符 + 截断 16 + 空回落「未命名新书」）与 `createNewBookProject`（`<文档>/StoryForge/<书名>` 建项目骨架 `initializeStoryProject` + 首句灵感落 `灵感.md`，返回项目路径 + 种子文件路径；书名撞名自动 `-N` 让路）。
- `App.tsx` `handleWelcomeSend` 从「记 prompt → 弹目录框」改为「建骨架 → 原地打开 灵感.md → ChatWindow 自动发首句」；建骨架失败（非 Tauri / 权限 / 路径）优雅回落到手选目录老路径，不无声吞错。
- 写回红线不破：建骨架是显式开书动作产物，正文写回仍走 proposed patch；目录以后可迁。

**门禁**：typecheck 绿、vitest **181 passed / 34 files**（+`deriveNewBookName` 纯推导守卫）、prettier / eslint 绿。

**诚实边界**：文件系统编排（documentDir / createDir / writeFile）依赖 Tauri，vitest 里不跑、只固化纯推导；发送即开书真机首刷、默认目录落位、撞名让路、失败回落均待真机核验。

记录时间戳：2026-07-13（Q1 发送即开书）。

## 2026-07-13 UIUX 九问 · Q3a 第一步（编辑区去重文件名）

**范围**：Q3a「编辑区两行合一」的**安全第一步**——删掉编辑区工具行里与页签行重复的文件名 + 未保存点（complaint #3a「文件名出现两次」的字面修复）。分支 `feat/uiux-editor-onebar-20260713`（stacked 于 Q1 分支）。

**改动**：`Editor.tsx` 工具行删 `sf-topbar-title` 文件名 span + dirty 圆点（页签行已展示文件名 + 未保存态）。零测试 / 零 e2e 变更。

**留后续（完整 Q3a 单行合并）**：把导出/历史/保存/关闭其他/关闭全部收进 EditorTabs 的「…」溢出菜单 + 删整条 Editor 工具行 = 一条更大的中枢组件（Editor.tsx）手术。已核实 `tests/e2e/ide-judge-repair.spec.ts` 不点这些按钮（e2e 不阻塞），只需改 `editor.test.tsx` 工具栏单测 + 加 EditorTabs 菜单单测 + 加历史 toggle 事件。因是中枢重构，留作专门一刀待拍板。

**门禁**：typecheck 绿、vitest **181 passed / 34 files**、prettier 绿、eslint 仅既有 `Editor.tsx` exhaustive-deps warning（非本刀引入）。

记录时间戳：2026-07-13（Q3a 第一步）。
