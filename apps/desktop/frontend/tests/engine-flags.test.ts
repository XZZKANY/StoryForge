import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readEngineMode, type EngineMode } from '../src/lib/engine/flags';

const keys = ['engine.ideCommands', 'engine.assistant', 'engine.agentLoop'] as const;
const devDefaults: [(typeof keys)[number], EngineMode][] = [
  ['engine.ideCommands', 'python'],
  ['engine.assistant', 'ts'],
  ['engine.agentLoop', 'python'],
];

// happy-dom 下同一文件里第二次 spyOn(Storage.prototype, 'getItem') 拦不到调用，断言会空转；
// 换掉整个 localStorage 才可靠。
function stubStorage(getItem: (key: string) => string | null) {
  const read = vi.fn(getItem);
  vi.stubGlobal('localStorage', { getItem: read });
  return read;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('DEV', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

it.each(devDefaults)('%s defaults to %s in dev and accepts only exact modes', (key, fallback) => {
  expect(readEngineMode(key)).toBe(fallback);
  for (const value of ['', 'TS', 'Python', 'true', 'null', ' ts', 'shadow ']) {
    localStorage.setItem(key, value);
    expect(readEngineMode(key)).toBe(fallback);
  }
  for (const value of ['python', 'ts', 'shadow'] as const) {
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
  expect(readEngineMode(keys[2])).toBe('python');
});

it('production stays on Python without accessing storage, with or without preferences', () => {
  vi.stubEnv('DEV', false);
  for (const key of keys) expect(readEngineMode(key)).toBe('python');
  const read = stubStorage(() => 'ts');
  for (const key of keys) expect(readEngineMode(key)).toBe('python');
  expect(read).not.toHaveBeenCalled();
});

it('unavailable storage falls back to the stage default only at preference selection', () => {
  const read = stubStorage(() => {
    throw new DOMException('controlled denied storage', 'SecurityError');
  });
  for (const [key, fallback] of devDefaults) expect(readEngineMode(key)).toBe(fallback);
  expect(read).toHaveBeenCalledTimes(devDefaults.length);
});

it('an unknown runtime key cannot activate an engine capability', () => {
  const read = stubStorage(() => 'ts');
  expect(Reflect.apply(readEngineMode, undefined, ['engine.future'])).toBe('python');
  expect(read).not.toHaveBeenCalled();
});
