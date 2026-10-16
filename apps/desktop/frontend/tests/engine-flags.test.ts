import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  engineModeChoices,
  legacyImportOnOpen,
  readEngineMode,
  writeEngineMode,
  type EngineMode,
} from '../src/lib/engine/flags';

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

// P5-1 预览版：三个开关都默认影子档，作者可切回 Python；ts 档等 P5-2。
const releaseDefaults: [(typeof keys)[number], EngineMode][] = [
  ['engine.ideCommands', 'shadow'],
  ['engine.assistant', 'shadow'],
  ['engine.agentLoop', 'shadow'],
];

it.each(releaseDefaults)('production defaults %s to %s and never allows ts', (key, fallback) => {
  vi.stubEnv('DEV', false);
  expect(readEngineMode(key)).toBe(fallback);
  for (const value of ['ts', 'TS', 'shadow ', '']) {
    localStorage.setItem(key, value);
    expect(readEngineMode(key)).toBe(fallback);
  }
  localStorage.setItem(key, 'python');
  expect(readEngineMode(key)).toBe('python');
  localStorage.setItem(key, 'shadow');
  expect(readEngineMode(key)).toBe('shadow');
});

it('production falls back to its stage default when storage is denied', () => {
  vi.stubEnv('DEV', false);
  stubStorage(() => {
    throw new DOMException('controlled denied storage', 'SecurityError');
  });
  for (const [key, fallback] of releaseDefaults) expect(readEngineMode(key)).toBe(fallback);
});

it('offers each build only its allowed modes, default first, and writes only those', () => {
  expect(engineModeChoices('engine.assistant')).toEqual(['ts', 'python', 'shadow']);
  expect(engineModeChoices('engine.agentLoop')).toEqual(['python', 'ts', 'shadow']);
  vi.stubEnv('DEV', false);
  expect(engineModeChoices('engine.assistant')).toEqual(['shadow', 'python']);
  expect(engineModeChoices('engine.ideCommands')).toEqual(['shadow', 'python']);
  expect(writeEngineMode('engine.agentLoop', 'ts')).toBe(false);
  expect(localStorage.getItem('engine.agentLoop')).toBeNull();
  expect(writeEngineMode('engine.agentLoop', 'python')).toBe(true);
  expect(readEngineMode('engine.agentLoop')).toBe('python');
  expect(writeEngineMode('engine.ideCommands', 'ts')).toBe(false);
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw new DOMException('controlled denied storage', 'SecurityError');
    },
  });
  expect(writeEngineMode('engine.assistant', 'python')).toBe(false);
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

it('imports the Python database only when dev explicitly switches it on', () => {
  expect(legacyImportOnOpen()).toBe(false);
  for (const value of ['', 'ON', 'true', 'ts', ' on']) {
    localStorage.setItem('engine.legacyImport', value);
    expect(legacyImportOnOpen()).toBe(false);
  }
  localStorage.setItem('engine.legacyImport', 'on');
  expect(legacyImportOnOpen()).toBe(true);
  stubStorage(() => {
    throw new DOMException('controlled denied storage', 'SecurityError');
  });
  expect(legacyImportOnOpen()).toBe(false);
  vi.stubEnv('DEV', false);
  const read = stubStorage(() => 'on');
  expect(legacyImportOnOpen()).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
