import assert from 'node:assert/strict';
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';
import { DialogSurface, FloatingSurface, IconButton, Tooltip } from '../src/components/ui';
import { placeFloating } from '../src/components/ui/floating-position';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<{ host: HTMLElement; root: ReturnType<typeof createRoot> }> = [];
function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push({ host, root });
  act(() => root.render(element));
  return host;
}
afterEach(() => {
  for (const { host, root } of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
});
function key(node: EventTarget, key: string) {
  act(() =>
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
  );
}
test('定位四边夹紧、上下翻转、超大内容限制尺寸', () => {
  for (const [x, y] of [
    [-10, -10],
    [1020, 0],
    [0, 760],
    [1020, 760],
  ]) {
    const p = placeFloating({ left: x, right: x + 20, top: y, bottom: y + 20 }, 300, 200, {
      width: 1024,
      height: 768,
    });
    assert.ok(p.left >= 8 && p.left + 300 <= 1016);
    assert.ok(p.top >= 8 && p.top + 200 <= 760);
  }
  const large = placeFloating({ left: 200, right: 230, top: 740, bottom: 760 }, 2000, 2000, {
    width: 1024,
    height: 768,
  });
  assert.equal(large.maxWidth, 1008);
  assert.equal(large.maxHeight, 752);
  assert.equal(large.top, 8);
  assert.ok(
    placeFloating({ left: 10, right: 30, top: 700, bottom: 720 }, 200, 100, {
      width: 1024,
      height: 768,
    }).top < 700,
  );
});
test('模态内 portal 菜单保持可聚焦、只处理顶层 Escape，再恢复触发按钮', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState(true);
    const ref = useRef<HTMLButtonElement>(null);
    return dialog ? (
      <DialogSurface aria-label="窗口" onClose={() => setDialog(false)}>
        <button ref={ref} onClick={() => setOpen(true)}>
          菜单
        </button>
        {open && (
          <FloatingSurface role="menu" triggerRef={ref} onDismiss={() => setOpen(false)}>
            <button role="menuitem">首</button>
            <button role="menuitem" disabled>
              不可用
            </button>
            <button role="menuitem">尾</button>
          </FloatingSurface>
        )}
      </DialogSurface>
    ) : (
      <span>关闭</span>
    );
  }
  const host = mount(<Harness />);
  const trigger = host.querySelector('button')!;
  act(() => trigger.click());
  const menu = document.querySelector('[role="menu"]')!;
  assert.equal(menu.parentElement, document.body);
  assert.equal(menu.closest('[inert]'), null);
  assert.equal(document.activeElement?.textContent, '首');
  key(document.activeElement!, 'ArrowDown');
  assert.equal(document.activeElement?.textContent, '尾');
  key(document.activeElement!, 'Home');
  assert.equal(document.activeElement?.textContent, '首');
  key(document.activeElement!, 'Escape');
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.ok(host.querySelector('[role="dialog"]'));
  assert.equal(document.activeElement, trigger);
  key(trigger, 'Escape');
  assert.equal(host.textContent, '关闭');
});
test('外部 pointer 关闭菜单不抢回焦点、不消费下一层', () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <input aria-label="外部" />
        {open && (
          <FloatingSurface point={{ x: 10, y: 10 }} role="menu" onDismiss={() => setOpen(false)}>
            <button role="menuitem">动作</button>
          </FloatingSurface>
        )}
      </>
    );
  }
  const host = mount(<Harness />);
  const outside = host.querySelector('input')!;
  act(() => {
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    outside.focus();
  });
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, outside);
});
test('Tooltip 键盘说明不替代名称，Escape 清除关联；hover 延迟在卸载时清理', () => {
  vi.useFakeTimers();
  const host = mount(
    <>
      <IconButton label="关闭面板" tooltip="关闭当前面板" icon={<svg />} />
      <Tooltip content="帮助" delay={400}>
        {(props) => <button {...props}>说明</button>}
      </Tooltip>
    </>,
  );
  const button = host.querySelector('button')!;
  act(() => button.focus());
  const tooltip = document.querySelector('[role="tooltip"]')!;
  assert.ok(tooltip);
  assert.equal(button.getAttribute('aria-label'), '关闭面板');
  assert.equal(button.getAttribute('title'), null);
  assert.equal(button.getAttribute('aria-describedby'), tooltip.id);
  assert.equal(document.activeElement, button);
  key(button, 'Escape');
  assert.equal(button.getAttribute('aria-describedby'), null);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  const anchor = host.querySelectorAll('span.sf-tooltip-anchor')[1];
  act(() => anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  act(() => vi.advanceTimersByTime(399));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  act(() => vi.advanceTimersByTime(1));
  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, '帮助');
});

test('模态内菜单 Tab/Shift+Tab 关闭一次并按触发器顺序移动，不关闭父弹窗', () => {
  const reasons: string[] = [];
  function Harness() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <DialogSurface aria-label="父窗口" onClose={() => assert.fail('父弹窗不能关闭')}>
        <button>之前</button>
        <button ref={ref} onClick={() => setOpen(true)}>
          菜单
        </button>
        <button>之后</button>
        {open && (
          <FloatingSurface
            role="menu"
            triggerRef={ref}
            onDismiss={(reason) => {
              reasons.push(reason);
              setOpen(false);
            }}
          >
            <button role="menuitem">唯一选项</button>
          </FloatingSurface>
        )}
      </DialogSurface>
    );
  }
  const host = mount(<Harness />);
  const [before, trigger, after] = host.querySelectorAll('button');
  act(() => trigger.click());
  key(document.activeElement!, 'Tab');
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, after);
  assert.deepEqual(reasons, ['tab']);
  act(() => trigger.click());
  act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, before);
  assert.deepEqual(reasons, ['tab', 'tab']);
});

test('同一次遮罩 pointer/mouse 手势只关闭菜单，第二次才关闭可外部取消的弹窗', () => {
  function Harness() {
    const [dialog, setDialog] = useState(true);
    const [menu, setMenu] = useState(true);
    return dialog ? (
      <div data-modal-backdrop="">
        <DialogSurface dismissOutside aria-label="窗口" onClose={() => setDialog(false)}>
          <button>触发</button>
          {menu && (
            <FloatingSurface role="menu" point={{ x: 10, y: 10 }} onDismiss={() => setMenu(false)}>
              <button role="menuitem">操作</button>
            </FloatingSurface>
          )}
        </DialogSurface>
      </div>
    ) : null;
  }
  const host = mount(<Harness />);
  const backdrop = host.querySelector('[data-modal-backdrop]')!;
  act(() => backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  act(() => backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.ok(host.querySelector('[role="dialog"]'));
  act(() => backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  assert.equal(host.querySelector('[role="dialog"]'), null);
});
