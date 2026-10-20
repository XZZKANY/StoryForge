import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  allowsNativeContextMenu,
  installBrowserGuards,
  installMonacoCancellationGuard,
  isEditableTarget,
  isMonacoCancellation,
  isReloadShortcut,
} from '../src/lib/browser-guards';

test('F5 与 Ctrl+R / Ctrl+Shift+R 判定为刷新快捷键，普通按键不拦', () => {
  assert.equal(isReloadShortcut({ key: 'F5', ctrlKey: false, metaKey: false }), true);
  assert.equal(isReloadShortcut({ key: 'r', ctrlKey: true, metaKey: false }), true);
  assert.equal(isReloadShortcut({ key: 'R', ctrlKey: true, metaKey: false }), true);
  assert.equal(isReloadShortcut({ key: 'r', ctrlKey: false, metaKey: true }), true);
  assert.equal(isReloadShortcut({ key: 'r', ctrlKey: false, metaKey: false }), false);
  assert.equal(isReloadShortcut({ key: 's', ctrlKey: true, metaKey: false }), false);
});

test('装机护栏拦下刷新快捷键的默认行为（否则未保存稿随整页刷新丢失）', () => {
  const uninstall = installBrowserGuards(window);
  try {
    const reload = new KeyboardEvent('keydown', { key: 'F5', cancelable: true, bubbles: true });
    window.dispatchEvent(reload);
    assert.equal(reload.defaultPrevented, true);

    const ctrlR = new KeyboardEvent('keydown', {
      key: 'r',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(ctrlR);
    assert.equal(ctrlR.defaultPrevented, true);

    const save = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(save);
    assert.equal(save.defaultPrevented, false);
  } finally {
    uninstall();
  }
});

test('卸载后不再拦截', () => {
  const uninstall = installBrowserGuards(window);
  uninstall();
  const reload = new KeyboardEvent('keydown', { key: 'F5', cancelable: true, bubbles: true });
  window.dispatchEvent(reload);
  assert.equal(reload.defaultPrevented, false);
});

test('右键菜单：壳子区域抑制，输入类目标放行', () => {
  const div = document.createElement('div');
  const input = document.createElement('input');
  const textarea = document.createElement('textarea');
  const select = document.createElement('select');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const insideEditable = document.createElement('span');
  editable.appendChild(insideEditable);

  assert.equal(allowsNativeContextMenu(div), false);
  assert.equal(allowsNativeContextMenu(null), false);
  assert.equal(allowsNativeContextMenu(input), true);
  assert.equal(allowsNativeContextMenu(textarea), true);
  assert.equal(allowsNativeContextMenu(select), true);
  assert.equal(allowsNativeContextMenu(insideEditable), true);
});

test('可编辑目标判定覆盖 input / textarea / select / contenteditable 及普通壳层', () => {
  const shell = document.createElement('div');
  const input = document.createElement('input');
  const textarea = document.createElement('textarea');
  const select = document.createElement('select');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');

  assert.equal(isEditableTarget(shell), false);
  assert.equal(isEditableTarget(input), true);
  assert.equal(isEditableTarget(textarea), true);
  assert.equal(isEditableTarget(select), true);
  assert.equal(isEditableTarget(editable), true);
});

test('装机护栏抑制壳子区域 contextmenu 默认菜单', () => {
  const uninstall = installBrowserGuards(window);
  const div = document.createElement('div');
  document.body.appendChild(div);
  try {
    const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    div.dispatchEvent(menu);
    assert.equal(menu.defaultPrevented, true);
  } finally {
    uninstall();
    div.remove();
  }
});

/** Monaco 的 CancellationError：名字和消息都是「Canceled」。 */
class MonacoCancellation extends Error {
  constructor() {
    super('Canceled');
    this.name = this.message;
  }
}

function rejection(reason: unknown) {
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(event, 'reason', { value: reason });
  return event;
}

test('只认 Monaco 的取消错误：普通错误、中止、名字对消息不对的都不算', () => {
  assert.equal(isMonacoCancellation(new MonacoCancellation()), true);
  assert.equal(isMonacoCancellation(new Error('Canceled')), false);
  assert.equal(isMonacoCancellation(new DOMException('aborted', 'AbortError')), false);
  const renamed = new Error('写盘失败');
  renamed.name = 'Canceled';
  assert.equal(isMonacoCancellation(renamed), false);
  assert.equal(isMonacoCancellation('Canceled'), false);
  assert.equal(isMonacoCancellation(null), false);
});

test('取消守卫吞掉 Monaco 漏网的取消拒绝，别的未处理拒绝照常报；卸载后不再拦', () => {
  const uninstall = installMonacoCancellationGuard(window);
  try {
    const canceled = rejection(new MonacoCancellation());
    window.dispatchEvent(canceled);
    assert.equal(canceled.defaultPrevented, true);

    const real = rejection(new Error('写盘失败'));
    window.dispatchEvent(real);
    assert.equal(real.defaultPrevented, false);
  } finally {
    uninstall();
  }
  const after = rejection(new MonacoCancellation());
  window.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
});
