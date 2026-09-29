import assert from 'node:assert/strict';
import { act, createRef, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import { ActivityBar } from '../src/components/shell/ActivityBar';
import { ContextMenu } from '../src/components/shell/ContextMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

test('右键菜单背景使用 Tailwind 可生成的 92% 任意透明度类', () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <ContextMenu
        x={10}
        y={20}
        items={[{ label: '打开', onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
  });

  const menu = document.querySelector('[data-testid="context-menu"]');
  assert.ok(menu);
  assert.equal(menu.classList.contains('bg-surface/[0.92]'), true);
  assert.equal(menu.classList.contains('bg-surface/92'), false);
});

function renderNode(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
  return container;
}

function escapeKey(node: EventTarget) {
  act(() =>
    node.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
}

test('接通 triggerRef 后：Esc 关闭菜单焦点还触发按钮，触发按钮上的 pointerdown 不算 outside', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={triggerRef} onClick={() => setOpen(true)}>
          右键源
        </button>
        {open && (
          <ContextMenu
            x={10}
            y={10}
            items={[{ label: '重命名', onSelect: vi.fn() }]}
            onClose={() => setOpen(false)}
            triggerRef={triggerRef}
          />
        )}
      </>
    );
  }
  const host = renderNode(<Harness />);
  const trigger = host.querySelector('button')!;
  act(() => trigger.click());
  assert.ok(document.querySelector('[data-testid="context-menu"]'));

  // 落在 trigger 上的按下不算 outside-dismiss：不能把它后面的 click toggle 吃掉。
  act(() => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  assert.ok(document.querySelector('[data-testid="context-menu"]'));

  escapeKey(document.activeElement!);
  assert.equal(document.querySelector('[data-testid="context-menu"]'), null);
  assert.equal(document.activeElement, trigger);
});

test('设置齿轮可反复 toggle：开着再点一次关闭，Esc 关闭后焦点回齿轮', () => {
  const settingsButtonRef = createRef<HTMLButtonElement>();
  const host = renderNode(
    <ActivityBar
      view="explorer"
      sidebarHidden={false}
      onSwitchView={() => {}}
      onOpenSettings={() => {}}
      settingsMenu={[{ label: '外观', onSelect: vi.fn() }]}
      settingsButtonRef={settingsButtonRef}
    />,
  );
  const gear = host.querySelector<HTMLButtonElement>('[data-testid="activity-settings"]')!;
  assert.ok(gear);

  act(() => gear.click());
  assert.ok(document.querySelector('[data-testid="context-menu"]'));
  // 真实点击序列：pointerdown 先落在齿轮上（不许先关菜单），click 自己 toggle 关闭。
  act(() => gear.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  assert.ok(document.querySelector('[data-testid="context-menu"]'));
  act(() => gear.click());
  assert.equal(document.querySelector('[data-testid="context-menu"]'), null);

  act(() => gear.click());
  assert.ok(document.querySelector('[data-testid="context-menu"]'));
  escapeKey(document.activeElement!);
  assert.equal(document.querySelector('[data-testid="context-menu"]'), null);
  assert.equal(document.activeElement, gear);
});
