import assert from 'node:assert/strict';
import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { AppDialogHost, useAppDialog, type AppDialogState } from '../src/components/app/AppDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

test('Prompt composition keys neither confirm nor cancel; ordinary Enter submits', () => {
  const results: Array<boolean | string | null | undefined> = [];
  const rendered = renderDialog(
    {
      kind: 'prompt',
      title: 'New file',
      message: 'File name',
      confirmLabel: 'Create',
      cancelLabel: 'Cancel',
      defaultValue: '',
      value: 'chapter',
      resolve: () => {},
    },
    (result) => results.push(result),
  );
  try {
    const input = document.querySelector<HTMLInputElement>('input')!;
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ['Enter', 'Escape']) {
        act(() =>
          input.dispatchEvent(
            new KeyboardEvent('keydown', {
              key,
              ...init,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
      }
    }
    assert.deepEqual(results, []);
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.deepEqual(results, ['chapter']);
    assert.equal(input.getAttribute('aria-labelledby'), 'app-dialog-title');
    assert.equal(input.getAttribute('aria-describedby'), 'app-dialog-message');
  } finally {
    rendered.cleanup();
  }
});

test('Dialog keyboard stays local while native editing keys remain available', () => {
  const backgroundKeys: string[] = [];
  const onBackgroundKey = (event: KeyboardEvent) => backgroundKeys.push(event.key);
  window.addEventListener('keydown', onBackgroundKey);
  const rendered = renderDialog(
    { kind: 'alert', title: 'Help', message: 'Details', confirmLabel: 'OK', resolve: () => {} },
    () => {},
  );
  try {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="app-dialog-primary"]')!;
    for (const key of ['p', 'o', 's', 'b', '1', ',', 'c', 'v', 'a']) {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => button.dispatchEvent(event));
      assert.equal(event.defaultPrevented, false, 'native editing defaults are preserved');
    }
    assert.deepEqual(backgroundKeys, []);
  } finally {
    rendered.cleanup();
    window.removeEventListener('keydown', onBackgroundKey);
  }
});

test('Prompt updates keep input focus and cancellation restores its opener', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let dialogs: ReturnType<typeof useAppDialog>;
  function Harness() {
    dialogs = useAppDialog();
    return (
      <>
        <button onClick={() => void dialogs.prompt({ title: 'Rename', message: 'File name' })}>
          Rename
        </button>
        <input aria-label="Editor" />
        <AppDialogHost
          dialog={dialogs.dialog}
          onClose={dialogs.closeDialog}
          onPromptValueChange={dialogs.updatePromptValue}
        />
      </>
    );
  }
  await act(async () => root.render(<Harness />));
  try {
    const opener = container.querySelector('button')!;
    act(() => {
      opener.focus();
      opener.click();
    });
    const input = container.querySelector<HTMLInputElement>('[data-testid="app-dialog-input"]')!;
    assert.ok(document.activeElement === input);
    act(() => dialogs.updatePromptValue('chapter'));
    assert.ok(document.activeElement === input);
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(container.querySelector('[role="dialog"]'), null);
    assert.ok(document.activeElement === opener, 'cancel returns focus to opener');

    act(() => opener.click());
    const editor = container.querySelector<HTMLInputElement>('[aria-label="Editor"]')!;
    act(() => {
      editor.focus();
      dialogs.closeDialog(null);
    });
    assert.ok(
      document.activeElement === editor,
      'closing must preserve an intentional focus transfer',
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('Concurrent dialogs preserve their order, input and individual results', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let dialogs: ReturnType<typeof useAppDialog>;
  const results: unknown[] = [];
  function Harness() {
    dialogs = useAppDialog();
    return (
      <>
        <button>Opener</button>
        <AppDialogHost
          dialog={dialogs.dialog}
          onClose={dialogs.closeDialog}
          onPromptValueChange={dialogs.updatePromptValue}
        />
      </>
    );
  }
  await act(async () => root.render(<Harness />));
  try {
    const opener = container.querySelector('button')!;
    opener.focus();
    act(() => {
      void dialogs
        .prompt({ title: 'Rename', message: 'Name' })
        .then((value) => results.push(value));
      void dialogs
        .alert({ title: 'Save failed', message: 'Retry later' })
        .then(() => results.push('acknowledged'));
      void dialogs
        .confirm({ title: 'Close project', message: 'Continue?' })
        .then((value) => results.push(value));
    });
    assert.equal(container.querySelector('h2')?.textContent, 'Rename');
    act(() => dialogs.updatePromptValue('chapter'));
    assert.equal(container.querySelector<HTMLInputElement>('input')?.value, 'chapter');
    await act(async () => dialogs.closeDialog('chapter'));
    assert.deepEqual(results, ['chapter']);
    assert.equal(container.querySelector('h2')?.textContent, 'Save failed');
    assert.ok(
      document.activeElement === container.querySelector('[data-testid="app-dialog-primary"]'),
    );
    await act(async () => dialogs.closeDialog());
    assert.deepEqual(results, ['chapter', 'acknowledged']);
    assert.equal(container.querySelector('h2')?.textContent, 'Close project');
    await act(async () => dialogs.closeDialog(false));
    assert.deepEqual(results, ['chapter', 'acknowledged', false]);
    assert.equal(container.querySelector('[role="dialog"]'), null);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
