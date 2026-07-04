import { defineConfig } from 'vitest/config';

// W7 前端行为测试基建：vitest + happy-dom。
// 只接管新增的 *.vitest.ts 行为测试；既有 tests/**/*.test.ts 仍由 scripts/verify-unit.mjs
// （node:test）承载，待后续 PR 周期整体迁入 vitest 后再删自制 runner。
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/behavior/**/*.vitest.ts'],
    globals: false,
  },
});
