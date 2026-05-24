# StoryForge Code Review 验证报告

生成时间：2026-05-24 20:00:00

## 审查结论

建议：退回。

综合评分：70 / 100。

原因：当前工作区完整本地门禁 `pnpm test` 失败，API 全量测试存在 1 个回归失败，workflow 阶段未执行，不能按项目规则确认通过。

## 阻断问题

1. `apps/api/tests/test_scene_packet_retrieval_upgrade.py:87` 仍从 `app.domains.scene_packets.service` 导入 `_retrieval_context_blocks`。
2. `apps/api/app/domains/scene_packets/service.py` 在本次重构后不再导出该私有别名。
3. 实际实现位于 `apps/api/app/domains/scene_packets/retrieval_bridge.py` 的 `retrieval_context_blocks`。
4. 完整测试失败信息：`ImportError: cannot import name '_retrieval_context_blocks' from 'app.domains.scene_packets.service'`。

## 次要风险

- `apps/web/tests/phase1-navigation.test.tsx:107-123` 主要通过字符串包含验证 `StudioFlow`，无法证明步骤状态和滚动行为。
- `apps/web/app/studio/StudioFlow.tsx:63-70` 在初次水合且当前步骤不是首步时会触发 `scrollIntoView`，可能造成页面首次打开跳动。
- `apps/api/app/domains/worldbuilding/service.py:30-36` 对存在 `series_id` 但未知 `book_id` 的请求缺少明确测试或契约说明。

## 本地验证记录

- `pnpm --filter @storyforge/web test`：通过，9 个 Node 测试全部通过。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 无错误。
- `cd apps/api && uv run pytest tests/test_worldbuilding_center.py tests/test_api_surface.py tests/test_scene_packet.py`：通过，8 个测试全部通过。
- `pnpm test`：失败；Web 与 shared 阶段通过，API 阶段 147 passed / 1 failed，workflow 阶段未执行。

## 技术维度评分

- 代码质量：72 / 100。重构方向清晰，但破坏既有测试导入契约。
- 测试覆盖：62 / 100。完整门禁失败，且新增 Web 测试偏字符串验证。
- 规范遵循：76 / 100。目录和命名基本符合项目模式，但验证未闭环。

技术维度综合：70 / 100。

## 战略维度评分

- 需求匹配：68 / 100。目标功能方向匹配，但无法通过本地门禁。
- 架构一致：78 / 100。API 路由与服务层分离方式基本沿用既有模式。
- 风险评估：65 / 100。测试回归、客户端滚动体验和 worldbuilding 边界仍需处理。

战略维度综合：70 / 100。

## 需求字段完整性检查

- 目标：已覆盖，对当前工作区做 Code Review。
- 范围：已覆盖 API、Web、测试、验证脚本和当前 git diff。
- 交付物：已生成 `.codex/context-summary-code-review.md` 与本报告。
- 审查要点：已覆盖阻断问题、次要风险、评分和建议。
- 依赖与风险：已记录 Context7 查询结果、GitHub search_code 工具不可用限制、本地验证结果。

## 修复建议

1. 优先修复 `test_scene_packet_retrieval_upgrade.py` 的导入契约，推荐改为从 `retrieval_bridge` 导入 `retrieval_context_blocks`。
2. 重新执行 `cd apps/api && uv run pytest tests/test_scene_packet_retrieval_upgrade.py`。
3. 再执行仓库根目录 `pnpm test`，确保 workflow 阶段也被执行。
4. 对 `StudioFlow` 增加状态计算或滚动策略的行为级测试。
5. 明确 worldbuilding 对未知 `book_id` 的契约，并补充 404 或空结果测试。

## 最终建议

退回。修复阻断项并重新跑通 `pnpm test` 后，再进行下一轮复审。

## 复验更新 - 2026-05-24 20:10:00

### 已修复

- 修复 `apps/api/tests/test_scene_packet_retrieval_upgrade.py` 的旧私有导入契约。
- 测试现在直接导入 `app.domains.scene_packets.retrieval_bridge.retrieval_context_blocks`，与当前模块职责边界一致。

### 复验命令

- `cd apps/api && uv run pytest tests/test_scene_packet_retrieval_upgrade.py`：2 passed。
- `pnpm test`：通过。
  - Web：9 passed。
  - shared：`tsc --noEmit` 通过。
  - API：148 passed。
  - workflow：19 passed。

### 更新后判断

阻断性测试失败已解除。剩余风险仍包括 StudioFlow 行为级测试偏弱、初次滚动体验需确认、worldbuilding 未知 `book_id` 契约需补充说明或测试。
