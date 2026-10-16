import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { legacyImportOnOpen } from '../src/lib/engine/flags';

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
