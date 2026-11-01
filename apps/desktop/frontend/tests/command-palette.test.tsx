import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CommandPalette } from '../src/components/command-palette/CommandPalette';
import { ModalDialog } from '../src/components/ui';
import { REQUEST_EDITOR_COMMAND_EVENT } from '../src/lib/assistant-events';
import { invalidateFileSystemCache } from '../src/lib/host/tauri-fs';

const noop = () => {};

function paletteProps(projectPath: string | null) {
  return {
    mode: 'files' as const,
    projectPath,
    currentFile: null,
    onClose: noop,
    onOpenFile: noop,
    onOpenProject: noop,
    onInitializeProject: noop,
    onRefreshCanon: noop,
    onExportCurrent: noop,
    onToggleAssistant: noop,
    onToggleWorkspace: noop,
    onOpenSettings: noop,
    onFocusAssistantOnly: noop,
    onFocusWorkspaceOnly: noop,
    onRestoreLayout: noop,
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

  assert.ok(html.includes('补齐作品目录'));
  assert.ok(html.includes('已有的不动'));
});

test('command palette hides story project initialization before a project is open', () => {
  const html = renderCommands(null);

  assert.equal(html.includes('补齐作品目录'), false);
});

test('没开作品时文件面板的入口叫「打开本地作品…」', () => {
  const html = renderToStaticMarkup(React.createElement(CommandPalette, paletteProps(null)));

  assert.ok(html.includes('打开本地作品…'));
  assert.equal(html.includes('打开项目'), false);
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

    assert.match(container.textContent ?? '', /无法读取作品文件/);
    assert.equal((container.textContent ?? '').includes('无匹配项'), false);
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="palette-retry"]');
    assert.ok(retry);

    await act(async () => retry.click());

    assert.equal(calls, 2);
    assert.match(container.textContent ?? '', /正文[\\/]第一章\.md/);
  } finally {
    act(() => root.unmount());
    container.remove();
    window.__STORYFORGE_MOCK_FS__ = previousMock;
    invalidateFileSystemCache(projectPath);
  }
});

const PROJECT = 'D:\\书\\雾港回声';
const CHAPTER = 'D:\\书\\雾港回声\\正文\\第003章.md';

async function mountCommands(currentFile: string | null, calls: string[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(CommandPalette, {
        ...paletteProps(PROJECT),
        mode: 'commands',
        currentFile,
        onShowView: (view: string) => calls.push(`view:${view}`),
        fileActions: {
          onNewFile: async (dir: string) => void calls.push(`new:${dir}`),
          onRename: async (path: string, isDir: boolean) =>
            void calls.push(`rename:${path}:${isDir}`),
        },
        onNewSession: () => calls.push('session'),
        onReopenWelcome: noop,
        onToggleFontMode: noop,
        onCycleProseMeasure: noop,
        fontModeLabel: '',
        proseMeasureLabel: '',
      }),
    );
  });
  const titles = () =>
    [...container.querySelectorAll('[data-testid="palette-item"]')].map(
      (node) => node.textContent ?? '',
    );
  const click = async (title: string) => {
    const item = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="palette-item"]'),
    ].find((node) => node.textContent?.startsWith(title));
    assert.ok(item, title);
    await act(async () => item.click());
  };
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, titles, click, cleanup };
}

test('命令面板说作者的话：没有 Canon / dossier / 派生参考信号', async () => {
  const mounted = await mountCommands(CHAPTER, []);
  try {
    const text = mounted.container.textContent ?? '';
    for (const word of ['Canon', 'dossier', '派生参考信号', '初始化小说项目结构', '打开项目…']) {
      assert.equal(text.includes(word), false, word);
    }
    assert.ok(text.includes('打开本地作品…'));
    assert.ok(text.includes('刷新设定事实卡'));
  } finally {
    mounted.cleanup();
  }
});

test('命令面板能新建文件、改名、开版本历史、新建会话、打开左栏各视图', async () => {
  const calls: string[] = [];
  const commands: string[] = [];
  const onCommand = (event: Event) =>
    commands.push((event as CustomEvent<{ command: string }>).detail.command);
  window.addEventListener(REQUEST_EDITOR_COMMAND_EVENT, onCommand);
  const mounted = await mountCommands(CHAPTER, calls);
  try {
    const titles = mounted.titles();
    const views = [
      ['作品', 'B'],
      ['手稿', 'M'],
      ['资源管理器', 'E'],
      ['知识收件箱', 'I'],
      ['搜索', 'F'],
      ['观测镜', 'O'],
    ];
    for (const [label, key] of views) {
      assert.ok(
        titles.some(
          (title) => title.startsWith(`打开：${label}`) && title.endsWith(`Ctrl Shift ${key}`),
        ),
        label,
      );
    }
    assert.ok(
      titles.some((title) => title.startsWith('新建文件') && title.includes('在「正文」里')),
    );

    await mounted.click('新建文件');
    await mounted.click('重命名当前文件');
    await mounted.click('切换：版本历史');
    await mounted.click('新建会话');
    await mounted.click('打开：观测镜');
    assert.deepEqual(calls, [
      'new:D:\\书\\雾港回声\\正文',
      `rename:${CHAPTER}:false`,
      'session',
      'view:observatory',
    ]);
    assert.deepEqual(commands, ['toggle-history']);
  } finally {
    window.removeEventListener(REQUEST_EDITOR_COMMAND_EVENT, onCommand);
    mounted.cleanup();
  }
});

test('没开文件时新建落在作品根目录，不给改名和版本历史', async () => {
  const calls: string[] = [];
  const mounted = await mountCommands(null, calls);
  try {
    const titles = mounted.titles();
    assert.ok(
      titles.some((title) => title.startsWith('新建文件') && title.includes('在作品根目录')),
    );
    assert.equal(
      titles.some((title) => title.startsWith('重命名当前文件')),
      false,
    );
    assert.equal(
      titles.some((title) => title.startsWith('切换：版本历史')),
      false,
    );
    await mounted.click('新建文件');
    assert.deepEqual(calls, [`new:${PROJECT}`]);
  } finally {
    mounted.cleanup();
  }
});

test('输入法选字的回车不执行命令（全项目审计 E-14）；选完字再按回车才执行，组字中的 Esc 不关面板', async () => {
  const calls: string[] = [];
  let closed = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(CommandPalette, {
        ...paletteProps(PROJECT),
        mode: 'commands',
        onClose: () => {
          closed += 1;
        },
        onNewSession: () => calls.push('session'),
      }),
    );
  });
  try {
    const input = container.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '新建会话',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const press = (init: KeyboardEventInit) =>
      act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
      });
    await press({ key: 'Enter', isComposing: true });
    await press({ key: 'Enter', keyCode: 229 });
    await press({ key: 'Escape', isComposing: true });
    assert.deepEqual(calls, []);
    assert.equal(closed, 0);

    await press({ key: 'Enter' });
    assert.deepEqual(calls, ['session']);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

// 命令面板走 components/ui 的模态外壳：Esc、点外面、焦点回到打开前、和别的层叠放都归层管理。
async function mountPaletteHarness(extra: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const opener = document.createElement('button');
  opener.textContent = '打开面板前的焦点';
  document.body.appendChild(opener);
  opener.focus();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const events: string[] = [];
  let setOpen: (open: boolean) => void = noop;
  function Harness() {
    const [open, setOpenState] = React.useState(true);
    setOpen = setOpenState;
    return open
      ? React.createElement(CommandPalette, {
          ...paletteProps(PROJECT),
          mode: 'commands',
          onClose: () => {
            events.push('close');
            setOpenState(false);
          },
          ...extra,
        })
      : null;
  }
  await act(async () => root.render(React.createElement(Harness)));
  const press = (target: EventTarget, init: KeyboardEventInit) =>
    act(async () => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    });
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
    opener.remove();
  };
  return {
    container,
    opener,
    events,
    press,
    reopen: () => act(async () => setOpen(true)),
    cleanup,
  };
}

test('命令面板打开即聚焦输入框，Esc 由层管理关闭并把焦点还给打开前的位置', async () => {
  const mounted = await mountPaletteHarness();
  try {
    const input = mounted.container.querySelector('input')!;
    assert.equal(document.activeElement, input);
    const dialog = mounted.container.querySelector('[role="dialog"]')!;
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(dialog.getAttribute('aria-label'), '命令面板');
    assert.equal(mounted.opener.getAttribute('inert'), '', '模态打开时背景不可达');

    await mounted.press(input, { key: 'Escape' });
    assert.deepEqual(mounted.events, ['close']);
    assert.equal(mounted.container.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, mounted.opener);
    assert.equal(mounted.opener.hasAttribute('inert'), false);
  } finally {
    mounted.cleanup();
  }
});

test('命令面板点遮罩关闭，点面板里面不关', async () => {
  const mounted = await mountPaletteHarness();
  try {
    const dialog = mounted.container.querySelector('[role="dialog"]')!;
    await act(async () => {
      dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    assert.deepEqual(mounted.events, []);
    const backdrop = mounted.container.querySelector('[data-modal-backdrop]')!;
    await act(async () => {
      backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    assert.deepEqual(mounted.events, ['close']);
  } finally {
    mounted.cleanup();
  }
});

test('命令面板里 Tab 留在输入框，再按 Ctrl+P / Ctrl+Shift+P 切换文件与命令', async () => {
  const modes: string[] = [];
  const mounted = await mountPaletteHarness({ onModeChange: (mode) => modes.push(mode) });
  try {
    const input = mounted.container.querySelector('input')!;
    const tab = await mounted.press(input, { key: 'Tab' });
    assert.equal(tab.defaultPrevented, true);
    assert.equal(document.activeElement, input);
    for (const option of mounted.container.querySelectorAll<HTMLElement>('[role="option"]')) {
      assert.equal(option.tabIndex, -1);
    }

    await mounted.press(input, { key: 'p', ctrlKey: true });
    await mounted.press(input, { key: 'P', ctrlKey: true, shiftKey: true });
    assert.deepEqual(modes, ['files', 'commands']);
    assert.deepEqual(mounted.events, []);
  } finally {
    mounted.cleanup();
  }
});

test('命令面板上再叠一个弹窗：新弹窗在上层，Esc 先关上层，再关面板', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const closed: string[] = [];
  let openConfirm: () => void = noop;
  function Harness() {
    const [palette, setPalette] = React.useState(true);
    const [confirm, setConfirm] = React.useState(false);
    openConfirm = () => setConfirm(true);
    return React.createElement(
      React.Fragment,
      null,
      palette &&
        React.createElement(CommandPalette, {
          ...paletteProps(PROJECT),
          mode: 'commands',
          onClose: () => {
            closed.push('palette');
            setPalette(false);
          },
        }),
      confirm &&
        React.createElement(
          ModalDialog,
          {
            'aria-label': '确认',
            onClose: () => {
              closed.push('confirm');
              setConfirm(false);
            },
          },
          React.createElement('button', null, '好'),
        ),
    );
  }
  await act(async () => root.render(React.createElement(Harness)));
  try {
    await act(async () => openConfirm());
    const [paletteBackdrop, confirmBackdrop] = [
      ...container.querySelectorAll<HTMLElement>('[data-modal-backdrop]'),
    ];
    assert.ok(Number(confirmBackdrop.style.zIndex) > Number(paletteBackdrop.style.zIndex));
    assert.equal(document.activeElement?.textContent, '好');

    const escape = () =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      });
    await escape();
    assert.deepEqual(closed, ['confirm']);
    assert.equal(document.activeElement, container.querySelector('input'));
    await escape();
    assert.deepEqual(closed, ['confirm', 'palette']);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
