import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test, vi } from 'vitest';

import { SettingsView } from '../src/components/SettingsView';
import { DEFAULT_APP_SETTINGS, sanitizeAppSettings } from '../src/lib/user-settings';

vi.mock('../src/lib/api-client', () => ({
  probeProviderHealth: vi.fn(),
}));
vi.mock('../src/lib/desktop-llm-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/desktop-llm-config')>();
  return { ...actual, listLlmProfiles: vi.fn(async () => null) };
});

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
  assert.match(html, /data-testid="model-profiles"/);
  assert.match(html, /data-testid="model-profile-new"/);
  // 润色并进「模型服务 → 高级」，不再单独一组、不再重填一遍。
  assert.doesNotMatch(html, /polish-provider|专用润色模型|href="#polish-provider"/);
  assert.match(html, /data-testid="about-version"/);
  assert.match(html, /data-testid="about-update-check"/);
});

test('设置：真相源 badge 恒显 env 源（不被保存态劫持）+ 搜索空态结构就位', () => {
  const html = renderToStaticMarkup(
    <SettingsView
      settings={DEFAULT_APP_SETTINGS}
      onChange={() => undefined}
      onClose={() => undefined}
    />,
  );
  // 存储位置 badge 恒显「仅存本机」，不被保存态改成「已保存」并永久停留
  assert.match(html, /data-testid="provider-runtime-env-source">仅存本机/);
  // 搜索过滤的 CSS 空态钩子：list 包裹 + 卡片类 + 无匹配横幅（隐藏由 index.css :empty/:has 驱动）
  assert.match(html, /class="sf-settings-list"/);
  assert.match(html, /class="sf-settings-card /);
  assert.match(html, /data-testid="settings-no-results"/);
});

test('设置导航默认高亮首个分组（scrollspy 初始态），模型列表容器限高滚动', () => {
  const html = renderToStaticMarkup(
    <SettingsView
      settings={DEFAULT_APP_SETTINGS}
      onChange={() => undefined}
      onClose={() => undefined}
    />,
  );
  assert.match(html, /href="#provider" aria-current="true"/);
  assert.doesNotMatch(html, /href="#about" aria-current/);
  assert.match(html, /sf-settings-list/);
});

test('模型服务一节说人话：不出现「槽」「provider」，也不再有探测模型 / 测试连接 / 保存并应用', () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <SettingsView
      settings={DEFAULT_APP_SETTINGS}
      onChange={() => undefined}
      onClose={() => undefined}
    />,
  );
  // 「连接与存储详情」里如实写着配置文件名 llm-provider.json，不算在内。
  const section = host.querySelector('[data-testid="model-profiles"]');
  assert.ok(section);
  const text = section.textContent ?? '';
  assert.doesNotMatch(text, /槽|provider|探测模型|测试连接|保存并应用|不会自动/i);
  assert.match(text, /新建一套/);
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
