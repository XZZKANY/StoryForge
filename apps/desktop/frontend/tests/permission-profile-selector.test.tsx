import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { AGENT_PERMISSION_PROFILE_OPTIONS } from '../src/lib/agent-permission';

import { ComposerSurface } from '../src/components/chat-window/Composer';
import { PermissionProfileSelector } from '../src/components/chat-window/PermissionProfileSelector';

test('显示当前档位标签', () => {
  const html = renderToStaticMarkup(
    <PermissionProfileSelector value="auto" onChange={() => undefined} />,
  );

  assert.match(html, /data-testid="permission-profile-selector"/);
  assert.match(html, /自动/);
});

test('不同档位显示对应标签', () => {
  const readHtml = renderToStaticMarkup(
    <PermissionProfileSelector value="read" onChange={() => undefined} />,
  );
  assert.match(readHtml, /只读/);

  const askHtml = renderToStaticMarkup(
    <PermissionProfileSelector value="ask" onChange={() => undefined} />,
  );
  assert.match(askHtml, /询问/);

  const autoHtml = renderToStaticMarkup(
    <PermissionProfileSelector value="auto" onChange={() => undefined} />,
  );
  assert.match(autoHtml, /自动/);

  const fullHtml = renderToStaticMarkup(
    <PermissionProfileSelector value="full" onChange={() => undefined} />,
  );
  assert.match(fullHtml, /完全放行/);
});

test('disabled 时按钮被禁用', () => {
  const html = renderToStaticMarkup(
    <PermissionProfileSelector value="ask" onChange={() => undefined} disabled />,
  );

  assert.match(html, /data-testid="permission-profile-selector"/);
  assert.match(html, /disabled=""/);
});

test('busy 时按钮被禁用且显示特定提示', () => {
  const html = renderToStaticMarkup(
    <PermissionProfileSelector value="ask" onChange={() => undefined} busy />,
  );

  assert.match(html, /data-testid="permission-profile-selector"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /本轮正在按启动时的权限档位执行/);
});

test('展开权限菜单时 Composer 不裁切向上的浮层', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ComposerSurface
        value=""
        disabled={false}
        busy={false}
        currentFileLabel={null}
        explicitContextPaths={[]}
        onAddContext={() => undefined}
        onChange={() => undefined}
        permissionProfile="ask"
        onPermissionProfileChange={() => undefined}
      />,
    );
  });

  const trigger = container.querySelector(
    '[data-testid="permission-profile-selector"]',
  ) as HTMLButtonElement;
  act(() => trigger.click());

  const menu = container.querySelector('[role="listbox"]');
  const composer = trigger.closest('.group');
  assert.ok(menu, '权限菜单没有展开');
  assert.ok(composer, '找不到 Composer 外层');
  assert.ok(menu.classList.contains('inset-x-0'), '菜单应跟随整个 Composer 的宽度');
  assert.equal(menu.parentElement?.closest('.relative'), composer, '不能继续相对权限按钮偏移定位');
  assert.equal(
    composer.classList.contains('overflow-hidden'),
    false,
    '向上展开的权限菜单会被 Composer overflow-hidden 裁切',
  );

  act(() => root.unmount());
  container.remove();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement | undefined;
let selectorRoot: ReturnType<typeof createRoot> | undefined;
const onPermissionChange = vi.fn();
function mountPermission(props: Partial<ComponentProps<typeof PermissionProfileSelector>> = {}) {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    selectorRoot = createRoot(host);
  }
  act(() =>
    selectorRoot!.render(
      <PermissionProfileSelector value="ask" onChange={onPermissionChange} {...props} />,
    ),
  );
  return host;
}
function permissionTrigger() {
  return host!.querySelector<HTMLButtonElement>('[data-testid="permission-profile-selector"]')!;
}
function permissionOption(profile: string) {
  return host!.querySelector<HTMLButtonElement>(`[data-testid="permission-option-${profile}"]`)!;
}
function pressKey(target: Element, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => target.dispatchEvent(event));
  return event;
}
afterEach(() => {
  act(() => selectorRoot?.unmount());
  host?.remove();
  host = undefined;
  selectorRoot = undefined;
  onPermissionChange.mockClear();
});

test('权限按钮使用统一 32px ghost 层级与小盾牌，不再像紧缩表单', () => {
  mountPermission();
  expect(permissionTrigger().classList.contains('h-8')).toBe(true);
  expect(permissionTrigger().querySelector('.lucide-shield')).not.toBeNull();
  expect(permissionTrigger().classList.contains('border')).toBe(false);
});

test('打开即聚焦已选项，移动焦点不自动改变权限，显式 Enter 才调用原 onChange', () => {
  mountPermission();
  act(() => permissionTrigger().click());
  expect(document.activeElement).toBe(permissionOption('ask'));
  expect(permissionOption('ask').getAttribute('aria-selected')).toBe('true');
  pressKey(permissionOption('ask'), 'ArrowDown');
  expect(document.activeElement).toBe(permissionOption('auto'));
  expect(onPermissionChange).not.toHaveBeenCalled();
  expect(permissionOption('ask').getAttribute('aria-selected')).toBe('true');
  expect(permissionOption('auto').getAttribute('aria-selected')).toBe('false');
  pressKey(permissionOption('auto'), 'Enter');
  expect(onPermissionChange).toHaveBeenCalledExactlyOnceWith('auto');
  expect(host!.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(permissionTrigger());
});

test('方向键循环与 Home/End 只移焦，Space 显式选择；菜单保留四档原文', () => {
  mountPermission({ value: 'full' });
  act(() => permissionTrigger().click());
  for (const option of AGENT_PERMISSION_PROFILE_OPTIONS) {
    expect(permissionOption(option.value).textContent).toContain(option.label);
    expect(permissionOption(option.value).textContent).toContain(option.hint);
  }
  pressKey(permissionOption('full'), 'ArrowDown');
  expect(document.activeElement).toBe(permissionOption('read'));
  pressKey(permissionOption('read'), 'ArrowUp');
  expect(document.activeElement).toBe(permissionOption('full'));
  pressKey(permissionOption('full'), 'Home');
  expect(document.activeElement).toBe(permissionOption('read'));
  pressKey(permissionOption('read'), 'End');
  expect(document.activeElement).toBe(permissionOption('full'));
  expect(onPermissionChange).not.toHaveBeenCalled();
  pressKey(permissionOption('full'), ' ');
  expect(onPermissionChange).toHaveBeenCalledExactlyOnceWith('full');
  expect(document.activeElement).toBe(permissionTrigger());
});

test('Escape 取消并回到 trigger，重新打开仍聚焦当前选择', () => {
  mountPermission();
  permissionTrigger().focus();
  pressKey(permissionTrigger(), 'ArrowDown');
  expect(document.activeElement).toBe(permissionOption('ask'));
  pressKey(permissionOption('ask'), 'End');
  const escape = pressKey(permissionOption('full'), 'Escape');
  expect(escape.defaultPrevented).toBe(true);
  expect(onPermissionChange).not.toHaveBeenCalled();
  expect(host!.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(permissionTrigger());
  act(() => permissionTrigger().click());
  expect(document.activeElement).toBe(permissionOption('ask'));
});

test.each(['Escape', 'Enter', ' ', 'ArrowDown', 'Home', 'End'])(
  'IME 组字时 %s 不关闭、不移焦、不选择权限',
  (key) => {
    mountPermission();
    act(() => permissionTrigger().click());
    const selected = permissionOption('ask');
    selected.focus();
    const event = pressKey(selected, key, { isComposing: true });
    expect(event.defaultPrevented).toBe(false);
    expect(host!.querySelector('[role="listbox"]')).not.toBeNull();
    expect(document.activeElement).toBe(selected);
    expect(onPermissionChange).not.toHaveBeenCalled();
  },
);

test.each([{ busy: true }, { disabled: true }])(
  '运行/禁用中途到来作废已打开菜单，不会暗中改权限或恢复旧菜单：%j',
  (blocked) => {
    mountPermission();
    act(() => permissionTrigger().click());
    const oldOption = permissionOption('full');
    mountPermission(blocked);
    expect(permissionTrigger().disabled).toBe(true);
    expect(permissionTrigger().getAttribute('aria-expanded')).toBe('false');
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
    act(() => oldOption.click());
    pressKey(oldOption, 'Enter');
    expect(onPermissionChange).not.toHaveBeenCalled();
    mountPermission();
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
    expect(onPermissionChange).not.toHaveBeenCalled();
  },
);

test('fitToComposer 使用 Composer 外框定位，standalone 保留自己的相对定位', () => {
  mountPermission({ fitToComposer: true });
  act(() => permissionTrigger().click());
  let menu = host!.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(permissionTrigger().parentElement!.classList.contains('relative')).toBe(false);
  expect(menu.classList.contains('inset-x-0')).toBe(true);
  expect(menu.classList.contains('w-[280px]')).toBe(false);
  mountPermission({ fitToComposer: false });
  menu = host!.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(permissionTrigger().parentElement!.classList.contains('relative')).toBe(true);
  expect(menu.classList.contains('left-0')).toBe(true);
});

test('点选只调用选中档位一次并回焦点，外部点击取消不抢外部焦点', () => {
  mountPermission();
  act(() => permissionTrigger().click());
  act(() => permissionOption('read').click());
  expect(onPermissionChange).toHaveBeenCalledExactlyOnceWith('read');
  expect(document.activeElement).toBe(permissionTrigger());
  onPermissionChange.mockClear();
  const outside = document.createElement('input');
  document.body.appendChild(outside);
  try {
    act(() => permissionTrigger().click());
    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      outside.focus();
    });
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(onPermissionChange).not.toHaveBeenCalled();
  } finally {
    outside.remove();
  }
});

test('同帧重复选择只提交一次，下一次显式打开仍可选择', () => {
  mountPermission();
  act(() => permissionTrigger().click());
  const option = permissionOption('auto');
  act(() => {
    option.click();
    option.click();
  });
  expect(onPermissionChange).toHaveBeenCalledExactlyOnceWith('auto');
  act(() => permissionTrigger().click());
  act(() => permissionOption('read').click());
  expect(onPermissionChange.mock.calls).toEqual([['auto'], ['read']]);
});

test('键盘 Tab 移到外部输入后关闭菜单，不隐式选择或抢回焦点', () => {
  mountPermission();
  const input = document.createElement('input');
  document.body.appendChild(input);
  try {
    act(() => permissionTrigger().click());
    const selected = permissionOption('ask');
    const event = pressKey(selected, 'Tab');
    expect(event.defaultPrevented).toBe(false);
    // happy-dom 不执行 Tab 默认焦点导航；模拟浏览器的 focusout/in 接缝。
    act(() => input.focus());
    expect(host!.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(onPermissionChange).not.toHaveBeenCalled();
  } finally {
    input.remove();
  }
});
