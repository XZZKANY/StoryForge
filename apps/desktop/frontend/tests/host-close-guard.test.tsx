/**
 * 关窗先问未保存（AUD-01）：宿主广播 close-requested 后，前端先回声、再走与关页签同一套
 * 「保存并退出 / 放弃修改 / 继续编辑」，作者的决定原样交回宿主；没挂守卫或回不了声时宿主自己退出。
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useEditorWorkspaceTabs } from '../src/components/app/useEditorWorkspaceTabs';
import {
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
} from '../src/lib/assistant-events';
import { useHostCloseGuard } from '../src/lib/host-close';

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => undefined),
  handler: null as null | ((event: { payload: number }) => void),
  unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: number }) => void) => {
    if (event === 'storyforge:close-requested') bridge.handler = handler;
    return bridge.unlisten;
  }),
}));
vi.mock('../src/lib/tauri-env', () => ({ isTauriRuntime: () => true }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'D:\\连载\\末世吞噬\\正文\\第001章.md';
const calls = (command: string) =>
  bridge.invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);

let cleanup: (() => void) | null = null;
beforeEach(() => {
  bridge.invoke.mockClear();
  bridge.unlisten.mockClear();
  bridge.handler = null;
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
}

async function requestClose(request: number) {
  await vi.waitFor(() => expect(bridge.handler).not.toBeNull());
  await act(async () => bridge.handler!({ payload: request }));
}

it('挂上守卫才告诉宿主；收到关窗先回声，作者放行才交回 proceed', async () => {
  let answer!: (value: boolean) => void;
  const confirm = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
  function Probe() {
    useHostCloseGuard(confirm);
    return null;
  }
  render(<Probe />);
  await vi.waitFor(() => expect(calls('arm_close_guard')).toEqual([{ armed: true }]));

  await requestClose(7);
  expect(calls('acknowledge_close_request')).toEqual([{ request: 7 }]);
  expect(calls('resolve_close_request')).toEqual([]);

  // 框还开着时作者又点了一次关闭：只回声，不叠第二个框。
  await requestClose(7);
  expect(calls('acknowledge_close_request')).toHaveLength(2);
  expect(confirm).toHaveBeenCalledOnce();

  await act(async () => answer(false));
  expect(calls('resolve_close_request')).toEqual([{ request: 7, proceed: false }]);

  cleanup!();
  cleanup = null;
  expect(bridge.unlisten).toHaveBeenCalledOnce();
  expect(calls('arm_close_guard')).toEqual([{ armed: true }, { armed: false }]);
});

it('确认过程出错就不关，免得把稿关没', async () => {
  function Probe() {
    useHostCloseGuard(() => Promise.reject(new Error('dialog failed')));
    return null;
  }
  render(<Probe />);
  await requestClose(3);
  await vi.waitFor(() =>
    expect(calls('resolve_close_request')).toEqual([{ request: 3, proceed: false }]),
  );
});

function installFakeEditor(activeFile: string) {
  const saved: string[] = [];
  const onRequest = (event: Event) => {
    const detail = (event as CustomEvent<{ filePath: string; requestId?: number }>).detail;
    const isActive = detail?.filePath === activeFile;
    if (isActive) saved.push(detail.filePath);
    window.dispatchEvent(
      new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
        detail: {
          filePath: detail?.filePath ?? null,
          requestId: detail?.requestId,
          canClose: isActive ? () => true : undefined,
          status: isActive ? 'saved' : 'skipped',
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
  const choose = vi.fn(
    async (_options: { message: string; choices: ReadonlyArray<{ id: string; label: string }> }) =>
      pick,
  );
  const dialogs = {
    alert: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    choose,
    prompt: vi.fn(async () => null),
  };
  let api: ReturnType<typeof useEditorWorkspaceTabs> | null = null;
  function Probe() {
    const [currentFile, setCurrentFile] = React.useState<string | null>(null);
    api = useEditorWorkspaceTabs({
      activeProject: 'D:\\连载\\末世吞噬',
      currentFile,
      selectProject: () => {},
      selectFile: setCurrentFile,
      closeFile: () => setCurrentFile(null),
      removeProject: () => {},
      dialogs: dialogs as never,
      onShowEditor: () => {},
    });
    return null;
  }
  render(<Probe />);
  return { choose, api: () => api! };
}

it('正文有未保存修改时关窗：问「保存并退出」，选了先落盘再放行', async () => {
  const editor = installFakeEditor(A);
  try {
    const tabs = mountTabs('save');
    act(() => void tabs.api().openFile(A));
    act(() => tabs.api().handleEditorDirtyChange(A, true));

    await requestClose(1);
    await vi.waitFor(() =>
      expect(calls('resolve_close_request')).toEqual([{ request: 1, proceed: true }]),
    );
    expect(tabs.choose.mock.calls[0]![0].choices.map((choice) => choice.label)).toEqual([
      '保存并退出',
      '放弃修改',
    ]);
    expect(editor.saved).toEqual([A]);
  } finally {
    editor.dispose();
  }
});

it('选「继续编辑」不关窗；没有未保存修改时不弹框直接放行', async () => {
  const tabs = mountTabs(null);
  act(() => void tabs.api().openFile(A));
  await requestClose(1);
  await vi.waitFor(() =>
    expect(calls('resolve_close_request')).toEqual([{ request: 1, proceed: true }]),
  );
  expect(tabs.choose).not.toHaveBeenCalled();

  act(() => tabs.api().handleEditorDirtyChange(A, true));
  await requestClose(2);
  await vi.waitFor(() =>
    expect(calls('resolve_close_request')).toEqual([
      { request: 1, proceed: true },
      { request: 2, proceed: false },
    ]),
  );
  expect(tabs.choose).toHaveBeenCalledOnce();
});
