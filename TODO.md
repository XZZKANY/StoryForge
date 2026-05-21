# StoryForge 当前 TODO

## 上线阻断

- 配置真实 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL` 与 `STORYFORGE_LLM_MODEL`，完成端到端生成验收。
- 为生产环境设置 `STORYFORGE_API_KEY`，禁止使用默认开发密钥。
- 将 workflow checkpoint 从内存迁移到 PostgreSQL 或 Redis，确保进程重启后可恢复。

## 下一步整改

- 将 Studio 已拆出的 `actions.tsx` 继续细分到 `types.ts`、`api.ts`、`validators.ts`。
- 用 OpenAPI 生成替换 `packages/shared/src/index.ts` 中的手写共享类型。
- 为 Judge LLM 响应增加更多结构化样例测试，覆盖时间线与人物关系冲突。

## 本地验证

- `pnpm run test:web`
- `pnpm run test:api`
- `pnpm run test:workflow`
- `pnpm run test`
- `pnpm run verify`
