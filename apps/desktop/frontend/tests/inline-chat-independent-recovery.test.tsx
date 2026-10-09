// Independent safety stress harness, reusing the repository's Monaco adapter boundary.
import { performReceiptedWriteback } from '../src/lib/writeback-receipts';
import type { WritebackReceipt } from '../src/lib/writeback-receipt-types';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as Monaco from 'monaco-editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useInlineChat } from '../src/components/editor/useInlineChat';
import { invalidateFileSystemCache } from '../src/lib/tauri-fs';

vi.mock('monaco-editor', () => ({
  KeyMod: { CtrlCmd: 1, Shift: 2 },
  KeyCode: { KeyK: 4 },
  Range: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  editor: { EditorOption: { fontInfo: 1, lineHeight: 2 } },
}));
vi.mock('../src/lib/api/config', () => ({
  getApiConfig: async () => ({ baseUrl: 'http://inline.test', apiKey: 'fixture-key' }),
  trimApiBaseUrl: (url: string) => url,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const PROJECT = 'D:/Books/inline-a';
const FILE = `${PROJECT}/正文/第02章.md`;
const BEFORE = '首段。\n中段。\n尾段。';
const fetchMock = vi.fn<typeof fetch>();
let root: Root;
let host: HTMLDivElement;
let zones: HTMLDivElement;
let model: ReturnType<typeof makeModel>;
let fileRef: { current: string | null };
let projectRef: { current: string | null };
let editorRef: { current: Monaco.editor.IStandaloneCodeEditor | null };
let commands: Map<number, () => void>;
let position: { lineNumber: number; column: number };
let selectionEndLine: number | null;
let frames: FrameRequestCallback[];
let modelListeners: Set<() => void>;
let contentListeners: Set<() => void>;
const writeback = vi.fn(async (..._args: unknown[]) => ({
  writebackWarning: undefined as string | undefined,
}));
const status = vi.fn();

function makeModel(value = BEFORE) {
  let version = 1;
  return {
    getValue: () => value,
    setValue: (next: string) => {
      value = next;
      version += 1;
      for (const listener of contentListeners) listener();
    },
    getVersionId: () => version,
    getAlternativeVersionId: () => version,
    getLineContent: (line: number) => value.split('\n')[line - 1] ?? '',
    getValueInRange: () =>
      value
        .split('\n')
        .slice(position.lineNumber - 1, selectionEndLine ?? position.lineNumber)
        .join('\n'),
  };
}

function Harness({ file = FILE }: { file?: string }) {
  useInlineChat({
    editorRef,
    editorReady: true,
    filePath: file,
    filePathRef: fileRef,
    projectPathRef: projectRef,
    projectName: 'fixture',
    writeAcceptedSuggestion: writeback,
    setSuggestionStatus: status,
  });
  return null;
}

function sseDone(id = 71) {
  return new Response(
    `event: done\ndata: ${JSON.stringify({ text: '新增段。', model: 'fixture', assistant_session_id: id })}\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

async function mount() {
  await act(async () => root.render(<Harness />));
}

async function open(mode: 'continue' | 'revise' = 'continue') {
  await act(async () => commands.get(mode === 'continue' ? 7 : 5)?.());
  const input = zones.querySelector('textarea');
  expect(input).not.toBeNull();
  return input!;
}

async function send(input: HTMLTextAreaElement, instruction = '') {
  await act(async () => {
    input.value = instruction;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

beforeEach(() => {
  frames = [];
  modelListeners = new Set();
  contentListeners = new Set();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  localStorage.clear();
  window.__STORYFORGE_MOCK_FS__ = { listDir: () => [], readFile: () => '' };
  invalidateFileSystemCache();
  host = document.createElement('div');
  zones = document.createElement('div');
  zones.className = 'view-zones';
  zones.setAttribute('aria-hidden', 'true');
  host.append(zones);
  document.body.append(host);
  root = createRoot(document.createElement('div'));
  commands = new Map();
  model = makeModel();
  position = { lineNumber: 2, column: 1 };
  selectionEndLine = null;
  fileRef = { current: FILE };
  projectRef = { current: PROJECT };
  const zoneNodes = new Map<string, HTMLElement>();
  let nextZone = 0;
  const adapter = {
    getValue: () => model.getValue(),
    getModel: () => model,
    getSelection: () => ({
      startLineNumber: position.lineNumber,
      endLineNumber: selectionEndLine ?? position.lineNumber,
      isEmpty: () => selectionEndLine === null,
    }),
    getOption: (option: number) => (option === 1 ? { fontFamily: 'fixture' } : 22),
    getContainerDomNode: () => zones,
    addCommand: (key: number, callback: () => void) => commands.set(key, callback),
    onDidChangeCursorPosition: () => ({ dispose: () => {} }),
    onDidChangeModel: (listener: () => void) => {
      modelListeners.add(listener);
      return { dispose: () => modelListeners.delete(listener) };
    },
    onDidChangeModelContent: (listener: () => void) => {
      contentListeners.add(listener);
      return { dispose: () => contentListeners.delete(listener) };
    },
    changeViewZones: (change: (accessor: Monaco.editor.IViewZoneChangeAccessor) => void) =>
      change({
        addZone: (zone) => {
          const id = String(++nextZone);
          zoneNodes.set(id, zone.domNode);
          zones.append(zone.domNode);
          return id;
        },
        removeZone: (id) => {
          zoneNodes.get(id)?.remove();
          zoneNodes.delete(id);
        },
        layoutZone: () => {},
      }),
    createDecorationsCollection: () => ({ clear: () => {} }),
    focus: vi.fn(),
    setPosition: vi.fn(),
    revealLineInCenterIfOutsideViewport: vi.fn(),
  };
  // Monaco is the rendering boundary, not the business seam: only its consumed
  // methods are supplied. The real hook, DOM handlers, context and HTTP run below.
  editorRef = { current: adapter as unknown as Monaco.editor.IStandaloneCodeEditor };
  fetchMock.mockReset().mockImplementation(async () => sseDone());
  vi.stubGlobal('fetch', fetchMock);
  writeback.mockReset().mockResolvedValue({ writebackWarning: undefined });
  status.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.__STORYFORGE_MOCK_FS__;
  invalidateFileSystemCache();
  vi.unstubAllGlobals();
});

async function acceptCurrent() {
  const button = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept');
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

function receipt(state: WritebackReceipt['state'] = 'applied'): WritebackReceipt {
  return {
    operationId: 'a'.repeat(64),
    state,
    current: state === 'applied' ? 'after' : 'before',
    checkpointTimestamp: 7,
    createdFile: false,
    receiptPersisted: true,
  };
}

it('independent: snapshot failure retains the same candidate identity for a safe manual retry', async () => {
  const ids: string[] = [];
  let nativeWrites = 0;
  let snapshots = 0;
  let stored: WritebackReceipt | null = null;
  writeback.mockImplementation(async (...args: unknown[]) => {
    ids.push((args[0] as { id: string }).id);
    await performReceiptedWriteback(true, {
      inspect: async () => stored,
      validate: () => {},
      snapshot: async () => {
        snapshots += 1;
        if (snapshots === 1) throw new Error('snapshot unavailable');
        return { timestamp: 7 };
      },
      advanceBranchHead: async () => {},
      write: async () => {
        nativeWrites += 1;
        stored = receipt();
        return stored;
      },
      settle: () => {},
      record: async () => null,
    });
    return { writebackWarning: undefined };
  });
  await mount();
  await send(await open());
  await acceptCurrent();
  expect(nativeWrites).toBe(0);
  expect(zones.textContent).toContain('新增段。');
  await acceptCurrent();
  expect(nativeWrites).toBe(1);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('independent: unknown receipt is never rewritten when the preserved candidate is retried', async () => {
  const ids: string[] = [];
  let nativeWrites = 0;
  let stored: WritebackReceipt | null = null;
  writeback.mockImplementation(async (...args: unknown[]) => {
    ids.push((args[0] as { id: string }).id);
    await performReceiptedWriteback(true, {
      inspect: async () => stored,
      validate: () => {},
      snapshot: async () => ({ timestamp: 7 }),
      advanceBranchHead: async () => {},
      write: async () => {
        nativeWrites += 1;
        stored = receipt('outcome_unknown');
        throw new Error('invoke response lost');
      },
      settle: () => {},
      record: async () => null,
    });
    return { writebackWarning: undefined };
  });
  await mount();
  await send(await open());
  await acceptCurrent();
  expect(nativeWrites).toBe(1);
  await acceptCurrent();
  expect(nativeWrites).toBe(1);
  expect(ids[0]).toBe(ids[1]);
  expect(model.getValue()).toBe(BEFORE);
  expect(host.textContent).toContain('未知');
});

it('independent: lost response with applied receipt settles once and does not offer another apply', async () => {
  let stored: WritebackReceipt | null = null;
  let nativeWrites = 0;
  writeback.mockImplementation(async () => {
    const result = await performReceiptedWriteback(true, {
      inspect: async () => stored,
      validate: () => {},
      snapshot: async () => ({ timestamp: 7 }),
      advanceBranchHead: async () => {},
      write: async () => {
        nativeWrites += 1;
        stored = receipt();
        throw new Error('response lost after commit');
      },
      settle: () => {},
      record: async () => null,
    });
    expect(result.recovered).toBe(true);
    return { writebackWarning: undefined };
  });
  await mount();
  await send(await open());
  await acceptCurrent();
  expect(nativeWrites).toBe(1);
  expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }),
  );
  expect(nativeWrites).toBe(1);
});

it('independent: post-commit audit warning settles and never presents candidate as unaccepted', async () => {
  writeback.mockResolvedValueOnce({
    writebackWarning: '正文已写入，但闭环记录未完成；不要重新应用补丁。',
  });
  await mount();
  await send(await open());
  await acceptCurrent();
  expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
  expect(host.textContent).toContain('正文已写入');
  expect(writeback).toHaveBeenCalledTimes(1);
});

it('independent: pending write cancellation cannot resurrect old proposal over a newer input', async () => {
  let reject!: (error: Error) => void;
  writeback.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await mount();
  await send(await open());
  await acceptCurrent();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  const newer = await open();
  await act(async () => reject(new Error('late write failure')));
  expect(newer.isConnected).toBe(true);
  expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
  expect(host.textContent).not.toContain('late write failure');
});

it('independent: typing after a failed write invalidates preserved candidate instead of overwriting edits', async () => {
  writeback.mockRejectedValueOnce(new Error('snapshot unavailable'));
  await mount();
  await send(await open());
  await acceptCurrent();
  const oldAccept = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept');
  expect(oldAccept).not.toBeNull();
  await act(async () => {
    model.setValue('作者新写的正文');
    oldAccept!.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(writeback).toHaveBeenCalledTimes(1);
  expect(model.getValue()).toBe('作者新写的正文');
});
