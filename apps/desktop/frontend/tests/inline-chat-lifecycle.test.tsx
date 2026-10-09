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
let selectionEndLine: number | null;
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

it('A01/A06 oversized author request is refused before fetch and remains editable', async () => {
  await mount();
  const input = await open('revise');
  const instruction = '改'.repeat(4050) + '逐字保留「中段。」';
  await send(input, instruction);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(model.getValue()).toBe(BEFORE);
  expect(writeback).not.toHaveBeenCalled();
  expect(input.isConnected).toBe(true);
  expect(input.value).toBe(instruction);
  expect(host.textContent).toContain('指令过长');
  expect(host.textContent).toContain('缩短');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(status).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(
    Response.json({ after: BEFORE, model: 'fixture', assistant_session_id: 71 }),
  );
  await send(input, '不要改动中段。');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(body().instruction).toContain('不要改动中段。');
});

it('A01/A04 the serialized request preserves a long mixed-language author request and final protection', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ after: BEFORE, model: 'fixture', assistant_session_id: 71 }),
  );
  await mount();
  const instruction = '中En😀'.repeat(800) + '逐字保留「中段。」';
  await send(await open('revise'), instruction);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(body().instruction.startsWith(instruction + '\n\n')).toBe(true);
  expect(body().instruction).toContain('原稿第 2–2 行；本次 content 第 2–2 行');
  expect(Array.from(body().instruction).length).toBeLessThanOrEqual(4000);
  expect(model.getValue()).toBe(BEFORE);
  expect(writeback).not.toHaveBeenCalled();
});

it('A06 an oversized stale submit cannot consume or replace an existing inline proposal', async () => {
  const after = '首段。\n改好中段。\n尾段。';
  fetchMock.mockResolvedValueOnce(
    Response.json({ after, model: 'fixture', assistant_session_id: 71 }),
  );
  await mount();
  const input = await open('revise');
  await send(input, '只改中段');
  const proposal = zones.innerHTML;
  fetchMock.mockClear();
  await send(input, '改'.repeat(4050) + '逐字保留「中段。」');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(writeback).not.toHaveBeenCalled();
  expect(model.getValue()).toBe(BEFORE);
  expect(zones.innerHTML).toBe(proposal);
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).toHaveBeenCalledTimes(1);
  expect(writeback.mock.calls[0]).toEqual([
    expect.objectContaining({ before: BEFORE, after, userIntent: '只改中段' }),
    FILE,
    BEFORE,
    after,
    expect.objectContaining({ recoveredSettlementGuard: expect.any(Function) }),
  ]);
});

it('A02 a long selection is complete in the actual content, not paid for twice in the instruction', async () => {
  const selected = ('中文 English 😀。'.repeat(250) + '\n').repeat(3).trimEnd();
  model = makeModel('前文。\n' + selected + '\n尾段。\n');
  position.lineNumber = 2;
  selectionEndLine = 4;
  fetchMock.mockResolvedValueOnce(
    Response.json({ after: model.getValue(), model: 'fixture', assistant_session_id: 71 }),
  );
  await mount();
  await send(await open('revise'), '只改错字');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(body().content).toBe(model.getValue());
  expect(body().content).toContain(selected);
  expect(body().instruction).toContain('原稿第 2–4 行；本次 content 第 2–4 行');
  expect(body().instruction).toContain('摘录已缩短');
  expect(Array.from(body().instruction).length).toBeLessThanOrEqual(4000);
});

it('A03 second identical occurrence is identified relative to the window and only its line reaches writeback', async () => {
  const before = '# 标题\n' + '前'.repeat(3500) + '\n同一句。\n隔段。\n同一句。\n尾段。\n';
  model = makeModel(before);
  position.lineNumber = 5;
  selectionEndLine = 5;
  // Simulate model drift into the first occurrence as well as the authorized one.
  fetchMock.mockResolvedValueOnce(
    Response.json({
      after: '错误第一处。\n隔段。\n改好第二处。\n尾段。\n',
      model: 'fixture',
      assistant_session_id: 71,
    }),
  );
  await mount();
  await send(await open('revise'), '写紧一点');
  expect(body().content).toBe('同一句。\n隔段。\n同一句。\n尾段。\n');
  expect(body().instruction).toContain('原稿第 5–5 行；本次 content 第 3–3 行');
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).toHaveBeenCalledTimes(1);
  const expected = before.replace('隔段。\n同一句。', '隔段。\n改好第二处。');
  expect(writeback.mock.calls[0]).toEqual([
    expect.objectContaining({ before, after: expected }),
    FILE,
    before,
    expected,
    expect.objectContaining({ recoveredSettlementGuard: expect.any(Function) }),
  ]);
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
    expect.objectContaining({ recoveredSettlementGuard: expect.any(Function) }),
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

it('failed writeback retains the same proposal and reuses its identity without another model request', async () => {
  writeback.mockRejectedValueOnce(new Error('snapshot unavailable'));
  await mount();
  await send(await open());
  const accept = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!;
  await act(async () => {
    accept.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(accept.isConnected).toBe(true);
  expect(accept.disabled).toBe(false);
  expect(accept.textContent).toContain('重试');
  expect(zones.querySelector('[aria-busy="true"]')).toBeNull();
  expect(zones.querySelector('.sf-inline-diff-zone--settling')).toBeNull();
  expect(model.getValue()).toBe(BEFORE);
  const first = writeback.mock.calls[0];
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).toHaveBeenCalledTimes(2);
  expect(writeback.mock.calls[1]).toEqual(first);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
});

it('pending write locks decisions; acknowledged model updates do not report false stale failure', async () => {
  const completion = deferred<{ writebackWarning: undefined }>();
  writeback.mockImplementationOnce(() => completion.promise);
  await mount();
  await send(await open());
  const accept = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!;
  const reject = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-reject')!;
  await act(async () => {
    accept.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(accept.disabled).toBe(true);
  expect(reject.disabled).toBe(true);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }),
    );
    model.setValue('首段。\n中段。\n\n新增段。\n尾段。');
  });
  expect(accept.isConnected).toBe(true);
  expect(writeback).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain('稿件已变化');
  await act(async () => completion.resolve({ writebackWarning: undefined }));
  expect(accept.isConnected).toBe(false);
  expect(host.textContent).toContain('已写回');
});

it('typing during a failed write invalidates the proposal rather than offering stale retry', async () => {
  let fail!: (reason: Error) => void;
  writeback.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await mount();
  await send(await open());
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    model.setValue('作者等待时写下的新稿。');
    fail(new Error('snapshot unavailable'));
  });
  expect(model.getValue()).toBe('作者等待时写下的新稿。');
  expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
  expect(writeback).toHaveBeenCalledTimes(1);
});

it.each(['click', 'shortcut'] as const)(
  'selection ending at next line column one protects that line via %s',
  async (method) => {
    await mount();
    // Monaco's end coordinate is exclusive: this contains only 中段 and its newline.
    editorRef.current!.getSelection = () =>
      ({
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 3,
        endColumn: 1,
        isEmpty: () => false,
      }) as Monaco.Selection;
    model.getValueInRange = () => '中段。\n';
    const modelAfter = '首段。\n改好中段。\n越界尾段。';
    fetchMock.mockResolvedValueOnce(
      Response.json({ after: modelAfter, model: 'fixture', assistant_session_id: 71 }),
    );
    await send(await open('revise'), '只改选中的中段，尾段逐字保留');
    expect.soft(body().instruction).toContain('原稿第 2–2 行；本次 content 第 2–2 行');
    await act(async () => {
      if (method === 'click')
        zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
      else
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }),
        );
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(writeback).toHaveBeenCalledTimes(1);
    expect(writeback.mock.calls[0]).toEqual([
      expect.objectContaining({ before: BEFORE, after: '首段。\n改好中段。\n尾段。' }),
      FILE,
      BEFORE,
      '首段。\n改好中段。\n尾段。',
      expect.objectContaining({ recoveredSettlementGuard: expect.any(Function) }),
    ]);
  },
);

it.each([
  { start: 2, end: 2, endColumn: 3, expected: '2–2' },
  { start: 2, end: 3, endColumn: 2, expected: '2–3' },
  { start: 1, end: 3, endColumn: 1, expected: '1–2' },
])(
  'selection range $start:$end:$endColumn preserves each genuinely selected line',
  async ({ start, end, endColumn, expected }) => {
    await mount();
    editorRef.current!.getSelection = () =>
      ({
        startLineNumber: start,
        startColumn: 1,
        endLineNumber: end,
        endColumn,
        isEmpty: () => false,
      }) as Monaco.Selection;
    model.getValueInRange = () => '选中文字';
    fetchMock.mockResolvedValueOnce(
      Response.json({ after: BEFORE, model: 'fixture', assistant_session_id: 71 }),
    );
    await send(await open('revise'), '保留原文');
    expect(body().instruction).toContain(`原稿第 ${expected} 行；本次 content 第 ${expected} 行`);
    expect(writeback).not.toHaveBeenCalled();
  },
);

it('cancel then reopen uses the new exclusive range and ignores an older generated response', async () => {
  await mount();
  let selectedEnd = 3;
  editorRef.current!.getSelection = () =>
    ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: selectedEnd,
      endColumn: 1,
      isEmpty: () => false,
    }) as Monaco.Selection;
  model.getValueInRange = () => (selectedEnd === 3 ? '首段。\n中段。\n' : '首段。\n');
  const older = deferred<Response>();
  fetchMock.mockImplementationOnce(() => older.promise);
  await send(await open('revise'), '旧范围');
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  selectedEnd = 2;
  fetchMock.mockResolvedValueOnce(
    Response.json({
      after: '新首段。\n越界中段。\n尾段。',
      model: 'fixture',
      assistant_session_id: 72,
    }),
  );
  await send(await open('revise'), '只改新选中的首段');
  expect(body().instruction).toContain('原稿第 1–1 行；本次 content 第 1–1 行');
  await act(async () =>
    older.resolve(
      Response.json({
        after: '旧首段。\n旧中段。\n尾段。',
        model: 'old-fixture',
        assistant_session_id: 71,
      }),
    ),
  );
  expect(zones.textContent).toContain('新首段。');
  expect(zones.textContent).not.toContain('旧首段。');
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).toHaveBeenCalledTimes(1);
  expect(writeback.mock.calls[0]).toEqual([
    expect.objectContaining({
      before: BEFORE,
      after: '新首段。\n中段。\n尾段。',
      assistantSessionId: 72,
    }),
    FILE,
    BEFORE,
    '新首段。\n中段。\n尾段。',
    expect.objectContaining({ recoveredSettlementGuard: expect.any(Function) }),
  ]);
});

it.each(['backward', 'newline-only'] as const)(
  '%s selection excludes an untouched next line',
  async (kind) => {
    await mount();
    editorRef.current!.getSelection = () =>
      ({
        startLineNumber: 2,
        startColumn: kind === 'newline-only' ? '中段。'.length + 1 : 1,
        endLineNumber: 3,
        endColumn: 1,
        selectionStartLineNumber: kind === 'backward' ? 3 : 2,
        selectionStartColumn: kind === 'backward' ? 1 : '中段。'.length + 1,
        positionLineNumber: kind === 'backward' ? 2 : 3,
        positionColumn: 1,
        isEmpty: () => false,
      }) as Monaco.Selection;
    model.getValueInRange = () => (kind === 'newline-only' ? '\n' : '中段。\n');
    fetchMock.mockResolvedValueOnce(
      Response.json({
        after: '首段。\n中段。\n越界尾段。',
        model: 'fixture',
        assistant_session_id: 71,
      }),
    );
    await send(await open('revise'), '检查选中处，不改相邻正文');
    expect(body().instruction).toContain('原稿第 2–2 行；本次 content 第 2–2 行');
    expect(writeback).not.toHaveBeenCalled();
    expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
    expect(model.getValue()).toBe(BEFORE);
  },
);

it.each([false, true])(
  'Ctrl+A whole document with terminal newline=%s respects touched-line scope',
  async (terminalNewline) => {
    const before = BEFORE + (terminalNewline ? '\n' : '');
    model = makeModel(before);
    position.lineNumber = 1;
    await mount();
    editorRef.current!.getSelection = () =>
      ({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: terminalNewline ? 4 : 3,
        endColumn: terminalNewline ? 1 : '尾段。'.length + 1,
        isEmpty: () => false,
      }) as Monaco.Selection;
    model.getValueInRange = () => before;
    const candidate = '新首段。\n中段。\n尾段。';
    fetchMock.mockResolvedValueOnce(
      Response.json({ after: candidate, model: 'fixture', assistant_session_id: 71 }),
    );
    await send(await open('revise'), '调整首段，其他正文保留');
    expect(body().instruction).toContain('原稿第 1–3 行；本次 content 第 1–3 行');
    await act(async () => {
      zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const expected = candidate + (terminalNewline ? '\n' : '');
    expect(writeback).toHaveBeenCalledTimes(1);
    expect(writeback.mock.calls[0]).toEqual([
      expect.objectContaining({ before, after: expected }),
      FILE,
      before,
      expected,
      expect.objectContaining({ recoveredSettlementGuard: expect.any(Function) }),
    ]);
  },
);

it('empty document Ctrl+A is empty selection and Ctrl+K makes no request', async () => {
  model = makeModel('');
  position.lineNumber = 1;
  await mount();
  editorRef.current!.getSelection = () =>
    ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
      isEmpty: () => true,
    }) as Monaco.Selection;
  await act(async () => commands.get(5)?.());
  expect(zones.querySelector('textarea')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(writeback).not.toHaveBeenCalled();
  expect(host.textContent).toContain('先选中要改的文字');
});

it('partial-character selection retains existing touched-line authorization rather than claiming character-exact scope', async () => {
  await mount();
  editorRef.current!.getSelection = () =>
    ({
      startLineNumber: 2,
      startColumn: 2,
      endLineNumber: 2,
      endColumn: 3,
      isEmpty: () => false,
    }) as Monaco.Selection;
  model.getValueInRange = () => '段';
  const candidate = '首段。\n替换整行。\n越界尾段。';
  fetchMock.mockResolvedValueOnce(
    Response.json({ after: candidate, model: 'fixture', assistant_session_id: 71 }),
  );
  await send(await open('revise'), '调整选中文字所在行，其他行保留');
  expect(body().instruction).toContain('原稿第 2–2 行；本次 content 第 2–2 行');
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  const expected = '首段。\n替换整行。\n尾段。';
  expect(writeback).toHaveBeenCalledTimes(1);
  expect(writeback.mock.calls[0]).toEqual([
    expect.objectContaining({ before: BEFORE, after: expected }),
    FILE,
    BEFORE,
    expected,
    expect.objectContaining({ recoveredSettlementGuard: expect.any(Function) }),
  ]);
});

it('相同路径与正文但模型实例已替换时拒绝旧候选', async () => {
  await mount();
  await send(await open());
  const staleAccept = zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!;
  model = makeModel(BEFORE);
  await act(async () => {
    for (const listener of modelListeners) listener();
    staleAccept.click();
  });
  expect(writeback).not.toHaveBeenCalled();
  expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
});

it.each([null, FILE + '.renamed'])('接受动效期间目标变为 %s 时不进入写回', async (destination) => {
  await mount();
  await send(await open());
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    fileRef.current = destination;
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).not.toHaveBeenCalled();
});

it('旧写回延迟失败不会关闭新文件输入框', async () => {
  let fail!: (error: Error) => void;
  writeback.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await mount();
  await send(await open());
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).toHaveBeenCalledTimes(1);
  const nextFile = FILE + '.other';
  await act(async () => {
    fileRef.current = nextFile;
    model = makeModel('新文件正文。');
    position = { lineNumber: 1, column: 1 };
    root.render(<Harness file={nextFile} />);
  });
  const newInput = await open('revise');
  await act(async () => fail(new Error('old snapshot failed')));
  expect(newInput.isConnected).toBe(true);
  expect(newInput.disabled).toBe(false);
  expect(model.getValue()).toBe('新文件正文。');
  expect(host.textContent).not.toContain('old snapshot failed');
});

it('切文件中止请求且迟到响应不能替换新输入框', async () => {
  await mount();
  const pending = deferred<Response>();
  fetchMock.mockImplementationOnce(() => pending.promise);
  await send(await open('revise'), '原文件指令');
  const signal = fetchMock.mock.calls[0][1]?.signal;
  const nextFile = FILE + '.other';
  await act(async () => {
    fileRef.current = nextFile;
    model = makeModel('新文件正文。');
    position = { lineNumber: 1, column: 1 };
    root.render(<Harness file={nextFile} />);
  });
  expect(signal?.aborted).toBe(true);
  const nextInput = await open('revise');
  await act(async () =>
    pending.resolve(
      Response.json({ after: '旧文件返回内容', model: 'old', assistant_session_id: 1 }),
    ),
  );
  expect(nextInput.isConnected).toBe(true);
  expect(zones.textContent).not.toContain('旧文件返回内容');
  expect(writeback).not.toHaveBeenCalled();
});

it('模型替换后的迟到写回成功不会移动新光标', async () => {
  const completed = deferred<{ writebackWarning: undefined }>();
  writeback.mockImplementationOnce(() => completed.promise);
  await mount();
  await send(await open());
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  await act(async () => {
    model = makeModel(BEFORE);
    for (const listener of modelListeners) listener();
    completed.resolve({ writebackWarning: undefined });
  });
  expect(editorRef.current!.setPosition).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('已写回');
});
