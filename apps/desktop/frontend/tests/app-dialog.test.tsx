import assert from 'node:assert/strict';
import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { AppDialogHost, useAppDialog, type AppDialogState } from '../src/components/app/AppDialog';

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

type DialogApi = ReturnType<typeof useAppDialog>;

function renderHookDialog() {
  const apiRef: { current: DialogApi | null } = { current: null };
  function Harness() {
    const dialogs = useAppDialog();
    React.useEffect(() => {
      apiRef.current = dialogs;
    });
    return (
      <AppDialogHost
        dialog={dialogs.dialog}
        onClose={dialogs.closeDialog}
        onPromptValueChange={dialogs.updatePromptValue}
      />
    );
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
  return {
    api: () => {
      assert.ok(apiRef.current);
      return apiRef.current;
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function dialogTitle() {
  return document.querySelector('#app-dialog-title')?.textContent;
}

test('前窗未关时新请求 FIFO 排队：逐个呈现，每个 Promise 都会 resolve', async () => {
  const rendered = renderHookDialog();
  const resolved: Array<[string, unknown]> = [];
  try {
    await act(async () => {
      void rendered
        .api()
        .confirm({ title: '先弹的确认', message: '未保存内容将被丢弃。' })
        .then((value) => resolved.push(['confirm', value]));
      void rendered
        .api()
        .alert({ title: '后来的提示', message: '应该排队。' })
        .then(() => resolved.push(['alert', undefined]));
    });
    // 同时只呈现一个弹窗，先到先得；后来的请求不许覆盖它。
    assert.equal(document.querySelectorAll('[data-testid="app-dialog"]').length, 1);
    assert.equal(dialogTitle(), '先弹的确认');

    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="app-dialog-primary"]')?.click(),
    );
    await act(async () => {});
    assert.equal(document.querySelectorAll('[data-testid="app-dialog"]').length, 1);
    assert.equal(dialogTitle(), '后来的提示');
    assert.deepEqual(resolved, [['confirm', true]]);

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await act(async () => {});
    assert.equal(document.querySelector('[data-testid="app-dialog"]'), null);
    assert.deepEqual(resolved, [
      ['confirm', true],
      ['alert', undefined],
    ]);
  } finally {
    rendered.cleanup();
  }
});

test('同类弹窗连发也排队：两个 confirm 各自拿到自己的 true / false', async () => {
  const rendered = renderHookDialog();
  const resolved: boolean[] = [];
  try {
    await act(async () => {
      void rendered
        .api()
        .confirm({ title: '确认一', message: '第一条' })
        .then((value) => resolved.push(value));
      void rendered
        .api()
        .confirm({ title: '确认二', message: '第二条' })
        .then((value) => resolved.push(value));
    });
    assert.equal(dialogTitle(), '确认一');

    // 第一个点「取消」→ false；第二个立刻接上。
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="app-dialog-actions"] button')
        ?.click(),
    );
    await act(async () => {});
    assert.equal(dialogTitle(), '确认二');

    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="app-dialog-primary"]')?.click(),
    );
    await act(async () => {});
    assert.equal(document.querySelector('[data-testid="app-dialog"]'), null);
    assert.deepEqual(resolved, [false, true]);
  } finally {
    rendered.cleanup();
  }
});

test('队列里的 prompt 呈现后仍可输入，Enter 提交当前输入值', async () => {
  const rendered = renderHookDialog();
  const resolved: unknown[] = [];
  try {
    await act(async () => {
      void rendered
        .api()
        .alert({ title: '先弹的提示', message: '关掉我就轮到输入。' })
        .then(() => resolved.push('alert'));
      void rendered
        .api()
        .prompt({ title: '新建章节', message: '输入章节名', defaultValue: '第001章' })
        .then((value) => resolved.push(value));
    });
    assert.equal(dialogTitle(), '先弹的提示');
    assert.equal(document.querySelector('[data-testid="app-dialog-input"]'), null);

    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="app-dialog-primary"]')?.click(),
    );
    await act(async () => {});
    const input = document.querySelector<HTMLInputElement>('[data-testid="app-dialog-input"]');
    assert.ok(input);
    assert.equal(input.value, '第001章');

    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '第002章',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    );
    await act(async () => {});
    assert.equal(document.querySelector('[data-testid="app-dialog"]'), null);
    assert.deepEqual(resolved, ['alert', '第002章']);
  } finally {
    rendered.cleanup();
  }
});
