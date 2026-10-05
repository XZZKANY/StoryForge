import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const verifier = resolve('../../../scripts/verify-local.mjs');

function executeVerifier(outcome: 'success' | 'failed' | 'unavailable') {
  // Execute the real public ESM entry. The preload intercepts only child gate
  // dispatch, so this test never launches API/provider/native tasks.
  const preload = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.spawnSync = (command, args, options) => {
      console.log('GATE_CALL:' + JSON.stringify({ command, args, cwd: options.cwd }));
      if (args.includes('verify:inline-continuation')) {
        if (${JSON.stringify(outcome)} === 'failed') return { status: 7 };
        if (${JSON.stringify(outcome)} === 'unavailable') return { error: new Error('controlled unavailable gate') };
      }
      return { status: 0 };
    };
    syncBuiltinESMExports();
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, verifier],
    { encoding: 'utf8', windowsHide: true },
  );
  expect(result.error).toBeUndefined();
  const calls: { command: string; args: string[]; cwd: string }[] = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('GATE_CALL:'))
    .map((line) => JSON.parse(line.slice('GATE_CALL:'.length)));
  return { result, calls };
}

it('local verifier runs the durable browser gate between frontend units and API without removing other gates', () => {
  const { result, calls } = executeVerifier('success');
  expect(result.status).toBe(0);
  const units = calls.findIndex(
    (call) => call.args.join(' ') === '--prefix apps/desktop/frontend run test',
  );
  const browser = calls.findIndex((call) => call.args.includes('verify:inline-continuation'));
  const api = calls.findIndex((call) => call.args.join(' ') === 'run pytest');
  expect(units).toBeGreaterThanOrEqual(0);
  expect(browser).toBe(units + 1);
  expect(api).toBe(browser + 1);
  for (const args of [
    'run lint',
    '--prefix apps/desktop/frontend run typecheck',
    '--filter @storyforge/shared test',
    '--filter @storyforge/project-core test',
    'run ruff check .',
    'scripts/sidecar-smoke.mjs',
    'scripts/check-openapi-drift.mjs',
  ])
    expect(calls.some((call) => call.args.join(' ') === args)).toBe(true);
});

it.each(['failed', 'unavailable'] as const)(
  'a %s browser gate stops local verification rather than silently skipping it',
  (outcome) => {
    const { result, calls } = executeVerifier(outcome);
    expect(result.status).toBe(outcome === 'failed' ? 7 : 1);
    expect(calls.at(-1)?.args).toContain('verify:inline-continuation');
    expect(calls.some((call) => call.args.join(' ') === 'run pytest')).toBe(false);
    expect(result.stdout).not.toContain('所有本地核心门禁通过');
  },
);

it('frontend and full Desktop commands both register the same repository verifier', () => {
  const frontend = JSON.parse(readFileSync('package.json', 'utf8'));
  const desktop = JSON.parse(readFileSync('../package.json', 'utf8'));
  expect(frontend.scripts['verify:inline-continuation']).toBe(
    'node scripts/verify-inline-continuation.mjs',
  );
  expect(desktop.scripts.verify.split(' && ')).toContain(
    'npm --prefix frontend run verify:inline-continuation',
  );
});
