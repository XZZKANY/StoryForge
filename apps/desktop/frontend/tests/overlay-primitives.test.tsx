import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// 作者窗口 1400×759：左栏 48–268、编辑区 268–1022、对话栏 1022–1400，三栏都从标题栏下（36）开始。
const VIEWPORT = { width: 1400, height: 759 };
const EDITOR = { left: 268, right: 1022, top: 36, bottom: 759 };
const CHAT = { left: 1022, right: 1400, top: 36, bottom: 759 };
test('挂在按钮上的浮层放得下就留在按钮所在的那一栏', () => {
  // 编辑区「⋯」菜单：从按钮左缘往右展开会伸进对话栏，留在编辑区里就往左收。
  const more = { left: 984, right: 1012, top: 44, bottom: 68 };
  assert.equal(placeFloating(more, 224, 195, VIEWPORT, 'bottom', 'start').left, 984);
  assert.equal(placeFloating(more, 224, 195, VIEWPORT, 'bottom', 'start', EDITOR).left, 790);
  // 对话头「上下文」面板：右对齐按钮会伸进正文，留在对话栏里就往右挪。
  const layers = { left: 1292, right: 1320, top: 44, bottom: 68 };
  assert.equal(placeFloating(layers, 352, 343, VIEWPORT, 'bottom', 'end').left, 968);
  assert.equal(placeFloating(layers, 352, 343, VIEWPORT, 'bottom', 'end', CHAT).left, 1030);
  // 对话头按钮的提示气泡：往上会顶进标题栏盖住窗口按钮，留在对话栏里就翻到按钮下面。
  assert.equal(placeFloating(layers, 77, 25, VIEWPORT, 'top', 'start').top, 13);
  assert.equal(placeFloating(layers, 77, 25, VIEWPORT, 'top', 'start', CHAT).top, 74);
  // 输入框上方的下拉：栏里上方放得下，照旧往上开。
  const composer = { left: 1034, right: 1388, top: 634, bottom: 747 };
  assert.equal(placeFloating(composer, 354, 161, VIEWPORT, 'top', 'start', CHAT).top, 467);
  // 栏比浮层还窄：退回按整个窗口摆，不硬塞。
  const narrow = { left: 1022, right: 1300, top: 36, bottom: 759 };
  assert.equal(placeFloating(layers, 352, 343, VIEWPORT, 'bottom', 'end', narrow).left, 968);
});
test('浮层找按钮所在的那一栏；在模态框里或跟着鼠标的右键菜单不受栏限制', () => {
  const column = { left: 268, right: 1022, top: 36, bottom: 759, width: 754, height: 723 };
  const button = { left: 984, right: 1012, top: 44, bottom: 68, width: 28, height: 24 };
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute('data-floating-column')) return column as DOMRect;
    if (this.tagName === 'BUTTON') return button as DOMRect;
    if (this.hasAttribute('data-floating-surface'))
      return { left: 0, right: 224, top: 0, bottom: 195, width: 224, height: 195 } as DOMRect;
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
  });
  vi.stubGlobal('innerWidth', 1400);
  vi.stubGlobal('innerHeight', 759);
  function Harness({ modal, point }: { modal?: boolean; point?: { x: number; y: number } }) {
    const ref = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const inner = (
      <>
        <button ref={ref} onClick={() => setOpen(true)}>
          打开
        </button>
        {open && (
          <FloatingSurface triggerRef={ref} point={point} onDismiss={() => setOpen(false)}>
            菜单
          </FloatingSurface>
        )}
      </>
    );
    return (
      <div data-floating-column="">
        {modal ? <div aria-modal="true">{inner}</div> : inner}
      </div>
    );
  }
  const leftOf = (element: React.ReactElement) => {
    const host = mount(element);
    act(() => host.querySelector('button')!.click());
    const left = document.querySelector<HTMLElement>('[data-floating-surface]')!.style.left;
    act(() => roots.splice(0).forEach(({ host, root }) => (root.unmount(), host.remove())));
    return left;
  };
  try {
    assert.equal(leftOf(<Harness />), '790px');
    assert.equal(leftOf(<Harness modal />), '984px');
    assert.equal(leftOf(<Harness point={{ x: 984, y: 60 }} />), '984px');
  } finally {
    spy.mockRestore();
    vi.unstubAllGlobals();
  }
});
test('左栏、编辑区、对话栏三栏都标了 data-floating-column', () => {
  for (const [file, testId] of [
    ['src/components/shell/SidePanel.tsx', 'shell-side-panel'],
    ['src/components/app/AppShell.tsx', 'shell-center'],
    ['src/components/shell/AssistantPanelFrame.tsx', 'assistant-panel'],
  ]) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const start = lines.findIndex((line) => line.includes(`data-testid="${testId}"`));
    const end = lines.findIndex((line, index) => index > start && /^\s*>\s*$/.test(line));
    assert.ok(start >= 0 && end > start, `${file} 找不到 ${testId} 的开标签`);
    assert.ok(
      lines.slice(start, end).some((line) => line.includes('data-floating-column')),
      `${testId} 没标 data-floating-column`,
    );
  }
});
