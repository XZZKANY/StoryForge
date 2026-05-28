# P6 Artifact / Export Viewer 操作日志

生成时间：2026-05-28 05:33:22 +08:00

## 任务范围

- 主计划阶段：P6 — Artifact / Export Viewer。
- 目标：让制品在 IDE 内可预览、对比、追溯。
- API 改动：新增 GET /api/ide/artifacts/{artifact_id}/preview。
- 前端改动：新增 ArtifactViewer，并接入 BottomPanel activePanel="artifacts"。
- 退出标准：从制品反向跳转到 BookRun → ModelRun → Approve 全链路。

## 编码前检查

- 已查阅上下文摘要文件：.codex/context-summary-storyforge-vscode-ide-p6-artifacts.md。
- 已查阅执行计划：.codex/storyforge-vscode-ide-p6-artifacts-plan.md。
- 复用组件：
  - pps/api/app/domains/ide/service.py：沿用 IDE 聚合服务模式。
  - pps/api/app/domains/ide/router.py：沿用 /api/ide/* 路由注册模式。
  - pps/api/app/domains/ide/schemas.py：沿用 Pydantic 响应契约声明。
  - pps/web/components/ide/shell/BottomPanel.tsx：沿用底部面板分支接入方式。
  - pps/web/scripts/phase1-contract-test.mjs：沿用 node:test 测试聚合方式。
- 命名与文件组织：沿用 Ide* 后端 schema 命名、*Viewer.tsx 前端视图命名、	est_ide_*.py 与 ide-*.test.tsx 测试命名。
- 未重复造轮子证明：已检查 P4/P5 的 runs、commands、agent 相关 IDE 模式，P6 只补齐 artifact preview 与 trace 链路。

## TDD 记录

### RED

- 新增 pps/api/tests/test_ide_artifact_preview.py，先约束 artifact preview 响应结构、版本列表、下载摘要和 trace 链路。
- 新增 pps/web/tests/ide-artifact-viewer.test.tsx，先约束 markdown/EPUB 预览、空状态与 BottomPanel 接入。

### GREEN

- 后端新增 artifact preview schema、service 聚合逻辑与 router endpoint。
- 前端新增 ArtifactViewer 并接入 BottomPanel activePanel="artifacts"。
- 更新 pps/web/scripts/phase1-contract-test.mjs 纳入 P6 测试。
- 通过 pnpm openapi 更新共享 OpenAPI 契约。

## 本轮核验

- git status --short：确认工作树存在 P0-P6 相关大量未提交变更，未执行回滚或清理。
- Select-String -LiteralPath apps/api/app/domains/ide/schemas.py,apps/api/app/domains/ide/service.py,apps/api/app/domains/ide/router.py -Pattern '\?\?\?|\?\?' -Context 0,0：无输出，未发现连续问号编码残留。

## 本地验证命令与结果

1. pnpm --filter @storyforge/web test -- ide-artifact-viewer
   - 结果：4 passed。
2. cd apps/api; uv run pytest tests/test_ide_artifact_preview.py -q
   - 结果：3 passed。
3. pnpm openapi
   - 结果：已生成 packages/shared/src/contracts/storyforge.openapi.json。
4. pnpm --filter @storyforge/web test
   - 结果：98 passed。
5. pnpm --filter @storyforge/web lint
   - 结果：	sc --noEmit exit 0。
6. pnpm --filter @storyforge/shared test
   - 结果：	sc --noEmit exit 0。
7. cd apps/api; uv run pytest tests/test_ide_artifact_preview.py tests/test_artifacts.py tests/test_book_exporter.py tests/test_book_export_epub.py tests/test_ide_command_registry.py tests/test_ide_run_events.py -q
   - 结果：18 passed。
8. git diff --check
   - 结果：exit 0；仅输出既有 CRLF 换行提示，未发现空白错误。

## 编码后声明

### 1. 复用了以下既有组件

- pps/api/app/domains/ide/schemas.py：用于声明 IDE 聚合响应契约。
- pps/api/app/domains/ide/service.py：用于集中聚合数据库实体、payload 与追溯链接。
- pps/api/app/domains/ide/router.py：用于注册 IDE HTTP endpoint。
- pps/web/components/ide/shell/BottomPanel.tsx：用于接入 artifacts 底部面板。
- pps/web/scripts/phase1-contract-test.mjs：用于统一运行 Web 契约测试。

### 2. 遵循了以下项目约定

- 命名约定：后端沿用 IdeArtifactPreview*，前端沿用 ArtifactViewer，测试沿用 	est_ide_* 与 ide-*.test.tsx。
- 代码风格：后端沿用类型注解与小函数拆分，前端沿用函数组件、只读 props 与条件渲染分支。
- 文件组织：P6 代码仍保留在 IDE domain、IDE view、IDE shell 与现有测试目录内。

### 3. 对比了以下相似实现

- BookRunPanel：P6 复用底部面板入口和运行追溯展示思路，但针对 artifact preview 增加版本与下载摘要。
- ContextInspector：P6 复用聚合信息卡片式呈现方式，但数据源切换到制品和导出 payload。
- StoryMemoryExplorer：P6 复用空状态与列表详情分离模式，但展示对象改为 artifact 版本与 trace。

### 4. 风险和后续

- 对象存储签名 URL 未实现，当前只提供 payload/download 摘要。
- EPUB 不是完整阅读器，只展示 manifest 与摘要。
- trace 主要基于 artifact payload 与 lineage_key 提取，深层详情页可在后续阶段增强。

## 结论

P6 的 API、前端视图、BottomPanel 接入和 OpenAPI 契约均已通过本地自动化验证。主计划仍未完成，后续继续 P7：主题 / 多窗口 / 个性化。
