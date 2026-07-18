import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test, vi } from 'vitest';

import { SettingsView } from '../src/components/SettingsView';
import { DEFAULT_APP_SETTINGS, sanitizeAppSettings } from '../src/lib/user-settings';

vi.mock('../src/lib/api-client', () => ({
  probeProviderHealth: vi.fn(),
}));
vi.mock('../src/lib/desktop-llm-config', () => ({
  getDesktopLlmConfig: vi.fn(async () => null),
  saveDesktopLlmConfig: vi.fn(),
}));

test('设置页含搜索框、行号/字体模式选择与关于区（版本 + 检查更新）', () => {
  const html = renderToStaticMarkup(
    <SettingsView
      settings={DEFAULT_APP_SETTINGS}
      onChange={() => undefined}
      onClose={() => undefined}
    />,
  );
  assert.match(html, /data-testid="settings-search"/);
  assert.match(html, /data-testid="editor-line-numbers"/);
  assert.match(html, /data-testid="editor-font-mode"/);
  assert.match(html, /data-testid="about-version"/);
  assert.match(html, /data-testid="about-update-check"/);
});

test('sanitize：行号设置只认 auto/on/off，坏值落回 auto；旧存档无该字段也不炸', () => {
  assert.equal(
    sanitizeAppSettings({ ...DEFAULT_APP_SETTINGS, editorLineNumbers: 'on' }).editorLineNumbers,
    'on',
  );
  assert.equal(
    sanitizeAppSettings({ ...DEFAULT_APP_SETTINGS, editorLineNumbers: 'banana' }).editorLineNumbers,
    'auto',
  );
  const legacy = { editorFontSize: 16 } as unknown;
  assert.equal(sanitizeAppSettings(legacy).editorLineNumbers, 'auto');
});
