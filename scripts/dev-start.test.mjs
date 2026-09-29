import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// Run the real CLI in an isolated Node process; replace only process-launch
// boundaries so these tests never start services, migrate a DB, or open sockets.
function runCli(args, missing = []) {
  const script = new URL('./dev-start.mjs', import.meta.url).href;
  const source = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const missing = ${JSON.stringify(missing)};
    const record = (kind, command, args) => console.log('CALL:' + JSON.stringify({kind, command, args}));
    childProcess.spawnSync = (command, args) => {
      record('sync', command, args);
      if (command === 'where' || command === 'which') {
        return { status: args[0] === 'pnpm' || missing.includes(args[0]) ? 1 : 0 };
      }
      return { status: 0 };
    };
    childProcess.spawn = (command, args) => {
      record('background', command, args);
      return { killed: false, on() { return this; }, kill() { this.killed = true; } };
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, 'scripts/dev-start.mjs', ...${JSON.stringify(args)}];
    await import(${JSON.stringify(script)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  const calls = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('CALL:'))
    .map((line) => JSON.parse(line.slice(5)));
  return { ...result, calls };
}

for (const alias of [[], ['--api-only']]) {
  test(`API-only maintenance needs uv, not pnpm (${alias.join(' ') || 'default'})`, () => {
    const result = runCli([...alias, '--skip-docker', '--skip-migrate']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.calls
        .filter((call) => call.command === 'where' || call.command === 'which')
        .map((call) => call.args[0]),
      ['uv'],
    );
    const children = result.calls.filter((call) => call.kind === 'background');
    assert.equal(children.length, 1);
    assert.equal(children[0].command, 'uv');
    assert.ok(
      children[0].args.includes(process.platform === 'win32' ? 'run_windows.py' : 'app.main:app'),
    );
  });
}

test('help does not probe or launch external tools', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--api-only/);
  assert.deepEqual(result.calls, []);
});

test('missing uv still rejects startup before any service launch', () => {
  const result = runCli(['--skip-docker', '--skip-migrate'], ['uv']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未找到 uv/);
  assert.equal(
    result.calls.some((call) => call.kind === 'background'),
    false,
  );
});

test('missing docker still rejects startup unless explicitly skipped', () => {
  const result = runCli(['--skip-migrate'], ['docker']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未找到 docker/);
  assert.equal(
    result.calls.some((call) => call.kind === 'background'),
    false,
  );
});

test('migration still runs before the API when not explicitly skipped', () => {
  const result = runCli(['--skip-docker']);
  assert.equal(result.status, 0, result.stderr);
  const migration = result.calls.findIndex((call) => call.kind === 'sync' && call.command === 'uv');
  const launch = result.calls.findIndex((call) => call.kind === 'background');
  assert.ok(migration >= 0 && migration < launch);
  assert.deepEqual(result.calls[migration].args, ['run', 'alembic', 'upgrade', 'head']);
});
