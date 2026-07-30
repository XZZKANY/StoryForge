import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { test } from 'vitest';
import { ToastHost } from '../src/components/shell/ToastHost';
import { emitToast } from '../src/lib/toast';
import { canUndoWriteback } from '../src/lib/writeback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const normalizeEol = (value: string) => value.replace(/\r\n/g, '\n');

test('撤销前必须确认当前内容仍是刚写进去的那份', () => {
  assert.equal(canUndoWriteback('改后正文', '改后正文', normalizeEol), true);
  // 仅换行差异不算变化
  assert.equal(canUndoWriteback('第一行\r\n第二行', '第一行\n第二行', normalizeEol), true);
  // 写回后作者又接着写了 / autosave 落了新盘 —— 此时盖回旧内容会吃掉这段新输入
  assert.equal(canUndoWriteback('改后正文，又续了一段', '改后正文', normalizeEol), false);
  assert.equal(canUndoWriteback('', '改后正文', normalizeEol), false);
});

function renderHost() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(<ToastHost />));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('带动作的通知渲染出动作键，点击即执行并收起该条', () => {
  const { container, cleanup } = renderHost();
  try {
    let ran = 0;
    act(() => {
      emitToast('修订已写回', { tone: 'success', action: { label: '撤销', run: () => ran++ } });
    });
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action, '带 action 的通知应渲染动作键');
    assert.equal(action.textContent, '撤销');

    act(() => action.click());
    assert.equal(ran, 1);
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null, '点完动作该条应收起');
  } finally {
    cleanup();
  }
});

test('不带动作的通知不长出动作键', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() => emitToast('普通通知'));
    assert.equal(container.querySelector('[data-testid="toast-action"]'), null);
    assert.ok(container.querySelector('[data-testid="toast-close"]'), '关闭键始终在');
  } finally {
    cleanup();
  }
});

test('撤销必须走守卫写回，不许绕开快照直接落盘', () => {
  // 撤销也是一次写盘，若绕开 performGuardedWriteback（经 writeAcceptedSuggestion）直接
  // TauriFileSystem.writeFile，就会出现「没有写前快照的写盘」，F27 红线被从后门击穿。
  const srcPath = '../src/components/editor/useSuggestionWriteback.ts';
  const source = readFileSync(fileURLToPath(new URL(srcPath, import.meta.url)), 'utf8');
  const offerUndo = source.match(/const offerUndo = useCallback\([\s\S]*?\n {2}\);/)?.[0];
  assert.ok(offerUndo, '找不到 offerUndo');
  assert.match(offerUndo, /canUndoWriteback\(current, wrote, normalizeEol\)/);
  assert.match(offerUndo, /await writeAcceptedSuggestion\(/);
  assert.doesNotMatch(offerUndo, /TauriFileSystem\.writeFile/);
});
