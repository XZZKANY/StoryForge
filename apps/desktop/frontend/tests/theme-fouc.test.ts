import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

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
  document.documentElement.removeAttribute('data-theme');
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
