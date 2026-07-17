import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  allowsNativeContextMenu,
  installBrowserGuards,
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
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const insideEditable = document.createElement('span');
  editable.appendChild(insideEditable);

  assert.equal(allowsNativeContextMenu(div), false);
  assert.equal(allowsNativeContextMenu(null), false);
  assert.equal(allowsNativeContextMenu(input), true);
  assert.equal(allowsNativeContextMenu(textarea), true);
  assert.equal(allowsNativeContextMenu(insideEditable), true);
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
