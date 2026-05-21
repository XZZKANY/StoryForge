# StoryForge 待办清单

## 环境配置

- 配置 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL` 与 `STORYFORGE_LLM_MODEL`，供本地 workflow 和 Judge 使用真实模型。
- 按部署环境设置 `STORYFORGE_API_KEY`，确保前端 Server Component 与 API 使用同一访问密钥。
- 为 workflow checkpoint 配置 `STORYFORGE_WORKFLOW_SQLITE_PATH`，必要时后续迁移到官方 PostgreSQL 或 Redis saver。

## 后续改进

- 持续收敛 Studio 页面模块边界，确保 `actions.tsx` 只保留 Server Action。
- 在生成 OpenAPI 后同步更新 `packages/shared/src/index.ts` 的客户端类型。
- 评估 Judge LLM provider 的生产观测字段，补充模型失败率和 fallback 命中率统计。

## 本地验证

- `pnpm run test:web`
- `pnpm run test:api`
- `pnpm run test:workflow`
- `pnpm run test`
- `pnpm run verify`
