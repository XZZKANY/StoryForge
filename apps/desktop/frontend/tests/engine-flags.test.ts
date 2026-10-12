import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readEngineMode } from '../src/lib/engine/flags';

const keys = ['engine.ideCommands', 'engine.assistant', 'engine.agentLoop'] as const;

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('DEV', true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
});

it.each(keys)('%s defaults to Python and accepts only exact experimental modes', (key) => {
  expect(readEngineMode(key)).toBe('python');
  for (const value of ['python', '', 'TS', 'true', 'null', ' ts', 'shadow ']) {
    localStorage.setItem(key, value);
    expect(readEngineMode(key)).toBe('python');
  }
  for (const value of ['ts', 'shadow'] as const) {
    localStorage.setItem(key, value);
    expect(readEngineMode(key)).toBe(value);
  }
});

it('reads preferences per request without changing a previously selected mode', () => {
  localStorage.setItem(keys[0], 'shadow');
  const selected = readEngineMode(keys[0]);
  localStorage.setItem(keys[0], 'ts');
  expect(readEngineMode(keys[0])).toBe('ts');
  expect(selected).toBe('shadow');
  expect(readEngineMode(keys[1])).toBe('python');
});

it('production ignores stale experimental preferences without accessing storage', () => {
  for (const key of keys) localStorage.setItem(key, 'ts');
  vi.stubEnv('DEV', false);
  const read = vi.spyOn(Storage.prototype, 'getItem');
  for (const key of keys) expect(readEngineMode(key)).toBe('python');
  expect(read).not.toHaveBeenCalled();
});

it('unavailable storage falls back only at preference selection', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('controlled denied storage', 'SecurityError');
  });
  for (const key of keys) expect(readEngineMode(key)).toBe('python');
});

it('an unknown runtime key cannot activate an engine capability', () => {
  localStorage.setItem('engine.future', 'ts');
  const read = vi.spyOn(Storage.prototype, 'getItem');
  expect(Reflect.apply(readEngineMode, undefined, ['engine.future'])).toBe('python');
  expect(read).not.toHaveBeenCalled();
});
