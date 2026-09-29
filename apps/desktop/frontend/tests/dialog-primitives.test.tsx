import assert from 'node:assert/strict';
import { act, StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test } from 'vitest';
import { DialogSurface, Input } from '../src/components/ui';
import { AppDialogHost } from '../src/components/app/AppDialog';
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
});
function key(node: EventTarget, key: string, options: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => node.dispatchEvent(e));
  return e;
}
test('Prompt 输入法 Enter/Escape 不提交或关闭，普通 Escape 只取消一次', () => {
  const results: unknown[] = [];
  const host = mount(
    <AppDialogHost
      dialog={{
        kind: 'prompt',
        title: '名称',
        message: '请输入',
        confirmLabel: '确认',
        cancelLabel: '取消',
        defaultValue: '',
        value: '中',
        resolve: () => {},
      }}
      onClose={(v) => results.push(v)}
      onPromptValueChange={() => {}}
    />,
  );
  const input = host.querySelector('input')!;
  key(input, 'Enter', { isComposing: true });
  key(input, 'Escape', { isComposing: true });
  key(input, 'Enter', { keyCode: 229 });
  assert.deepEqual(results, []);
  key(input, 'Escape');
  assert.deepEqual(results, [null]);
});
test('嵌套模态只关闭顶层，回焦父字段，最终恢复 opener 与背景隔离', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [nested, setNested] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    return (
      <>
        <button onClick={() => setOpen(true)}>打开</button>
        {open && (
          <DialogSurface aria-label="父" onClose={() => setOpen(false)} initialFocusRef={input}>
            <Input ref={input} defaultValue="草稿" />
            <button onClick={() => setNested(true)}>确认</button>
            {nested && (
              <DialogSurface aria-label="子" onClose={() => setNested(false)}>
                <button>取消</button>
              </DialogSurface>
            )}
          </DialogSurface>
        )}
      </>
    );
  }
  const host = mount(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const opener = host.querySelector('button')!;
  act(() => {
    opener.focus();
    opener.click();
  });
  assert.ok(opener.hasAttribute('inert'));
  const input = host.querySelector('input')!;
  assert.equal(document.activeElement, input);
  const confirm = host.querySelector('[aria-label="父"] button') as HTMLButtonElement;
  act(() => {
    confirm.focus();
    confirm.click();
  });
  assert.equal(host.querySelectorAll('[role="dialog"]').length, 2);
  key(document.activeElement!, 'Escape');
  assert.equal(host.querySelectorAll('[role="dialog"]').length, 1);
  assert.equal(document.activeElement, confirm);
  assert.equal(input.value, '草稿');
  key(confirm, 'Escape');
  assert.equal(document.activeElement, opener);
  assert.equal(opener.hasAttribute('inert'), false);
  assert.equal(document.body.style.overflow, '');
});
test('Tab 过滤隐藏/禁用/details', () => {
  const host = mount(
    <DialogSurface aria-label="测试" onClose={() => {}}>
      <button>首</button>
      <button disabled>禁用</button>
      <button hidden>隐藏</button>
      <details>
        <summary>展开</summary>
        <button>折叠内容</button>
      </details>
      <button>尾</button>
    </DialogSurface>,
  );
  const buttons = host.querySelectorAll('button');
  act(() => buttons[4].focus());
  key(buttons[4], 'Tab');
  assert.equal(document.activeElement, buttons[0]);
  key(buttons[0], 'Tab', { shiftKey: true });
  assert.equal(document.activeElement, buttons[4]);
});

test('无可聚焦控件时 Tab 留在容器，重渲染不抢回字段焦点', () => {
  const host = mount(
    <DialogSurface aria-label="空窗口" onClose={() => {}}>
      说明
    </DialogSurface>,
  );
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  assert.equal(document.activeElement, dialog);
  key(dialog, 'Tab');
  assert.equal(document.activeElement, dialog);
  const root = roots[roots.length - 1].root;
  act(() =>
    root.render(
      <DialogSurface aria-label="空窗口" onClose={() => {}}>
        <input />
        <button>尾</button>
      </DialogSurface>,
    ),
  );
  const button = host.querySelector('button')!;
  act(() => button.focus());
  act(() =>
    root.render(
      <DialogSurface aria-label="空窗口" onClose={() => {}}>
        <input defaultValue="更新" />
        <button>尾</button>
      </DialogSurface>,
    ),
  );
  assert.equal(document.activeElement, button);
});

test('模态打开时 data-layer-exempt 豁免层不加 inert/aria-hidden，普通兄弟照常隔离', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <div data-testid="toast-host" data-layer-exempt="">
          <button>撤销</button>
        </div>
        <button data-testid="background-action" onClick={() => setOpen(true)}>
          背景按钮
        </button>
        {open && (
          <DialogSurface aria-label="弹窗" onClose={() => setOpen(false)}>
            <button>确认</button>
          </DialogSurface>
        )}
      </>
    );
  }
  const host = mount(<Harness />);
  const exempt = host.querySelector('[data-layer-exempt]')!;
  const background = host.querySelector<HTMLButtonElement>('[data-testid="background-action"]')!;
  assert.equal(exempt.hasAttribute('inert'), false);
  assert.equal(background.hasAttribute('inert'), false);
  act(() => background.click());
  assert.ok(host.querySelector('[role="dialog"]'));
  // 豁免层（全局通知浮层）模态下仍可见可达；普通背景照常隔离。
  assert.equal(exempt.hasAttribute('inert'), false);
  assert.equal(exempt.getAttribute('aria-hidden'), null);
  assert.equal(background.hasAttribute('inert'), true);
  assert.equal(background.getAttribute('aria-hidden'), 'true');
  key(document.activeElement!, 'Escape');
  assert.equal(host.querySelector('[role="dialog"]'), null);
  assert.equal(background.hasAttribute('inert'), false);
});

test('Escape 落在 Monaco 编辑器或 data-esc-handled 容器内时放行，不吞掉也不关弹窗', () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <div className="monaco-editor">
          <textarea aria-label="编辑器输入" />
        </div>
        <div data-esc-handled="">
          <button>内嵌控件</button>
        </div>
        {open && (
          <DialogSurface aria-label="弹窗" onClose={() => setOpen(false)}>
            <button>确认</button>
          </DialogSurface>
        )}
      </>
    );
  }
  const host = mount(<Harness />);
  assert.ok(host.querySelector('[role="dialog"]'));
  const editor = host.querySelector('.monaco-editor textarea')!;
  const editorEsc = key(editor, 'Escape');
  assert.equal(editorEsc.defaultPrevented, false);
  assert.ok(host.querySelector('[role="dialog"]'));
  const embedded = host.querySelector('[data-esc-handled] button')!;
  const handledEsc = key(embedded, 'Escape');
  assert.equal(handledEsc.defaultPrevented, false);
  assert.ok(host.querySelector('[role="dialog"]'));
  // 弹窗自己的 Escape 仍然关闭。
  key(host.querySelector('[role="dialog"] button')!, 'Escape');
  assert.equal(host.querySelector('[role="dialog"]'), null);
});
