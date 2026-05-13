# Phase 1 OpenAPI 闭环审查

生成时间：2026-05-13 11:55:00 +08:00

## 审查范围

本审查基于 `packages/shared/src/contracts/storyforge.openapi.json`，用于确认 StoryForge 第一阶段闭环所需 API 已暴露给前端和本地契约测试。当前仓库没有 Playwright 依赖，且既有前端测试采用 Node 原生测试执行契约检查，因此 Task 9 采用 Node/TypeScript 契约式 e2e，避免为闭环验收新增浏览器重依赖。

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

- 创建作品、章节和场景目前由 API 测试夹具直接写入 `Book`、`Chapter`、`Scene` 模型，作为本地契约式 e2e 的稳定前置状态。
- 角色资产和风格资产通过资产模型与 `/api/assets` OpenAPI 契约共同验证，`Scene Packet` 测试证明这些资产会进入上下文包。
- Judge 与 Repair 端点均在 OpenAPI 中暴露，并由 `apps/api/tests/test_judge_repair.py` 验证结构化问题单和定向修复补丁。
- 批准回写由 `apps/api/tests/test_approval_writeback.py` 验证最终正文、资产谱系、差异资产、证据链接和连续性记录。
- 下一章继承由 `apps/api/tests/test_scene_packet.py` 验证批准产生的 `next_chapter_constraints` 会进入后续 Scene Packet 的“必须包含事实”。
- 导出链路由 `apps/api/tests/test_exports.py` 验证 Markdown 与 EPUB 只包含已批准内容，并按章节和场景序号排序。

## 风险与后续

- OpenAPI 对 FastAPI 原始 `Response` 导出端点的媒体类型描述仍较弱，目前通过 API 测试验证真实 `content-type`；后续可补充 `responses` 元数据提升契约表达。
- 当前闭环 e2e 是契约式本地验收，不启动浏览器；如后续引入 Playwright，应保留本测试作为快速回归，再补充真实页面流程。