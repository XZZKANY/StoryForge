import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { nativeEngineDb, nativePythonDb } from '../src/lib/engine/db';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

it('sends selects and transactions to the Rust engine database commands', async () => {
  vi.mocked(invoke).mockResolvedValue([{ id: 1 }]);
  expect(await nativeEngineDb.select('SELECT id FROM t WHERE id = $1', [1])).toEqual([{ id: 1 }]);
  expect(invoke).toHaveBeenLastCalledWith('engine_db_select', {
    sql: 'SELECT id FROM t WHERE id = $1',
    params: [1],
  });
  await nativeEngineDb.select('SELECT 1');
  expect(invoke).toHaveBeenLastCalledWith('engine_db_select', { sql: 'SELECT 1', params: [] });
  await nativeEngineDb.transaction([
    { sql: 'INSERT INTO t (id, title) VALUES ($1, $2)', params: [2, null] },
    { sql: 'SELECT * FROM t' },
  ]);
  // Rust 侧拒绝不认识的键，缺省参数要补成空数组。
  expect(invoke).toHaveBeenLastCalledWith('engine_db_transaction', {
    steps: [
      { sql: 'INSERT INTO t (id, title) VALUES ($1, $2)', params: [2, null] },
      { sql: 'SELECT * FROM t', params: [] },
    ],
  });
});

it('turns the string rejections of Tauri commands into errors', async () => {
  vi.mocked(invoke).mockRejectedValue('FOREIGN KEY constraint failed');
  const error = await nativeEngineDb.transaction([{ sql: 'x' }]).catch((reason) => reason);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('FOREIGN KEY constraint failed');
  const original = new Error('boom');
  vi.mocked(invoke).mockRejectedValue(original);
  await expect(nativeEngineDb.select('x')).rejects.toBe(original);
});

it('asks the host to back the engine database up before an upgrade', async () => {
  vi.mocked(invoke).mockResolvedValue(null);
  await expect(nativeEngineDb.backup!(1, 2)).resolves.toBeUndefined();
  expect(invoke).toHaveBeenLastCalledWith('engine_db_backup', { fromVersion: 1, toVersion: 2 });
  vi.mocked(invoke).mockRejectedValue('备份引擎库失败：disk I/O error');
  await expect(nativeEngineDb.backup!(1, 2)).rejects.toThrow(
    new Error('备份引擎库失败：disk I/O error'),
  );
});

it('reads the Python database through the read-only snapshot command', async () => {
  vi.mocked(invoke).mockResolvedValue(null);
  const queries = ['SELECT 1', 'SELECT 2'];
  expect(await nativePythonDb.snapshot(queries)).toBeNull();
  expect(invoke).toHaveBeenLastCalledWith('engine_python_db_snapshot', { queries });
  vi.mocked(invoke).mockResolvedValue([[{ n: 1 }], []]);
  expect(await nativePythonDb.snapshot(queries)).toEqual([[{ n: 1 }], []]);
  vi.mocked(invoke).mockRejectedValue('attempt to write a readonly database');
  await expect(nativePythonDb.snapshot(queries)).rejects.toThrow(
    new Error('attempt to write a readonly database'),
  );
});
