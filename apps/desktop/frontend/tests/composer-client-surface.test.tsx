import { act, useRef, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ComposerBox } from '../src/components/chat-window/Composer';
import type { AgentPermissionProfile } from '../src/lib/agent-permission';

type ComposerProps = ComponentProps<typeof ComposerBox>;
type HarnessProps = Partial<
  Pick<
    ComposerProps,
    'busy' | 'disabled' | 'currentFileLabel' | 'explicitContextPaths' | 'queuedMessages' | 'history'
  >
> & { initialValue?: string };

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const submit = vi.fn();
const addContext = vi.fn();
const togglePinned = vi.fn();
const changePermission = vi.fn();
const removeQueued = vi.fn();
let host: HTMLDivElement;
let root: Root;
const paths = [
  '人物/主角/同名资料.md',
  '世界观/城市/同名资料.md',
  '伏笔/第一卷/线索记录.md',
  '大纲/第二卷/转折节点.md',
  '资料/长路径/其他参考.md',
];

function Harness({
  initialValue = '保留作者正在写的草稿',
  busy = false,
  disabled = false,
  currentFileLabel = null,
  explicitContextPaths = [],
  queuedMessages = [],
  history = [],
}: HarnessProps) {
  const [value, setValue] = useState(initialValue);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [permission, setPermission] = useState<AgentPermissionProfile>('ask');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ComposerBox
      inputRef={inputRef}
      value={value}
      onChange={setValue}
      onSubmit={() => submit(value)}
      busy={busy}
      disabled={disabled}
      currentFileLabel={currentFileLabel}
      explicitContextPaths={explicitContextPaths}
      history={history}
      queuedMessages={queuedMessages}
      onRemoveQueuedMessage={removeQueued}
      contextPickerOpen={pickerOpen}
      onAddContext={() => {
        addContext();
        setPickerOpen((open) => !open);
      }}
      onTogglePinnedContext={togglePinned}
      permissionProfile={permission}
      onPermissionProfileChange={(profile) => {
        changePermission(profile);
        setPermission(profile);
      }}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(props: HarnessProps = {}) {
  await act(async () => root.render(<Harness {...props} />));
}
function element<T extends HTMLElement>(selector: string) {
  const found = document.querySelector<T>(selector);
  expect(found, selector).not.toBeNull();
  return found!;
}
const textarea = () => element<HTMLTextAreaElement>('textarea');
async function click(selector: string) {
  await act(async () => element<HTMLButtonElement>(selector).click());
}
async function key(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => textarea().dispatchEvent(event));
  return event;
}
async function type(value: string) {
  const input = textarea();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

test('无引用不留上下文空栏，输入与固定工具行是两个独立的真实 DOM 区域', async () => {
  await render();
  const surface = element('[data-testid="composer-surface"]');
  const toolbar = element('[data-testid="composer-toolbar"]');
  const input = textarea();
  expect(host.querySelector('[data-testid="composer-contexts"]')).toBeNull();
  expect(surface.contains(input)).toBe(true);
  expect(surface.contains(toolbar)).toBe(true);
  expect(toolbar.contains(input)).toBe(false);
  expect(input.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(toolbar.contains(element('[aria-label="添加上下文"]'))).toBe(true);
  expect(toolbar.contains(element('[data-testid="permission-profile-selector"]'))).toBe(true);
  expect(toolbar.contains(element('[data-testid="composer-submit"]'))).toBe(true);
});

test.each([{ key: 'Enter' }, { key: 'Enter', ctrlKey: true }, { key: 'Enter', metaKey: true }])(
  '输入区 %j 恰好提交一次，使用当前草稿且不重建 textarea',
  async (chord) => {
    await render();
    const input = await type('这次只修订结尾');
    const event = await key(chord);
    expect(event.defaultPrevented).toBe(true);
    expect(submit).toHaveBeenCalledExactlyOnceWith('这次只修订结尾');
    expect(textarea()).toBe(input);
    expect(input.value).toBe('这次只修订结尾');
  },
);

test.each([
  { key: 'Enter', shiftKey: true },
  { key: 'Enter', ctrlKey: true, shiftKey: true },
  { key: 'Enter', isComposing: true },
  { key: 'Enter', keyCode: 229 },
])('换行与 IME %j 留给原生输入，不发送、不清草稿', async (chord) => {
  await render();
  const input = textarea();
  const event = await key(chord);
  expect(event.defaultPrevented).toBe(false);
  expect(submit).not.toHaveBeenCalled();
  expect(textarea()).toBe(input);
  expect(input.value).toBe('保留作者正在写的草稿');
});

test('busy 仍可编辑，键盘/按钮/表单把提交交给单条待发 owner，不自行消费草稿', async () => {
  await render({ busy: true, queuedMessages: [{ id: 7, content: '第一条已暂存' }] });
  const input = await type('后来继续写的草稿');
  expect(input.disabled).toBe(false);
  expect(element<HTMLButtonElement>('[data-testid="composer-submit"]').disabled).toBe(false);
  await key({ key: 'Enter' });
  await click('[data-testid="composer-submit"]');
  await act(async () =>
    element('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(submit.mock.calls).toEqual([
    ['后来继续写的草稿'],
    ['后来继续写的草稿'],
    ['后来继续写的草稿'],
  ]);
  expect(textarea()).toBe(input);
  expect(input.value).toBe('后来继续写的草稿');
  expect(host.querySelector('[data-testid="composer-queued-messages"]')?.textContent).toContain(
    '第一条已暂存',
  );
  await click('[aria-label="取消待发送消息：第一条已暂存"]');
  expect(removeQueued).toHaveBeenCalledExactlyOnceWith(7);
  expect(document.activeElement).toBe(input);
  expect(submit).toHaveBeenCalledTimes(3);
  expect(input.value).toBe('后来继续写的草稿');
});

test('disabled 在按钮、键盘和原生 form 提交边界均不能提交', async () => {
  await render({ disabled: true });
  const input = textarea();
  expect(input.disabled).toBe(true);
  expect(element<HTMLButtonElement>('[data-testid="composer-submit"]').disabled).toBe(true);
  await click('[data-testid="composer-submit"]');
  await key({ key: 'Enter' });
  await act(async () =>
    element('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(submit).not.toHaveBeenCalled();
  expect(input.value).toBe('保留作者正在写的草稿');
});

test('引用在 textarea 前独立展示，固定/取消保留完整路径，+N 走原上下文入口且不动草稿', async () => {
  const currentFile = '正文/第一卷/第01章.md';
  await render({ currentFileLabel: currentFile, explicitContextPaths: paths });
  const input = textarea();
  const contexts = element('[data-testid="composer-contexts"]');
  const toolbar = element('[data-testid="composer-toolbar"]');
  expect(contexts.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(toolbar.contains(contexts)).toBe(false);
  expect(contexts.contains(element('[aria-label="添加上下文"]'))).toBe(false);
  const pinFocus = Array.from(contexts.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.title.includes(currentFile),
  );
  expect(pinFocus).toBeTruthy();
  await act(async () => pinFocus!.click());
  expect(togglePinned).toHaveBeenLastCalledWith(currentFile);
  for (const path of paths.slice(0, 3)) {
    const unpin = Array.from(contexts.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.getAttribute('aria-label') === `取消固定参考：${path}`,
    );
    expect(unpin, path).toBeTruthy();
    await act(async () => unpin!.click());
    expect(togglePinned).toHaveBeenLastCalledWith(path);
  }
  const overflow = element<HTMLButtonElement>('[aria-label="查看全部 5 个固定参考"]');
  expect(overflow.textContent).toContain('+2');
  expect(overflow.title).toContain(paths[3]);
  expect(overflow.title).toContain(paths[4]);
  await act(async () => overflow.click());
  expect(addContext).toHaveBeenCalledTimes(1);
  expect(overflow.getAttribute('aria-expanded')).toBe('true');
  expect(textarea()).toBe(input);
  expect(input.value).toBe('保留作者正在写的草稿');
  expect(submit).not.toHaveBeenCalled();
  await render({ currentFileLabel: null, explicitContextPaths: [] });
  expect(host.querySelector('[data-testid="composer-contexts"]')).toBeNull();
  expect(textarea()).toBe(input);
  expect(input.value).toBe('保留作者正在写的草稿');
});

test('附件和权限控件的真实点击只走各自回调，不隐式提交外层 form', async () => {
  await render();
  const input = textarea();
  await click('[aria-label="添加上下文"]');
  expect(addContext).toHaveBeenCalledTimes(1);
  expect(element('[aria-label="添加上下文"]').getAttribute('aria-expanded')).toBe('true');
  await click('[data-testid="permission-profile-selector"]');
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  await click('[data-testid="permission-option-read"]');
  expect(changePermission).toHaveBeenCalledExactlyOnceWith('read');
  expect(element('[data-testid="permission-profile-selector"]').textContent).toContain('只读');
  expect(textarea()).toBe(input);
  expect(input.value).toBe('保留作者正在写的草稿');
  expect(submit).not.toHaveBeenCalled();
});

test('上下文展示变动不重置既有消息历史游标，退出历史后还原作者草稿', async () => {
  const history = ['先前发过的第一条', '先前发过的最后一条'];
  await render({ history });
  const input = textarea();
  input.setSelectionRange(0, 0);
  await key({ key: 'ArrowUp' });
  expect(input.value).toBe(history[1]);
  await render({ history, currentFileLabel: '正文/当前章.md', explicitContextPaths: paths });
  expect(textarea()).toBe(input);
  input.setSelectionRange(input.value.length, input.value.length);
  await key({ key: 'ArrowDown' });
  expect(input.value).toBe('保留作者正在写的草稿');
  expect(submit).not.toHaveBeenCalled();
});

test('空白草稿禁用发送按钮，并拒绝原生 form 的意外提交', async () => {
  await render({ initialValue: '  \n  ' });
  const input = textarea();
  expect(element<HTMLButtonElement>('[data-testid="composer-submit"]').disabled).toBe(true);
  await click('[data-testid="composer-submit"]');
  await act(async () =>
    element('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(submit).not.toHaveBeenCalled();
  expect(textarea()).toBe(input);
  expect(input.value).toBe('  \n  ');
});

test('disabled 引用区域保持可读，附件、固定、取消与 +N 不调用 owner', async () => {
  await render({ disabled: true, currentFileLabel: '正文/当前章.md', explicitContextPaths: paths });
  const input = textarea();
  const contexts = element('[data-testid="composer-contexts"]');
  for (const button of contexts.querySelectorAll<HTMLButtonElement>('button')) {
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
  }
  expect(contexts.textContent).toContain('当前章.md');
  expect(element<HTMLButtonElement>('[aria-label="添加上下文"]').disabled).toBe(true);
  await click('[aria-label="添加上下文"]');
  await click('[data-testid="permission-profile-selector"]');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(addContext).not.toHaveBeenCalled();
  expect(togglePinned).not.toHaveBeenCalled();
  expect(changePermission).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(textarea()).toBe(input);
  expect(input.value).toBe('保留作者正在写的草稿');
});
