import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// W7 前端测试统一由 vitest + happy-dom 执行。
export default defineConfig({
  resolve: {
    alias: {
      'monaco-editor': fileURLToPath(new URL('./tests/stubs/monaco-editor.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.{ts,tsx}', 'tests/**/*.vitest.ts'],
    globals: false,
  },
});
