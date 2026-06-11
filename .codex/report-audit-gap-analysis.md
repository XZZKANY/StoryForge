# StoryForge 深度评审报告 × 代码现状 核验报告

> 生成日期：2026-06-10
> 方法：对 `storyforge_deep_review_report.md` 的每条**技术主张**派 reader 读真实代码核验（7 维并行审计，168 次工具调用，约 55 万 token）。
> 结论一律带 `file:line` 证据。报告基于 GitHub 公开快照静态审查，本核验基于 `/d/StoryForge` 工作区真实代码。

---

## 0. 总判断

**外部报告的"工程叙事"批评（定位过满、根目录混乱、横向铺太宽）基本成立；但报告的多数"功能缺失"技术主张已被代码推翻或显著过时。** 报告把"公开快照看不到的东西"默认判为"没做"，实际很多已实现。

把每条技术主张归三类：

| 类别 | 数量 | 代表 |
|---|---|---|
| ❌ 报告误判（代码已实现） | 7 | Repair 已是片段级 / diff 视图已有 / BFF 已有 / JWT 已有 / provider fallback 已有 / 三层评测大体已有 / 生产默认凭据已有防护 |
| ⚠️ 部分实现（有缺口） | 多 | ModelRun 核心字段在但 6 个关键字段缺列 / token·cost 是估算非真实 usage / accept-reject UI 在但不持久化 |
| ✅ 真实缺口（值得做） | 见 §2 | 客户端 key 泄漏 / artifact 下载无鉴权 / 根目录卫生 / ModelRun 可观测列 / classify_error |

---

## 1. 报告说错的地方（避免照单全收）

| 报告主张 | 真实代码 | 证据 |
|---|---|---|
| Repair 是"章节级整章重写" | **已是片段级**。`RepairPatch` 只存 `target_span/replacement_text/span_start/span_end`，写回用 `content.replace(target_span, replacement, 1)` 切片替换，从不整章重写 | `apps/api/app/domains/repair/service.py:35,40`、`apps/api/app/domains/studio/service.py:672-680` |
| Studio 缺 diff 视图 | **已有** `RepairDiffViewer`（自研 LCS 行级 diff + 增删统计） | `apps/web/components/diff-viewer/RepairDiffViewer.tsx:24-68`、`apps/web/lib/text-diff.ts:71-113` |
| 缺 BFF | **已有**。`app/api/{workspaces,book-runs,provider-models}` Route Handler + Server Action 代理，真实 key 留服务端 | `apps/web/app/api/workspaces/route.ts:1`、`apps/web/app/studio/actions.tsx:1` |
| 缺 JWT | **已实现** HS256 双模认证（`create_access_token`/`verify_access_token`），但解析出的 role 未用于授权 | `apps/api/app/common/auth.py:37,56`、`apps/api/app/main.py:192-197` |
| 缺 provider fallback | **已有且完整**。`FallbackProviderAdapter` 主 provider 失败降级备用并记录 `fallback_metadata` | `apps/workflow/storyforge_workflow/runtime/provider_adapter.py:161-237` |
| 验证只证明"流程能跑" | **已有 deterministic 文学坏味道检查器** `prose_static_check.py`（套话/说明腔/对白密度/OOC/连续性/推进/节奏 10 维）+ judge 语义评审 + 文风指纹漂移 | `apps/workflow/storyforge_workflow/quality/prose_static_check.py:53-281`、`apps/api/app/domains/judge/service.py:274,394` |
| 缺黄金样例回归 | **已有** `tests/fixtures/quality_cases` 5 个 good/bad 用例带 `expected_decision/expected_issue_dimensions`，被测试消费 | `tests/fixtures/quality_cases/*.json`、`apps/workflow/tests/test_prose_static_check.py:8,30` |

> 建议：向报告作者反馈这些点——审查对象是过时/公开快照。

---

## 2. 真实缺口（按优先级 + 是否纯代码可解）

### P0 — 安全与卫生（纯代码可解，应尽快）

| # | 缺口 | 证据 | 工作量 |
|---|---|---|---|
| S1 | **客户端 API key 字面量泄漏**：`api-client.ts`/`command-client.ts` 无 `server-only` 守卫且硬编码 `defaultApiKey='local-dev-key'`，会被打进客户端 bundle。`JudgeRepairWorkbench`（`'use client'`）经 `command-client` 在浏览器执行 `apiFetch`，实际发送字面量 key | `apps/web/lib/api-client.ts:11,35`、`apps/web/components/ide/commands/command-client.ts:9`、`apps/web/components/ide/workflows/JudgeRepairWorkbench.tsx:1,109,145` | S+M |
| S2 | **artifact/export 下载无归属鉴权**：`GET /api/artifacts/{id}/download`、`GET /api/books/{id}/exports/{markdown,epub}` 只凭 id，任何合法凭据可拉任意制品 | `apps/api/app/domains/artifacts/router.py:89,94`、`apps/api/app/domains/exports/router.py:11,14` | M |
| H1 | **根目录内部痕迹已被 git 追踪**：4 个 `.codex-fix-phase9b-*.patch`（git diff 转储）、`.codex/` 下 691 个文件、`.claude/settings.local.json` 均 tracked | `git ls-files`（.codex=691）、`.gitignore` 未覆盖 | S |

### P1 — 可观测性 / Provider（纯代码可解）

| # | 缺口 | 证据 | 工作量 |
|---|---|---|---|
| O1 | **ModelRun 缺 6 个一等列**：`finish_reason`（采集到但落库前丢弃）、`prompt_template_version`、`prompt_hash`、`error_kind`（只有自由文本 error_message）、`retry_count`、`repair_count` 全无列；`input/output_tokens`、`cost`、`chapter_id`、`book_run_id` 只在 payload JSON 里、无独立列 | `apps/api/app/domains/model_runs/models.py:17-43`、`apps/workflow/storyforge_workflow/runtime/runner.py:365-396` | M |
| P3 | **token/cost 是估算非真实**：`_estimate_token_count=len//4`、`_estimate_cost` 硬编码价目表；`_post_chat_completion` 拿到完整响应体却丢弃 `usage` 字段 | `apps/workflow/storyforge_workflow/runtime/provider_adapter.py:106,415,429`、`provider_client.py:53` | S |
| P4 | **缺 classify_error**：只分"可重试(429/5xx)/不可重试"，无 context_length_exceeded / content_filter / auth 分类；不读 Retry-After | `apps/workflow/storyforge_workflow/provider_client.py:204`、`runtime/provider_adapter.py:438` | M |
| O2 | **BookRun 无 latency 聚合**：已聚合 token/cost，但无 latency 三件套补齐 | `apps/api/app/domains/book_runs/models.py:23-29`、`service.py:510-517` | S |

### P1/P2 — 体验与质量脚手架（纯代码可解）

| # | 缺口 | 证据 | 工作量 |
|---|---|---|---|
| U1 | **Studio 接受/拒绝是装饰态**：`JudgeIssueList` 有完整 UI 但未传 `onDecisionsChange`，决策只在本地 useState，从不回传后端——用户会误以为生效 | `apps/web/components/judge-panel/JudgeIssueList.tsx:33-251`、`apps/web/app/studio/page-content.tsx:277-289` | S（加标注）/ L（真持久化）|
| Q1 | **垃圾 stub fixtures**：`apps/workflow/tests/fixtures/quality_cases` 5 个 json 是乱码占位（draft 为一串 `?????`），与顶层真实 fixture 重名但无任何测试引用 | `apps/workflow/tests/fixtures/quality_cases/*.json` | S |
| Q2 | **缺结构化人工盲评 schema**：现有 `manual_read_gate` 只录通过/结论 markdown，无 reviewer_score 数值评分表 | `apps/api/app/domains/exports/book_markdown_exporter.py:320` | M |

### 非纯代码可解（需产品/法务决策或真实长跑/人工评测）

- README 定位重写、LICENSE 选型（文件可代码化，**许可证选择是你的决策**）
- Studio 升级为真正章节编辑器（需定后端契约：正文是否可编辑、issue 决策是否新增写回端点）
- streaming / generate_structured（功能性大改）、多候选、半章续写
- 真正多租户隔离（行级安全/独立 schema）
- **跑真实 LLM 3–5 万字长程 + 人工盲评**（脚手架已就绪，结论本质需真实模型 + 人）

---

## 3. 建议执行顺序

1. **P0 安全 + 卫生**（S1/S2/H1）：风险明确、纯代码、不需产品决策——优先。
2. **P1 可观测性**（O1/P3/O2）：ModelRun 加列 + 真实 usage + latency 聚合，一次 alembic 迁移搞定，刷新 OpenAPI。
3. **P1 Provider**（P4 classify_error）。
4. **清理**（Q1 删 stub、U1 标注装饰态 UI）。
5. 其余（README/LICENSE/Studio 编辑器/长跑/盲评）需你拍板，不擅自动。

---

## 4. 已核验但**无需动**的清单（防止过度修改）

Repair 片段级、diff 视图、BFF、JWT、provider fallback、三层评测、黄金样例回归、生产默认凭据防护——这些报告点名"缺失"的能力代码里都有，**不要重复造**。
