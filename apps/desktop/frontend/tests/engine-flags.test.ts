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

// P5-2 起：三个开关都默认走新引擎，作者可切回 Python；影子档不再给发行版。
const releaseDefaults: [(typeof keys)[number], EngineMode][] = [
  ['engine.ideCommands', 'ts'],
  ['engine.assistant', 'ts'],
  ['engine.agentLoop', 'ts'],
];

it.each(releaseDefaults)(
  'production defaults %s to %s and never allows shadow',
  (key, fallback) => {
    vi.stubEnv('DEV', false);
    expect(readEngineMode(key)).toBe(fallback);
    for (const value of ['shadow', 'PYTHON', 'python ', '']) {
      localStorage.setItem(key, value);
      expect(readEngineMode(key)).toBe(fallback);
    }
    localStorage.setItem(key, 'python');
    expect(readEngineMode(key)).toBe('python');
    localStorage.setItem(key, 'ts');
    expect(readEngineMode(key)).toBe('ts');
  },
);

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
  expect(engineModeChoices('engine.assistant')).toEqual(['ts', 'python']);
  expect(engineModeChoices('engine.ideCommands')).toEqual(['ts', 'python']);
  expect(writeEngineMode('engine.agentLoop', 'shadow')).toBe(false);
  expect(localStorage.getItem('engine.agentLoop')).toBeNull();
  expect(writeEngineMode('engine.agentLoop', 'python')).toBe(true);
  expect(readEngineMode('engine.agentLoop')).toBe('python');
  expect(writeEngineMode('engine.ideCommands', 'shadow')).toBe(false);
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

it('imports the Python database when dev explicitly switches it on, and always in a release build', () => {
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
  const read = stubStorage(() => 'off');
  expect(legacyImportOnOpen()).toBe(true);
  expect(read).not.toHaveBeenCalled();
});
