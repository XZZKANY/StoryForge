import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CommandPalette } from '../src/components/CommandPalette';
import { invalidateFileSystemCache } from '../src/lib/tauri-fs';

const noop = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function paletteProps(projectPath: string | null) {
  return {
    mode: 'files' as const,
    projectPath,
    currentFile: null,
    onClose: noop,
    onOpenFile: noop,
    onOpenProject: noop,
    onReopenWelcome: noop,
    onInitializeProject: noop,
    onRefreshCanon: noop,
    onExportCurrent: noop,
    onToggleAssistant: noop,
    onToggleWorkspace: noop,
    onOpenSettings: noop,
    onFocusAssistantOnly: noop,
    onFocusWorkspaceOnly: noop,
    onRestoreLayout: noop,
    onToggleFontMode: noop,
    onCycleProseMeasure: noop,
    fontModeLabel: '书稿',
    proseMeasureLabel: '适中',
  };
}

function renderCommands(projectPath: string | null) {
  return renderToStaticMarkup(
    React.createElement(CommandPalette, {
      mode: 'commands',
      projectPath,
      currentFile: null,
      onClose: () => {},
      onOpenFile: () => {},
      onOpenProject: () => {},
      onInitializeProject: () => {},
      onExportCurrent: () => {},
      onToggleAssistant: () => {},
      onToggleWorkspace: () => {},
      onOpenSettings: () => {},
      onFocusAssistantOnly: () => {},
      onFocusWorkspaceOnly: () => {},
      onRestoreLayout: () => {},
    }),
  );
}

test('command palette exposes story project initialization for active projects', () => {
  const html = renderCommands('D:\\StoryForge\\Books\\雾港回声');

  assert.ok(html.includes('初始化小说项目结构'));
  assert.ok(html.includes('雾港回声'));
});

test('命令面板将当前高亮项暴露给辅助技术', () => {
  const html = renderCommands('D:\\StoryForge\\Books\\雾港回声');

  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-controls="command-palette-options"/);
  assert.match(html, /aria-activedescendant="command-palette-commands-item-0"/);
  assert.match(
    html,
    /id="command-palette-commands-item-0"[^>]*role="option"[^>]*aria-selected="true"/,
  );
});

test('输入法确认候选或取消组合时不执行命令或关闭面板', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let opened = 0;
  let closed = 0;
  try {
    await act(async () =>
      root.render(
        <CommandPalette
          {...paletteProps(null)}
          mode="commands"
          onOpenProject={() => {
            opened += 1;
          }}
          onClose={() => {
            closed += 1;
          }}
        />,
      ),
    );
    const input = container.querySelector('input');
    assert.ok(input);
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
        const event = new KeyboardEvent('keydown', {
          ...init,
          key,
          bubbles: true,
          cancelable: true,
        });
        act(() => {
          input.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, false, `${key} 应交给输入法`);
      }
    }
    assert.equal(opened, 0);
    assert.equal(closed, 0);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.equal(opened, 1, '候选确认完成后，普通 Enter 仍执行命令');
    assert.equal(closed, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('命令面板消费模态快捷键，Escape 在面板内关闭', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let closed = 0;
  try {
    await act(async () =>
      root.render(
        <CommandPalette
          {...paletteProps(null)}
          mode="commands"
          onClose={() => {
            closed += 1;
          }}
        />,
      ),
    );
    const input = container.querySelector<HTMLInputElement>('input');
    assert.ok(input);

    const globalShortcut = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(globalShortcut));
    assert.equal(globalShortcut.cancelBubble, true);
    assert.equal(closed, 0);

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(escape));
    assert.equal(escape.defaultPrevented, true);
    assert.equal(closed, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('筛选结果收缩后高亮与 Enter 仍指向存活命令', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let selected = 0;
  try {
    await act(async () =>
      root.render(
        <CommandPalette
          {...paletteProps(null)}
          mode="commands"
          onOpenSettings={() => {
            selected += 1;
          }}
        />,
      ),
    );
    const input = container.querySelector<HTMLInputElement>('input');
    assert.ok(input);
    act(() => {
      for (let index = 0; index < 5; index += 1) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
        );
      }
      const setInputValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setInputValue?.call(input, '设置');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const item = container.querySelector<HTMLButtonElement>('[data-testid="palette-item"]');
    assert.ok(item);
    assert.match(item.className, /bg-accent/);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.equal(selected, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('command palette hides story project initialization before a project is open', () => {
  const html = renderCommands(null);

  assert.equal(html.includes('初始化小说项目结构'), false);
});

test('文件目录读取失败时显示错误与重试入口，而不是无匹配项', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const previousMock = window.__STORYFORGE_MOCK_FS__;
  const projectPath = 'D:\\StoryForge\\PaletteLoadError';
  let calls = 0;
  window.__STORYFORGE_MOCK_FS__ = {
    async listDir() {
      calls += 1;
      if (calls === 1) throw new Error('permission denied');
      return [
        {
          name: '第一章.md',
          path: `${projectPath}\\正文\\第一章.md`,
          isDir: false,
          size: 1,
          modified: 1,
          extension: 'md',
        },
      ];
    },
  };
  invalidateFileSystemCache(projectPath);

  try {
    await act(async () => {
      root.render(React.createElement(CommandPalette, paletteProps(projectPath)));
    });

    assert.match(container.textContent ?? '', /无法读取项目文件/);
    assert.equal((container.textContent ?? '').includes('无匹配项'), false);
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="palette-retry"]');
    assert.ok(retry);

    const input = container.querySelector('input');
    assert.ok(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    assert.equal(document.activeElement, retry);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      retry.dispatchEvent(enter);
    });
    assert.equal(enter.defaultPrevented, false, '重试按钮应保留原生 Enter 点击行为');
    act(() => {
      retry.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.equal(document.activeElement, input);

    retry.focus();
    await act(async () => retry.click());

    assert.equal(calls, 2);
    assert.equal(document.activeElement, input, '重试后继续从搜索框选择文件');
    assert.match(container.textContent ?? '', /正文[\\/]第一章\.md/);
  } finally {
    act(() => root.unmount());
    container.remove();
    window.__STORYFORGE_MOCK_FS__ = previousMock;
    invalidateFileSystemCache(projectPath);
  }
});

test('取消搜索后恢复入口焦点，执行命令转移的焦点不会被抢回', async () => {
  const trigger = document.createElement('button');
  const destination = document.createElement('button');
  document.body.append(trigger, destination);
  for (const transferFocus of [false, true]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    trigger.focus();
    try {
      await act(async () => root.render(<CommandPalette {...paletteProps(null)} />));
      assert.equal(document.activeElement, container.querySelector('input'));
      if (transferFocus) destination.focus();
      act(() => root.render(null));
      assert.equal(document.activeElement, transferFocus ? destination : trigger);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  }
  trigger.remove();
  destination.remove();
});
