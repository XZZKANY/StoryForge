import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, vi } from 'vitest';

import { APPEARANCE_CACHE_KEY } from '../src/lib/appearance';
import { APP_SETTINGS_KEY } from '../src/lib/user-settings';

// 直接跑 index.html 的内联脚本，锁定「首帧渲染前同步落地 data-theme」的 FOUC 修复：
// 脚本必须读 localStorage 的 APP_SETTINGS_KEY，并在 React 挂载前写 documentElement.dataset.theme。
const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');

function extractInlineThemeScript(): string {
  const match = INDEX_HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'index.html 缺少内联主题初始化脚本');
  return match[1];
}

function runInlineScript(): void {
  // happy-dom 环境里直接 eval 内联脚本体。

  (0, eval)(extractInlineThemeScript());
}

function resetDom(): void {
  localStorage.removeItem(APP_SETTINGS_KEY);
  localStorage.removeItem(APPEARANCE_CACHE_KEY);
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
}

function stubSystemScheme(light: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-color-scheme: light)' ? light : !light,
        media: query,
      }) as MediaQueryList,
  );
}

test('已保存浅色主题时，index.html 内联脚本在首帧前写入 data-theme=light', () => {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
    runInlineScript();
    assert.equal(document.documentElement.dataset.theme, 'light');
  } finally {
    resetDom();
  }
});

test('已保存深色主题时写入 data-theme=dark', () => {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ theme: 'dark' }));
    runInlineScript();
    assert.equal(document.documentElement.dataset.theme, 'dark');
  } finally {
    resetDom();
  }
});

test('无已存设置时默认深色，不闪现', () => {
  try {
    runInlineScript();
    assert.equal(document.documentElement.dataset.theme, 'dark');
  } finally {
    resetDom();
  }
});

test('localStorage 内容损坏时回退深色且不抛错', () => {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, '{not-json');
    runInlineScript();
    assert.equal(document.documentElement.dataset.theme, 'dark');
  } finally {
    resetDom();
  }
});

test('跟随系统时按 Windows 当前深浅色决定首帧主题', () => {
  for (const light of [true, false]) {
    try {
      stubSystemScheme(light);
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ theme: 'system' }));
      runInlineScript();
      assert.equal(document.documentElement.dataset.theme, light ? 'light' : 'dark');
    } finally {
      resetDom();
    }
  }
});

test('外观缓存按解析出的模式写内联变量与字体，只认 -- 开头的变量名', () => {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
    localStorage.setItem(
      APPEARANCE_CACHE_KEY,
      JSON.stringify({
        v: 1,
        dark: { '--background': '1 2 3' },
        light: { '--background': '250 248 242', color: 'red' },
        font: 'DengXian, sans-serif',
      }),
    );
    runInlineScript();
    const style = document.documentElement.style;
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(style.getPropertyValue('--background'), '250 248 242');
    assert.equal(style.getPropertyValue('color'), '');
    assert.equal(style.getPropertyValue('--font-ui'), 'DengXian, sans-serif');
  } finally {
    resetDom();
  }
});

test('外观缓存损坏时保留已解析的主题且不抛错', () => {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
    localStorage.setItem(APPEARANCE_CACHE_KEY, '{broken');
    runInlineScript();
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(document.documentElement.style.getPropertyValue('--background'), '');
  } finally {
    resetDom();
  }
});
