import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, test } from 'vitest';

import { AppearanceSection } from '../src/components/settings/AppearanceSection';
import { SettingsSearchContext } from '../src/components/settings/search-context';
import { DEFAULT_APPEARANCE, type AppearanceSettings } from '../src/lib/appearance';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(query = '') {
  let latest: AppearanceSettings = DEFAULT_APPEARANCE;
  function Harness() {
    const [settings, setSettings] = useState(DEFAULT_APPEARANCE);
    latest = settings;
    return (
      <SettingsSearchContext.Provider value={query}>
        <AppearanceSection
          settings={settings}
          onChange={(key, value) => setSettings((prev) => ({ ...prev, [key]: value }))}
        />
      </SettingsSearchContext.Provider>
    );
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness />));
  return { latest: () => latest };
}

function q<T extends Element = HTMLElement>(selector: string): T {
  const element = host!.querySelector<T>(selector);
  assert.ok(element, selector);
  return element;
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('模式三张缩略图是单选组：点选与方向键都能切换，方向键把焦点带过去', async () => {
  const view = await mount();
  assert.equal(q('[data-testid="appearance-mode-dark"]').getAttribute('aria-checked'), 'true');
  await act(async () => q<HTMLButtonElement>('[data-testid="appearance-mode-light"]').click());
  assert.equal(view.latest().theme, 'light');
  assert.equal(q('[data-testid="appearance-mode-light"]').getAttribute('aria-checked'), 'true');
  assert.equal(q('[data-testid="appearance-mode-dark"]').getAttribute('aria-checked'), 'false');

  const group = q('[data-testid="appearance-mode-light"]').closest('[role="radiogroup"]')!;
  await act(async () => {
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  });
  assert.equal(view.latest().theme, 'system');
  assert.equal(document.activeElement, q('[data-testid="appearance-mode-system"]'));
});

test('强调色可选且没有紫色；选中项可读出名字', async () => {
  const view = await mount();
  await act(async () => q<HTMLButtonElement>('[data-testid="appearance-accent-blue"]').click());
  assert.equal(view.latest().accent, 'blue');
  const blue = q('[data-testid="appearance-accent-blue"]');
  assert.equal(blue.getAttribute('aria-checked'), 'true');
  assert.equal(blue.getAttribute('aria-label'), '蓝');
  assert.equal(host!.querySelector('[data-testid^="appearance-accent-purple"]'), null);
});

test('背景：凑满六位十六进制才生效，只改当前模式那一份，「恢复」回到主题底色', async () => {
  const view = await mount();
  const input = q<HTMLInputElement>('[data-testid="appearance-background"]');
  await typeInto(input, '#00');
  assert.equal(view.latest().customColors.dark.background, null);
  await typeInto(input, '#000000');
  assert.equal(view.latest().customColors.dark.background, '#000000');
  assert.equal(view.latest().customColors.light.background, null);
  await act(async () =>
    q<HTMLButtonElement>('[data-testid="appearance-background-reset"]').click(),
  );
  assert.equal(view.latest().customColors.dark.background, null);
  assert.equal(host!.querySelector('[data-testid="appearance-background-reset"]'), null);
});

test('前景与背景对比度不够时给提示，但照样生效', async () => {
  const view = await mount();
  assert.equal(host!.querySelector('[data-testid="appearance-foreground-warning"]'), null);
  await typeInto(q<HTMLInputElement>('[data-testid="appearance-foreground"]'), '#222222');
  assert.equal(view.latest().customColors.dark.foreground, '#222222');
  assert.match(q('[data-testid="appearance-foreground-warning"]').textContent ?? '', /对比度/);
});

test('主题与字体是下拉框，改了即生效', async () => {
  const view = await mount();
  const palette = q<HTMLSelectElement>('[data-testid="appearance-palette"]');
  await act(async () => {
    palette.value = 'warm';
    palette.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(view.latest().palette, 'warm');
  const font = q<HTMLSelectElement>('[data-testid="appearance-font"]');
  await act(async () => {
    font.value = 'dengxian';
    font.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(view.latest().uiFont, 'dengxian');
});

test('单选组由所在行的标题命名、说明描述；对比度警告也读在取色框的说明里', async () => {
  await mount();
  const textOf = (id: string | null) => (id ? document.getElementById(id)?.textContent : null);
  const groups = [...host!.querySelectorAll('[role="radiogroup"]')];
  assert.deepEqual(
    groups.map((group) => textOf(group.getAttribute('aria-labelledby'))),
    ['模式', '强调色'],
  );
  assert.match(textOf(groups[0]!.getAttribute('aria-describedby')) ?? '', /跟随系统/);
  assert.match(textOf(groups[1]!.getAttribute('aria-describedby')) ?? '', /紫色留给 AI/);

  const foreground = q<HTMLInputElement>('[data-testid="appearance-foreground"]');
  await typeInto(foreground, '#222222');
  assert.match(textOf(foreground.getAttribute('aria-describedby')) ?? '', /正文与界面文字.*对比度/);
});

test('设置搜索只留下命中的行', async () => {
  await mount('强调');
  assert.ok(host!.querySelector('[data-testid="appearance-accent-mono"]'));
  assert.equal(host!.querySelector('[data-testid="appearance-mode-dark"]'), null);
  assert.equal(host!.querySelector('[data-testid="appearance-background"]'), null);
});
