import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test, vi } from 'vitest';

import { SettingsView } from '../src/components/SettingsView';
import {
  DEFAULT_APP_SETTINGS,
  sanitizeAppSettings,
} from '../src/lib/user-settings';
import { ComposerBox } from '../src/components/chat-window/Composer';

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
  assert.match(html, /data-testid="agent-permission-profile"/);
});

test('设置：真相源 badge 恒显 env 源（不被保存态劫持）+ 搜索空态结构就位', () => {
  const html = renderToStaticMarkup(
    <SettingsView
      settings={DEFAULT_APP_SETTINGS}
      onChange={() => undefined}
      onClose={() => undefined}
    />,
  );
  // 真相源 badge 恒显「桌面注入」，不再被保存态改成「已保存」并永久停留
  assert.match(html, /data-testid="provider-runtime-env-source">桌面注入/);
  // 搜索过滤的 CSS 空态钩子：list 包裹 + 卡片类 + 无匹配横幅（隐藏由 index.css :empty/:has 驱动）
  assert.match(html, /class="sf-settings-list"/);
  assert.match(html, /class="sf-settings-card /);
  assert.match(html, /data-testid="settings-no-results"/);
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

test('Agent 权限设置默认风险确认，旧值和未知值安全回落', () => {
  assert.equal(DEFAULT_APP_SETTINGS.agentPermissionProfile, 'risk_confirm');
  assert.equal(sanitizeAppSettings({}).agentPermissionProfile, 'risk_confirm');
  assert.equal(
    sanitizeAppSettings({ ...DEFAULT_APP_SETTINGS, agentPermissionProfile: 'autonomous' })
      .agentPermissionProfile,
    'autonomous',
  );
  assert.equal(
    sanitizeAppSettings({ ...DEFAULT_APP_SETTINGS, agentPermissionProfile: 'full_allow' })
      .agentPermissionProfile,
    'risk_confirm',
  );
});

test('Composer 使用同一权限选择，运行中锁定启动档位', () => {
  const html = renderToStaticMarkup(
    <ComposerBox
      value="继续写第七章"
      disabled={false}
      busy
      currentFileLabel="正文/第07章.md"
      explicitContextPaths={[]}
      permissionProfile="autonomous"
      onChange={() => undefined}
      onSubmit={() => undefined}
      onAddContext={() => undefined}
      onPermissionProfileChange={() => undefined}
    />,
  );

  assert.match(html, /data-testid="composer-permission-profile"/);
  assert.match(html, /value="autonomous"/);
  assert.match(html, /<select[^>]*disabled=""[^>]*data-testid="composer-permission-profile"/);
});
