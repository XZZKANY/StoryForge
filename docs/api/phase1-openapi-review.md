# Phase 1 OpenAPI 闭环审查

生成时间：2026-05-13 00:00:00 +08:00

## 审查范围

本审查基于 `packages/shared/src/contracts/storyforge.openapi.json`、`tests/e2e/phase1-closed-loop.spec.ts` 和 `apps/api/tests/test_phase1_closed_loop_api.py`。Task 9 规格修复后，`pnpm e2e` 不再只做静态字符串契约检查，而是执行“Node/TypeScript OpenAPI 契约检查 + FastAPI TestClient 真实 API 闭环 pytest”。

## 关键端点与用途

| 能力 | 端点 | 用途 |
| --- | --- | --- |
| 资产 | `POST /api/assets` | 创建角色、风格规则、伏笔等资产首个版本，为生成章节提供真相源。 |
| 资产 | `GET /api/assets` | 查询作品下每条资产谱系的最新版本，供前端资产中心和组包流程使用。 |
| 资产 | `PATCH /api/assets/{asset_id}` | 更新资产并形成新版本，保留历史谱系。 |
| 资产 | `GET /api/assets/{asset_id}/history` | 查看单条资产谱系历史，支撑差异审计。 |
| 连续性 | `POST /api/continuity/chapter-approval` | 用户批准章节后写入上一章摘要、角色状态、伏笔变化、风格漂移和下一章约束。 |
| Scene Packet | `POST /api/scene-packets` | 为章节首个场景组装固定槽位上下文、证据链接和预算统计。 |
| Judge | `POST /api/judge/issues` | 对章节片段输出结构化问题单，包含严重级别、命中片段、证据和建议修复方式。 |
| Repair | `POST /api/repair/patches` | 根据问题单生成定向修复补丁，只描述命中片段与替换文本。 |
| Exports | `GET /api/books/{book_id}/exports/markdown` | 导出已批准章节和场景正文为 Markdown。 |
| Exports | `GET /api/books/{book_id}/exports/epub` | 导出已批准章节和场景正文为最小 EPUB zip。 |

## 闭环覆盖结论

- `tests/e2e/phase1-closed-loop.spec.ts` 只负责 OpenAPI 与测试证据契约检查，避免再声称静态检查等同完整闭环。
- `apps/api/tests/test_phase1_closed_loop_api.py` 使用 FastAPI `TestClient` 和 SQLite 内存库执行真实 HTTP API 链路。
- 作品、章节和场景因当前缺少创建路由，按规格由测试夹具直接写入 `Book`、`Chapter`、`Scene`。
- 角色资产和风格资产通过 `POST /api/assets` 创建，并进入 `POST /api/scene-packets` 生成的上下文包。
- 连续性通过 `POST /api/continuity/chapter-approval` 写入，下一章继承通过后续 `POST /api/scene-packets` 验证。
- Judge 与 Repair 通过 `POST /api/judge/issues` 和 `POST /api/repair/patches` 生成结构化问题单和定向补丁。
- 批准回写当前无 HTTP 路由，测试显式调用 `approve_chapter_writeback` 服务，并在测试名中标注这是 Phase 1 回写服务边界。
- Markdown 与 EPUB 导出通过真实 `GET /api/books/{book_id}/exports/markdown` 和 `GET /api/books/{book_id}/exports/epub` 验证。

## 验证记录

- `uv run pytest tests/test_phase1_closed_loop_api.py -q`：通过，`1 passed`。
- `pnpm e2e`：由 `scripts/run-e2e.mjs` 先执行 Node 契约检查，再进入 `apps/api` 执行上述 pytest。

## 风险与后续

- OpenAPI 对 FastAPI 原始 `Response` 导出端点的媒体类型描述仍较弱，目前通过真实 API 测试验证响应头；后续可补充 `responses` 元数据提升契约表达。
- 批准回写缺少 HTTP 路由，当前验收明确落在服务层边界；后续新增路由时应把 pytest 中的服务调用替换为 HTTP API 调用。
