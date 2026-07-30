import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
import {
  DEFERENCE_IDLE_MS,
  isAuthorTypingTarget,
  isTypingKey,
  useDeference,
} from '../src/components/shell/useDeference';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest = false;
function Harness() {
  latest = useDeference();
  return null;
}

async function withDeference(run: (host: HTMLElement) => Promise<void>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // 中栏正文区：useDeference 只认这个 testid 里发出的按键
  const editorPanel = document.createElement('div');
  editorPanel.setAttribute('data-testid', 'editor-panel');
  document.body.appendChild(editorPanel);
  const root: Root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await run(editorPanel);
  } finally {
    act(() => root.unmount());
    container.remove();
    editorPanel.remove();
    latest = false;
  }
}

function typeIn(host: HTMLElement, key = 'a') {
  host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('只有中栏正文区的按键算「作者在写」', () => {
  const editor = document.createElement('div');
  editor.setAttribute('data-testid', 'editor-panel');
  const inside = document.createElement('textarea');
  editor.appendChild(inside);
  const outside = document.createElement('input');

  assert.equal(isAuthorTypingTarget(inside), true);
  assert.equal(isAuthorTypingTarget(editor), true);
  // 对话框 / 侧栏搜索框里打字时，那些面板正是作者在看的东西，不该让它们自己淡出
  assert.equal(isAuthorTypingTarget(outside), false);
  assert.equal(isAuthorTypingTarget(null), false);
});

test('修饰键组合不算在写字——Ctrl+K 唤起行间对话不该让壳子退场', () => {
  assert.equal(isTypingKey({ key: 'a', ctrlKey: false, metaKey: false, altKey: false }), true);
  assert.equal(isTypingKey({ key: 'Enter', ctrlKey: false, metaKey: false, altKey: false }), true);
  assert.equal(isTypingKey({ key: 'k', ctrlKey: true, metaKey: false, altKey: false }), false);
  assert.equal(isTypingKey({ key: 'Shift', ctrlKey: false, metaKey: false, altKey: false }), false);
  assert.equal(isTypingKey({ key: 'F5', ctrlKey: false, metaKey: false, altKey: false }), false);
});

test('敲字即退场，停笔到时自动回来', async () => {
  await withDeference(async (editorPanel) => {
    assert.equal(latest, false);
    await act(async () => {
      typeIn(editorPanel);
    });
    assert.equal(latest, true, '中栏敲字后左右栏应退场');

    await act(async () => {
      vi.advanceTimersByTime(DEFERENCE_IDLE_MS - 1);
    });
    assert.equal(latest, true, '空闲还没到时不该提前回来');

    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    assert.equal(latest, false, '停笔到时两栏必须回来');
  });
});

test('连续敲字会续上空闲计时，中途换气不让侧栏闪', async () => {
  await withDeference(async (editorPanel) => {
    await act(async () => {
      typeIn(editorPanel);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEFERENCE_IDLE_MS - 200);
      typeIn(editorPanel);
      vi.advanceTimersByTime(DEFERENCE_IDLE_MS - 200);
    });
    assert.equal(latest, true, '第二次按键应重置计时，而不是让第一次的计时到点');
  });
});

test('退场只许动 opacity 与描边，不许碰 display/visibility/mount', () => {
  // 右栏靠 hidden 保住会话状态、左栏五视图靠 CSS 互斥不卸载；退场规则一旦动到
  // display / visibility，就会打爆那两条既有护栏（assistant-panel / shell-panel-views）。
  const cssPath = '../src/index.css';
  const css = readFileSync(fileURLToPath(new URL(cssPath, import.meta.url)), 'utf8');
  const rules = [...css.matchAll(/\[data-shell-deferred[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length >= 3, '找不到壳子退场规则');
  const allowed = /^(?:opacity|border-color|transition)$/;
  for (const body of rules) {
    for (const [, prop] of body.matchAll(/^\s*([a-z-]+)\s*:/gm)) {
      assert.match(prop, allowed, `退场规则里出现了不该出现的属性：${prop}`);
    }
  }
});
