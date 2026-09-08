import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { ComposerSurface } from '../src/components/chat-window/Composer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let frames: FrameRequestCallback[];
function Fixture({ initial = '当前草稿' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ComposerSurface
      value={value}
      onChange={setValue}
      disabled={false}
      busy={false}
      history={['历史消息']}
      currentFileLabel={null}
      explicitContextPaths={[]}
      onAddContext={() => undefined}
      permissionProfile="ask"
      onPermissionProfileChange={() => undefined}
    />
  );
}
beforeEach(() => {
  frames = [];
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function input() {
  return container.querySelector<HTMLTextAreaElement>('textarea')!;
}
function key(value: string) {
  act(() =>
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    ),
  );
}
function flushFrames() {
  act(() => {
    for (const callback of frames.splice(0)) callback(0);
  });
}

test('取回历史后作者的新选区不被下一帧覆盖', () => {
  act(() => root.render(<Fixture />));
  input().focus();
  input().setSelectionRange(0, 0);
  key('ArrowUp');
  assert.equal(input().value, '历史消息');
  input().setSelectionRange(0, 2, 'backward');
  flushFrames();
  assert.equal(input().selectionStart, 0);
  assert.equal(input().selectionEnd, 2);
  assert.equal(input().selectionDirection, 'backward');
});

test('相同文本的历史回溯也在提交时落到末尾，不等下一帧', () => {
  act(() => root.render(<Fixture initial="历史消息" />));
  input().focus();
  input().setSelectionRange(0, 0);
  key('ArrowUp');
  assert.equal(input().selectionStart, input().value.length);
  assert.equal(input().selectionEnd, input().value.length);
});

test('历史回溯后可恢复原草稿，普通重渲染不重置新选区', () => {
  act(() => root.render(<Fixture />));
  input().focus();
  input().setSelectionRange(0, 0);
  key('ArrowUp');
  input().setSelectionRange(input().value.length, input().value.length);
  key('ArrowDown');
  assert.equal(input().value, '当前草稿');
  assert.equal(input().selectionStart, input().value.length);
  flushFrames();
  input().setSelectionRange(1, 2);
  act(() => root.render(<Fixture />));
  assert.equal(input().selectionStart, 1);
  assert.equal(input().selectionEnd, 2);
});
