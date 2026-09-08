import assert from 'node:assert/strict';
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import { ContextMenu, type ContextMenuItem } from '../src/components/shell/ContextMenu';
import { useDismissableMenu } from '../src/components/shell/useDismissableMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mountMenu(items: ContextMenuItem[]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button data-testid="trigger" onClick={() => setOpen(true)}>
          Menu
        </button>
        <button data-testid="outside">Outside</button>
        {open && <ContextMenu x={10} y={20} items={items} onClose={() => setOpen(false)} />}
      </>
    );
  }
  act(() => root!.render(<Harness />));
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!;
  trigger.focus();
  act(() => trigger.click());
  return {
    trigger,
    outside: container.querySelector<HTMLButtonElement>('[data-testid="outside"]')!,
  };
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    document.activeElement!.dispatchEvent(event);
  });
  return event;
}

test('菜单初始焦点、方向键循环及 Home/End 跳过禁用项和分隔符', () => {
  mountMenu([
    { label: 'Disabled', disabled: true, onSelect: vi.fn() },
    { label: 'First', onSelect: vi.fn() },
    { type: 'separator' },
    { label: 'Last', onSelect: vi.fn() },
  ]);
  assert.equal(document.activeElement?.textContent, 'First');
  assert.equal(container?.querySelectorAll('[role="separator"]').length, 1);
  press('ArrowUp');
  assert.equal(document.activeElement?.textContent, 'Last');
  press('ArrowDown');
  assert.equal(document.activeElement?.textContent, 'First');
  press('End');
  assert.equal(document.activeElement?.textContent, 'Last');
  press('Home');
  assert.equal(document.activeElement?.textContent, 'First');
});

test('Escape 关闭菜单并恢复触发按钮，组合输入不关闭', () => {
  const { trigger } = mountMenu([{ label: 'Open', onSelect: vi.fn() }]);
  assert.equal(press('Escape', { isComposing: true }).defaultPrevented, false);
  assert.ok(container!.querySelector('[role="menu"]'));
  assert.equal(press('Escape', { keyCode: 229 }).defaultPrevented, false);
  press('Escape');
  assert.equal(container!.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, trigger);
});

test('右键菜单使用显式目标恢复焦点，即使打开前 activeElement 仍是 body', () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  const target = document.createElement('button');
  target.type = 'button';
  target.textContent = '右键目标';
  document.body.appendChild(target);
  root = createRoot(container);

  try {
    act(() =>
      root!.render(
        <ContextMenu
          x={10}
          y={20}
          items={[{ label: '打开', onSelect: vi.fn() }]}
          onClose={vi.fn()}
          returnFocus={target}
        />,
      ),
    );
    assert.equal(document.activeElement?.getAttribute('role'), 'menuitem');
    press('Escape');
    assert.equal(document.activeElement, target);
  } finally {
    target.remove();
  }
});

test('Tab 关闭菜单但不取消原生前后导航，焦点移到外部不会被抢回', () => {
  const { trigger, outside } = mountMenu([{ label: 'Open', onSelect: vi.fn() }]);
  assert.equal(press('Tab').defaultPrevented, false);
  assert.equal(container!.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, trigger);
  act(() => trigger.click());
  act(() => outside.focus());
  assert.equal(container!.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, outside);
});

test('菜单项执行前恢复入口，执行后转移到其他控件的焦点保持', () => {
  let focusDuringAction: Element | null = null;
  const { trigger, outside } = mountMenu([
    {
      label: 'Open',
      onSelect: () => {
        focusDuringAction = document.activeElement;
        outside.focus();
      },
    },
  ]);
  const item = container!.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  act(() => item.click());
  assert.equal(focusDuringAction, trigger);
  assert.equal(document.activeElement, outside);
});

test('移除正在聚焦的菜单项后，焦点接续到相邻可用项', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Harness() {
    const [removed, setRemoved] = useState(false);
    return (
      <ContextMenu
        x={10}
        y={20}
        onClose={() => {}}
        items={[
          ...(!removed ? [{ label: 'Remove', onSelect: () => setRemoved(true) }] : []),
          { label: 'Keep', onSelect: vi.fn() },
        ]}
      />
    );
  }
  act(() => root!.render(<Harness />));
  const item = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  await act(async () => item.click());
  assert.equal(document.activeElement?.textContent, 'Keep');
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

  const menu = container.querySelector('[data-testid="context-menu"]');
  assert.ok(menu);
  assert.equal(menu.classList.contains('bg-surface/[0.92]'), true);
  assert.equal(menu.classList.contains('bg-surface/92'), false);
});

test('旧式可关面板不会抢走模态对话框的 Escape', () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  function Harness({ modal }: { modal: boolean }) {
    const [open, setOpen] = useState(true);
    const triggerRef = useRef<HTMLButtonElement>(null);
    useDismissableMenu(open, () => setOpen(false), triggerRef);
    return (
      <>
        <button ref={triggerRef} data-testid="legacy-trigger">
          入口
        </button>
        {open && <div data-testid="legacy-panel" />}
        {modal && <div role="dialog" aria-modal="true" data-testid="modal" />}
      </>
    );
  }

  try {
    act(() => root!.render(<Harness modal />));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    assert.ok(container.querySelector('[data-testid="legacy-panel"]'));

    act(() => root!.render(<Harness modal={false} />));
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="legacy-trigger"]')!;
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    assert.equal(container.querySelector('[data-testid="legacy-panel"]'), null);
    assert.equal(document.activeElement, trigger);
  } finally {
    act(() => root!.unmount());
    container.remove();
  }
});
