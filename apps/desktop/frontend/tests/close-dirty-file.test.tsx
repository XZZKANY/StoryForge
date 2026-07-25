/**
 * 关闭脏页签的三选一：保存并关闭 / 放弃修改 / 继续编辑。
 *
 * 最要命的不变量是「保存并…」的出现条件——保存走 REQUEST_SAVE_ACTIVE_FILE，
 * 编辑器只认当前激活的文件，别的文件一律 skipped 直接放行。所以只要目标不是当前
 * 显示的文件，就绝不能给「保存」这个选项，否则点了等于静默丢稿。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test } from 'vitest';

import { useEditorWorkspaceTabs } from '../src/components/app/useEditorWorkspaceTabs';
import {
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
} from '../src/lib/assistant-events';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'D:\\连载\\末世吞噬\\正文\\第001章.md';
const B = 'D:\\连载\\末世吞噬\\正文\\第002章.md';

type DialogCall =
  | { kind: 'confirm'; message: string }
  | { kind: 'choose'; message: string; choiceIds: string[] }
  | { kind: 'alert'; title: string };

type TabsApi = ReturnType<typeof useEditorWorkspaceTabs>;

/** 装一个假编辑器：只对「当前激活文件」的保存请求回 saved，其余回 skipped（与真 Editor 同构）。 */
function installFakeEditor(activeFile: string | null, outcome: 'saved' | 'error' = 'saved') {
  const saved: string[] = [];
  const onRequest = (event: Event) => {
    const detail = (event as CustomEvent<{ filePath: string }>).detail;
    const isActive = detail?.filePath === activeFile;
    if (isActive && outcome === 'saved') saved.push(detail.filePath);
    window.dispatchEvent(
      new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
        detail: {
          filePath: detail?.filePath ?? null,
          status: !isActive ? 'skipped' : outcome,
          message: outcome === 'error' ? '磁盘只读' : undefined,
        },
      }),
    );
  };
  window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequest);
  return {
    saved,
    dispose: () => window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequest),
  };
}

function mountTabs(pick: string | null) {
  const calls: DialogCall[] = [];
  const dialogs = {
    alert: (options: { title: string; message: string }) => {
      calls.push({ kind: 'alert', title: options.title });
      return Promise.resolve();
    },
    confirm: (options: { message: string }) => {
      calls.push({ kind: 'confirm', message: options.message });
      return Promise.resolve(true);
    },
    choose: (options: {
      message: string;
      choices: ReadonlyArray<{ id: string; label: string }>;
    }) => {
      calls.push({
        kind: 'choose',
        message: options.message,
        choiceIds: options.choices.map((choice) => choice.id),
      });
      return Promise.resolve(pick);
    },
    prompt: () => Promise.resolve(null),
  };

  let api: TabsApi | null = null;
  function Probe() {
    // currentFile 在真实壳子里由 useProjectWorkspace 持有、经 selectFile 更新；
    // 这里同样用 state 承接，否则 displayedFile 永远停在初值，测不出「后台脏文件」这条分支。
    const [currentFile, setCurrentFile] = React.useState<string | null>(null);
    api = useEditorWorkspaceTabs({
      activeProject: 'D:\\连载\\末世吞噬',
      currentFile,
      selectProject: () => {},
      selectFile: setCurrentFile,
      closeFile: () => setCurrentFile(null),
      removeProject: () => {},
      dialogs,
      onShowEditor: () => {},
    });
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(Probe)));

  return {
    calls,
    get api() {
      if (!api) throw new Error('tabs hook not mounted');
      return api;
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** 打开 A、把它标脏，并（可选）再打开 B 让 A 退居后台。 */
function openAndDirty(harness: ReturnType<typeof mountTabs>, alsoOpen?: string) {
  act(() => void harness.api.openFile(A));
  act(() => harness.api.handleEditorDirtyChange(A, true));
  if (alsoOpen) act(() => void harness.api.openFile(alsoOpen));
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('脏文件正是当前显示的文件 → 给三选一，选「保存」先落盘再关闭', async () => {
  const editor = installFakeEditor(A);
  const harness = mountTabs('save');
  try {
    openAndDirty(harness);
    assert.equal(harness.api.displayedFile, A);

    await act(async () => {
      await harness.api.handleFileClose(A);
    });

    assert.deepEqual(harness.calls, [
      { kind: 'choose', message: '第001章.md 有未保存修改。', choiceIds: ['save', 'discard'] },
    ]);
    assert.deepEqual(editor.saved, [A], '选保存必须真的落盘');
    assert.deepEqual(harness.api.openFiles, []);
  } finally {
    harness.cleanup();
    editor.dispose();
  }
});

test('脏文件不是当前显示的文件 → 不给「保存」选项（给了也存不下，等于静默丢稿）', async () => {
  const editor = installFakeEditor(B);
  const harness = mountTabs('save');
  try {
    openAndDirty(harness, B);
    assert.equal(harness.api.displayedFile, B, 'B 才是当前显示的文件');

    await act(async () => {
      await harness.api.handleFileClose(A);
    });

    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0]?.kind, 'confirm', '后台脏文件只能走「放弃 / 继续编辑」二选一');
    assert.deepEqual(editor.saved, []);
  } finally {
    harness.cleanup();
    editor.dispose();
  }
});

test('选「放弃修改」不落盘，直接关掉', async () => {
  const editor = installFakeEditor(A);
  const harness = mountTabs('discard');
  try {
    openAndDirty(harness);

    await act(async () => {
      await harness.api.handleFileClose(A);
    });

    assert.deepEqual(editor.saved, []);
    assert.deepEqual(harness.api.openFiles, []);
  } finally {
    harness.cleanup();
    editor.dispose();
  }
});

test('Esc / 继续编辑（null）不关页签，脏态保留', async () => {
  const editor = installFakeEditor(A);
  const harness = mountTabs(null);
  try {
    openAndDirty(harness);

    await act(async () => {
      await harness.api.handleFileClose(A);
    });

    assert.deepEqual(editor.saved, []);
    assert.deepEqual(harness.api.openFiles, [A], '取消就该原样留着');
    assert.ok(harness.api.dirtyFiles.has(A));
  } finally {
    harness.cleanup();
    editor.dispose();
  }
});

test('保存失败就不关：报错后页签与脏态原样留着，不让稿子随页签一起消失', async () => {
  const editor = installFakeEditor(A, 'error');
  const harness = mountTabs('save');
  try {
    openAndDirty(harness);

    await act(async () => {
      await harness.api.handleFileClose(A);
    });

    assert.equal(harness.calls.at(-1)?.kind, 'alert');
    assert.deepEqual(harness.api.openFiles, [A]);
    assert.ok(harness.api.dirtyFiles.has(A));
  } finally {
    harness.cleanup();
    editor.dispose();
  }
});

test('Ctrl+S 挂在全局 keydown 上——焦点不在编辑器里也能存（此前只是 Monaco 内部命令，是死键）', () => {
  const source = readFileSync('src/App.tsx', 'utf8');
  // 指纹护栏：真正渲染 App 需要整套 Tauri / sidecar 桩，这里只钉住「全局分支存在且指向落盘」。
  assert.match(source, /if \(key === 's'\)/);
  assert.match(source, /flushActiveEditorToDisk\(tabs\.displayedFile\)/);
  // 没打开文件时必须先返回，否则 preventDefault 会把浏览器/webview 的默认行为一并吞掉。
  assert.match(source, /if \(!tabs\.displayedFile\) return;\s*\n\s*event\.preventDefault\(\)/);
});
