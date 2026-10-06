import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: root });

test('root lint excludes local evidence and agent scaffolding', async () => {
  for (const path of [
    'output/release/generated.js',
    '.trellis/tasks/history/source.ts',
    '.agents/skills/local/script.mjs',
  ]) {
    assert.equal(await eslint.isPathIgnored(resolve(root, path)), true, path);
  }
});

test('root lint retains source, release scripts and their rules', async () => {
  for (const path of [
    'eslint.config.mjs',
    'scripts/verify-local.mjs',
    'apps/desktop/frontend/src/App.tsx',
    'packages/shared/src/index.ts',
    'packages/project-core/src/index.ts',
    'apps/desktop/frontend/src/output/example.ts',
  ]) {
    assert.equal(await eslint.isPathIgnored(resolve(root, path)), false, path);
  }
  const [result] = await eslint.lintText('unknownReleaseGateFunction();', {
    filePath: resolve(root, 'scripts/verify-local.mjs'),
  });
  assert.ok(result.messages.some((message) => message.ruleId === 'no-undef'));
  const config = await eslint.calculateConfigForFile(
    resolve(root, 'apps/desktop/frontend/src/App.tsx'),
  );
  assert.equal(config.rules['react-hooks/rules-of-hooks'][0], 2);
});
