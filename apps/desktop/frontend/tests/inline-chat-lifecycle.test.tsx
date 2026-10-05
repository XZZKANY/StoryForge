import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as Monaco from 'monaco-editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useInlineChat } from '../src/components/editor/useInlineChat';
import { invalidateFileSystemCache } from '../src/lib/tauri-fs';
import { writeAgentPermissionProfile } from '../src/lib/agent-permission';

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
let frames: FrameRequestCallback[];
let modelListeners: Set<() => void>;
let contentListeners: Set<() => void>;
const writeback = vi.fn(async () => ({ writebackWarning: undefined }));
const status = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

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
    getValueInRange: () => '中段。',
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

function holdIndex() {
  const gate = deferred<[]>();
  window.__STORYFORGE_MOCK_FS__!.listDir = () => gate.promise;
  return gate;
}

function body() {
  return JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
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
  fileRef = { current: FILE };
  projectRef = { current: PROJECT };
  const zoneNodes = new Map<string, HTMLElement>();
  let nextZone = 0;
  const adapter = {
    getValue: () => model.getValue(),
    getModel: () => model,
    getSelection: () => ({
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      isEmpty: () => true,
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
  writeback.mockClear();
  status.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.__STORYFORGE_MOCK_FS__;
  invalidateFileSystemCache();
  vi.unstubAllGlobals();
});

it('mounted shortcut delivers original middle cursor, suffix and project, without writing', async () => {
  await mount();
  await send(await open());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(body()).toMatchObject({
    project_root: PROJECT,
    file_path: FILE,
    cursor_line: 2,
    content: BEFORE,
  });
  expect(zones.textContent).toContain('新增段。');
  expect(zones.querySelector('.sf-inline-btn-accept')).not.toBeNull();
  expect(writeback).not.toHaveBeenCalled();
});

it.each(['project', 'model', 'content'])(
  '%s drift during context collection does not dispatch stale generation',
  async (kind) => {
    await mount();
    const gate = holdIndex();
    await send(await open());
    if (kind === 'project') projectRef.current = 'D:/Books/inline-b';
    else if (kind === 'model') model = makeModel();
    else model.setValue('作者新段。\n' + BEFORE);
    await act(async () => gate.resolve([]));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(zones.querySelector('.sf-inline-diff-zone--streaming')).toBeNull();
  },
);

it('opening in A then changing refs to B before input dispatch cannot combine B identity and A anchor', async () => {
  await mount();
  const input = await open();
  projectRef.current = 'D:/Books/inline-b';
  fileRef.current = 'D:/Books/inline-b/正文/第09章.md';
  model = makeModel('B正文。');
  await send(input);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(zones.querySelector('textarea')).toBeNull();
});

it.each(['file-switch', 'unmount', 'cancel'])(
  '%s aborts the actual in-flight request signal',
  async (kind) => {
    await mount();
    const response = deferred<Response>();
    fetchMock.mockImplementation(() => response.promise);
    await send(await open());
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    if (kind === 'file-switch') {
      fileRef.current = `${PROJECT}/正文/第03章.md`;
      await act(async () => root.render(<Harness file={fileRef.current!} />));
    } else if (kind === 'unmount') await act(async () => root.render(null));
    else await act(async () => zones.querySelector('button')?.click());
    expect(signal?.aborted).toBe(true);
    await act(async () => response.resolve(sseDone()));
    expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
    expect(writeback).not.toHaveBeenCalled();
  },
);

it('late result after project change is not rendered or attributed to B', async () => {
  await mount();
  const response = deferred<Response>();
  fetchMock.mockImplementationOnce(() => response.promise);
  await send(await open());
  projectRef.current = 'D:/Books/inline-b';
  await act(async () => root.render(<Harness />));
  await act(async () => response.resolve(sseDone(71)));
  expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
  fileRef.current = 'D:/Books/inline-b/正文/第09章.md';
  model = makeModel();
  await act(async () => root.render(<Harness file={fileRef.current!} />));
  await send(await open());
  expect(body().assistant_session_id).toBeNull();
});

it('late input focus frame after cancellation does not steal focus from author navigation', async () => {
  await mount();
  const input = await open();
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  const navigation = document.createElement('button');
  host.append(navigation);
  navigation.focus();
  const staleFocus = vi.spyOn(input, 'focus');
  await act(async () => frames.shift()?.(0));
  expect(staleFocus).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(navigation);
});

it.each(['before-send', 'during-collection'])(
  'permission revoked %s prevents shortcut generation',
  async (kind) => {
    await mount();
    const gate = kind === 'during-collection' ? holdIndex() : null;
    const input = await open();
    if (kind === 'before-send') writeAgentPermissionProfile(PROJECT, 'read');
    await send(input);
    if (gate) {
      writeAgentPermissionProfile(PROJECT, 'read');
      await act(async () => gate.resolve([]));
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(zones.querySelector('.sf-inline-diff-zone--streaming')).toBeNull();
  },
);

it.each(['continue', 'revise'] as const)(
  '%s keeps a completed session only within its captured project',
  async (mode) => {
    fetchMock.mockImplementation(async () =>
      mode === 'continue'
        ? sseDone(71)
        : Response.json({
            after: '首段。\n改好中段。\n尾段。',
            model: 'fixture',
            assistant_session_id: 71,
          }),
    );
    await mount();
    await send(await open(mode), mode === 'revise' ? '改中段' : '');
    expect(body().assistant_session_id).toBeNull();
    expect(zones.querySelector('.sf-inline-btn-accept')).not.toBeNull();
    await send(await open(mode), mode === 'revise' ? '再改中段' : '');
    expect(body().assistant_session_id).toBe(71);
    projectRef.current = 'D:/Books/inline-b';
    fileRef.current = 'D:/Books/inline-b/正文/第09章.md';
    model = makeModel();
    await act(async () => root.render(<Harness file={fileRef.current!} />));
    await send(await open(mode), mode === 'revise' ? '改B中段' : '');
    expect(body()).toMatchObject({
      project_root: projectRef.current,
      file_path: fileRef.current,
      assistant_session_id: null,
    });
    expect(writeback).not.toHaveBeenCalled();
  },
);

it('a detached input callback cannot submit an instruction into a newly opened session', async () => {
  await mount();
  const oldInput = await open();
  const currentInput = await open();
  await send(oldInput, '旧请求不应发送');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(currentInput.isConnected).toBe(true);
  await send(currentInput, '新请求');
  expect(body().instruction).toBe('新请求');
});

it('a detached accept button cannot apply a later proposal', async () => {
  await mount();
  await send(await open());
  const oldAccept = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!;
  await send(await open(), '另一个提案');
  await act(async () => {
    oldAccept.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).not.toHaveBeenCalled();
  expect(zones.querySelector('.sf-inline-btn-accept')).not.toBeNull();
});

it.each(['model', 'content'])(
  '%s changed after input opened invalidates the anchored request before any reads',
  async (kind) => {
    await mount();
    const input = await open();
    const list = vi.fn(() => []);
    window.__STORYFORGE_MOCK_FS__!.listDir = list;
    if (kind === 'model') model = makeModel();
    else model.setValue('新第一段。\n' + BEFORE);
    await send(input);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  },
);

it.each(['model', 'content'])(
  '%s event aborts a hanging generation immediately rather than waiting for provider output',
  async (kind) => {
    await mount();
    const response = deferred<Response>();
    fetchMock.mockImplementation(() => response.promise);
    await send(await open());
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    await act(async () => {
      if (kind === 'model') {
        model = makeModel();
        for (const listener of modelListeners) listener();
      } else model.setValue('作者自己写的新稿。');
    });
    expect(signal?.aborted).toBe(true);
    expect(zones.querySelector('.sf-inline-diff-zone--streaming')).toBeNull();
    await act(async () => response.resolve(sseDone()));
    expect(writeback).not.toHaveBeenCalled();
  },
);

it('cancelled context collection cannot consume or settle a newly opened request', async () => {
  await mount();
  const gate = holdIndex();
  await send(await open(), '旧请求');
  await act(async () => zones.querySelector('button')?.click());
  const nextInput = await open();
  await act(async () => gate.resolve([]));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(nextInput.isConnected).toBe(true);
  await send(nextInput, '新请求');
  expect(body().instruction).toBe('新请求');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('detached input cancel and proposal reject cannot close a newer input', async () => {
  await mount();
  const oldInput = await open();
  await send(oldInput);
  const oldReject = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-reject')!;
  const current = await open();
  await act(async () => {
    oldInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    oldReject.click();
  });
  expect(current.isConnected).toBe(true);
  await send(current);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('SSE delta and done after project switch cannot render or seed the new session', async () => {
  await mount();
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  fetchMock.mockImplementationOnce(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            output = controller;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  await send(await open());
  await act(async () =>
    output.enqueue(encoder.encode('event: delta\ndata: {"text":"旧流片段"}\n\n')),
  );
  expect(zones.textContent).toContain('旧流片段');
  projectRef.current = 'D:/Books/inline-b';
  fileRef.current = 'D:/Books/inline-b/正文/第09章.md';
  model = makeModel();
  await act(async () => root.render(<Harness file={fileRef.current!} />));
  const current = await open();
  await act(async () => {
    output.enqueue(encoder.encode('event: delta\ndata: {"text":"迟到旧流"}\n\n'));
    output.enqueue(
      encoder.encode(
        'event: done\ndata: {"text":"旧结算。","model":"fixture","assistant_session_id":88}\n\n',
      ),
    );
    output.close();
  });
  expect(current.isConnected).toBe(true);
  expect(host.textContent).not.toContain('迟到旧流');
  expect(host.textContent).not.toContain('旧结算');
  await send(current);
  expect(body().assistant_session_id).toBeNull();
});

it('accepting a current continuation hands the original target and intact suffix to the guarded owner exactly once', async () => {
  await mount();
  await send(await open());
  const accept = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!;
  await act(async () => {
    accept.click();
    accept.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).toHaveBeenCalledTimes(1);
  expect(writeback.mock.calls[0]).toEqual([
    expect.objectContaining({
      filePath: FILE,
      before: BEFORE,
      after: '首段。\n中段。\n\n新增段。\n尾段。',
    }),
    FILE,
    BEFORE,
    '首段。\n中段。\n\n新增段。\n尾段。',
  ]);
});

it('project change during accept settlement blocks writeback even when manuscript bytes match', async () => {
  await mount();
  await send(await open());
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    projectRef.current = 'D:/Books/inline-b';
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).not.toHaveBeenCalled();
});

it('late writeback completion cannot move the cursor or announce success in another project', async () => {
  await mount();
  const completed = deferred<{ writebackWarning: undefined }>();
  writeback.mockImplementationOnce(() => completed.promise);
  await send(await open());
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).toHaveBeenCalledTimes(1);
  projectRef.current = 'D:/Books/inline-b';
  await act(async () => {
    root.render(<Harness />);
    completed.resolve({ writebackWarning: undefined });
  });
  expect(editorRef.current!.setPosition).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('已写回');
});

it('interactive input, loading and diff expose the Monaco zone host until dismissal', async () => {
  await mount();
  const input = await open();
  expect(zones.getAttribute('aria-hidden')).toBe('false');
  const response = deferred<Response>();
  fetchMock.mockImplementationOnce(() => response.promise);
  await send(input);
  expect(zones.getAttribute('aria-hidden')).toBe('false');
  await act(async () => response.resolve(sseDone()));
  expect(zones.getAttribute('aria-hidden')).toBe('false');
  await act(async () => zones.querySelector<HTMLButtonElement>('.sf-inline-btn-reject')!.click());
  expect(zones.getAttribute('aria-hidden')).toBe('true');
});

it.each([null, 'false', 'true'])(
  'closing restores the original Monaco host attribute %s',
  async (original) => {
    if (original === null) zones.removeAttribute('aria-hidden');
    else zones.setAttribute('aria-hidden', original);
    await mount();
    const input = await open();
    expect(zones.getAttribute('aria-hidden')).toBe('false');
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(zones.getAttribute('aria-hidden')).toBe(original);
  },
);
