import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useFileTreeActions } from '../src/components/app/useFileTreeActions';
import type { AppDialogApi } from '../src/components/app/AppDialog';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { emitToast } from '../src/lib/toast';

vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: { pathExists: vi.fn(), writeFile: vi.fn() },
}));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));

const mockedPathExists = vi.mocked(TauriFileSystem.pathExists);
const mockedWriteFile = vi.mocked(TauriFileSystem.writeFile);
const mockedToast = vi.mocked(emitToast);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:/连载/末世吞噬';
const DIR = `${PROJECT}/正文`;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({
  openFile,
  dialogs,
}: {
  openFile: (path: string, actionLabel?: string) => Promise<void>;
  dialogs: AppDialogApi;
}) {
  const actions = useFileTreeActions({
    activeProject: PROJECT,
    dialogs,
    openFile,
    dropOpenFilePath: () => {},
  });
  return (
    <button type="button" onClick={() => void actions.onNewFile(DIR)}>
      new
    </button>
  );
}

function dialogsReturning(input: string | null): AppDialogApi {
  return {
    alert: vi.fn(async () => {}),
    choose: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    prompt: vi.fn(async () => input),
  } as unknown as AppDialogApi;
}

beforeEach(() => {
  mockedPathExists.mockReset();
  mockedWriteFile.mockReset();
  mockedToast.mockReset();
});

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
});

test('新建文件同名时打开已有文件并提示「该文件已存在，已为你打开」', async () => {
  mockedPathExists.mockResolvedValue(true);
  const openFile = vi.fn(async () => {});
  const dialogs = dialogsReturning('第001章');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness openFile={openFile} dialogs={dialogs} />));

  await act(async () => container!.querySelector<HTMLButtonElement>('button')!.click());

  const target = `${DIR}/第001章.md`;
  assert.equal(openFile.mock.calls.length, 1);
  assert.deepEqual(openFile.mock.calls[0], [target, '打开已有文件']);
  // 冲突提示：作者不会误以为程序错乱地「打开了一个没让建的文件」。
  assert.equal(mockedToast.mock.calls.length, 1);
  assert.equal(mockedToast.mock.calls[0]?.[0], '该文件已存在，已为你打开');
  assert.equal(mockedToast.mock.calls[0]?.[1]?.tone ?? 'info', 'info');
  // 不能重复创建/覆盖已有文件。
  assert.equal(mockedWriteFile.mock.calls.length, 0);
});

test('目标路径不存在时才真正写文件并打开新文件，不发冲突 toast', async () => {
  mockedPathExists.mockResolvedValue(false);
  mockedWriteFile.mockResolvedValue(undefined);
  const openFile = vi.fn(async () => {});
  const dialogs = dialogsReturning('第002章');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness openFile={openFile} dialogs={dialogs} />));

  await act(async () => container!.querySelector<HTMLButtonElement>('button')!.click());

  const target = `${DIR}/第002章.md`;
  assert.equal(mockedWriteFile.mock.calls.length, 1);
  assert.deepEqual(mockedWriteFile.mock.calls[0]?.slice(0, 2), [PROJECT, target]);
  assert.equal(openFile.mock.calls.length, 1);
  assert.deepEqual(openFile.mock.calls[0], [target, '打开新文件']);
  assert.equal(mockedToast.mock.calls.length, 0);
});
