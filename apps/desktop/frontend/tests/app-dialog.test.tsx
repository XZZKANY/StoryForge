import assert from 'node:assert/strict';
import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { AppDialogHost, type AppDialogState } from '../src/components/app/AppDialog';

function renderDialog(dialog: AppDialogState, onClose: (result?: boolean | string | null) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AppDialogHost dialog={dialog} onClose={onClose} onPromptValueChange={() => {}} />);
  });
  return {
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('Alert 按 Escape 时关闭', () => {
  const results: Array<boolean | string | null | undefined> = [];
  const rendered = renderDialog(
    {
      kind: 'alert',
      title: '提示',
      message: '操作完成',
      confirmLabel: '知道了',
      resolve: () => {},
    },
    (result) => results.push(result),
  );

  try {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    assert.deepEqual(results, [undefined]);
  } finally {
    rendered.cleanup();
  }
});

test('Confirm 按 Escape 时等价于取消', () => {
  const results: Array<boolean | string | null | undefined> = [];
  const rendered = renderDialog(
    {
      kind: 'confirm',
      title: '确认关闭',
      message: '未保存内容将被丢弃。',
      confirmLabel: '关闭',
      cancelLabel: '取消',
      resolve: () => {},
    },
    (result) => results.push(result),
  );

  try {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    assert.deepEqual(results, [false]);
  } finally {
    rendered.cleanup();
  }
});

test('Prompt 按 Escape 时只关闭一次并返回 null', () => {
  const results: Array<boolean | string | null | undefined> = [];
  const rendered = renderDialog(
    {
      kind: 'prompt',
      title: '新建文件',
      message: '输入文件名',
      confirmLabel: '创建',
      cancelLabel: '取消',
      defaultValue: '',
      value: '',
      resolve: () => {},
    },
    (result) => results.push(result),
  );

  try {
    const input = document.querySelector<HTMLInputElement>('[data-testid="app-dialog-input"]');
    assert.ok(input);
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.deepEqual(results, [null]);
  } finally {
    rendered.cleanup();
  }
});

test('Choice 渲染每个选项，点击 resolve 成对应 id；首个选项拿主按钮位（打开即聚焦→Enter 确认）', () => {
  const results: Array<boolean | string | null | undefined> = [];
  const rendered = renderDialog(
    {
      kind: 'choice',
      title: '有未保存修改',
      message: '第001章.md 有未保存修改。',
      cancelLabel: '继续编辑',
      choices: [
        { id: 'save', label: '保存并关闭文件' },
        { id: 'discard', label: '放弃修改', tone: 'danger' },
      ],
      resolve: () => {},
    },
    (result) => results.push(result),
  );

  try {
    const primary = document.querySelector<HTMLButtonElement>('[data-testid="app-dialog-primary"]');
    assert.equal(primary?.textContent, '保存并关闭文件');

    const discard = document.querySelector<HTMLButtonElement>(
      '[data-testid="app-dialog-choice-discard"]',
    );
    assert.equal(discard?.textContent, '放弃修改');

    act(() => discard?.click());
    assert.deepEqual(results, ['discard']);

    act(() => primary?.click());
    assert.deepEqual(results, ['discard', 'save']);
  } finally {
    rendered.cleanup();
  }
});

test('Choice 按 Escape 等价于取消（resolve null），不落到任何一个选项上', () => {
  const results: Array<boolean | string | null | undefined> = [];
  const rendered = renderDialog(
    {
      kind: 'choice',
      title: '有未保存修改',
      message: '第001章.md 有未保存修改。',
      cancelLabel: '继续编辑',
      choices: [
        { id: 'save', label: '保存并关闭文件' },
        { id: 'discard', label: '放弃修改', tone: 'danger' },
      ],
      resolve: () => {},
    },
    (result) => results.push(result),
  );

  try {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    assert.deepEqual(results, [null]);
  } finally {
    rendered.cleanup();
  }
});
