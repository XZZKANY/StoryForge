import { longManuscript } from './support/long-manuscript';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { afterAll } from 'vitest';
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

const metrics: Record<string, unknown>[] = [];
it.each(
  [10000, 50000, 100000].flatMap((size) =>
    (['paragraphs', 'blank-dialogue', 'one-line'] as const).flatMap((shape) =>
      ['selected', 'whole'].map((scope) => ({ size, shape, scope })),
    ),
  ),
)('actual Ctrl+K $scope revision and accept for $size / $shape', async ({ size, shape, scope }) => {
  const before = longManuscript(size, shape);
  const lines = before.split('\n');
  let index = Math.floor(lines.length / 2);
  while (index > 0 && !lines[index]) index--;
  model = makeModel(before);
  position.lineNumber = scope === 'whole' ? 1 : index + 1;
  selectionEndLine = scope === 'whole' ? lines.length : null;
  let expected = before;
  let sentSize = 0;
  fetchMock.mockImplementationOnce(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    sentSize = payload.content.length;
    const input = payload.content.split('\n');
    if (scope === 'whole') {
      expected = lines.map((line) => (line ? '修订：' + line : line)).join('\n');
      return Response.json({ after: expected, model: 'fixture', assistant_session_id: 71 });
    }
    const marker = before.split('\n')[index];
    // Index is authoritative; never replace the first equal sentence in a repeated manuscript.
    const match = payload.instruction.match(/本次 content 第 (\d+)–/);
    input[Number(match[1]) - 1] = '这次她没有再等，抬手关上了门。';
    const target = [...lines];
    target[index] = '这次她没有再等，抬手关上了门。';
    expected = target.join('\n');
    expect(marker.length).toBeGreaterThan(0);
    return Response.json({ after: input.join('\n'), model: 'fixture', assistant_session_id: 71 });
  });
  await mount();
  const start = performance.now();
  await send(await open('revise'), '只修改授权行，其他行逐字保留');
  const generationMs = performance.now() - start;
  expect(zones.querySelector('.sf-inline-btn-accept')).not.toBeNull();
  expect(model.getValue()).toBe(before);
  expect(writeback).not.toHaveBeenCalled();
  const nodes = zones.querySelectorAll('*').length;
  const acceptStart = performance.now();
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback).toHaveBeenCalledTimes(1);
  expect(writeback.mock.calls[0]).toEqual([
    expect.objectContaining({ before, after: expected }),
    FILE,
    before,
    expected,
    expect.objectContaining({ recoveredSettlementGuard: expect.any(Function) }),
  ]);
  metrics.push({
    size,
    shape,
    scope,
    sentSize,
    fixtureResponseAndRenderMs: generationMs,
    acceptIncludingTestWaitMs: performance.now() - acceptStart,
    domNodes: nodes,
  });
});

it.each(['cancel', 'edit'] as const)(
  '100k delayed response after %s cannot render or write stale candidate',
  async (kind) => {
    const before = longManuscript(100000, 'paragraphs');
    model = makeModel(before);
    position.lineNumber = 1;
    const delayed = deferred<Response>();
    fetchMock.mockImplementationOnce(() => delayed.promise);
    await mount();
    await send(await open('revise'), '只修开头');
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    const inputBody = body();
    await act(async () => {
      if (kind === 'cancel')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else model.setValue('作者新写的开头\n' + before);
    });
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      delayed.resolve(
        Response.json({
          after: '过期候选\n' + inputBody.content,
          model: 'fixture',
          assistant_session_id: 71,
        }),
      ),
    );
    expect(zones.querySelector('.sf-inline-btn-accept')).toBeNull();
    expect(writeback).not.toHaveBeenCalled();
    expect(model.getValue()).toBe(kind === 'cancel' ? before : '作者新写的开头\n' + before);
  },
);

afterAll(() => {
  const target = process.env.STORYFORGE_LONG_HOOK_METRICS;
  if (target)
    writeFileSync(
      target,
      JSON.stringify(
        {
          runtime:
            'Production useInlineChat + happy-dom + Monaco/HTTP/writer boundary adapters; not browser or native rendering',
          metrics,
        },
        null,
        2,
      ),
    );
});

it.each([
  { size: 100000, status: 504, detail: '模型读取超时' },
  { size: 120001, status: 422, detail: '正文超过 120000 字符限制' },
])(
  'HTTP$status for $size-character draft preserves author instruction for manual retry',
  async ({ size, status, detail }) => {
    const before = longManuscript(size, 'one-line');
    model = makeModel(before);
    position.lineNumber = 1;
    const instruction = '保留人物、地点和指定台词，不改变因果。'.repeat(30);
    fetchMock.mockResolvedValueOnce(Response.json({ detail }, { status }));
    await mount();
    await send(await open('revise'), instruction);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writeback).not.toHaveBeenCalled();
    expect(model.getValue()).toBe(before);
    expect(host.textContent).toContain(detail);
    const restored = zones.querySelector<HTMLTextAreaElement>('.sf-inline-chat__textarea');
    expect(restored).not.toBeNull();
    expect(restored?.value).toBe(instruction);
  },
);

it('held Enter after restored generation failure must not automatically retry', async () => {
  model = makeModel(longManuscript(10000, 'paragraphs'));
  position.lineNumber = 1;
  fetchMock.mockImplementation(async () =>
    Response.json({ detail: '暂时不可用' }, { status: 503 }),
  );
  await mount();
  await send(await open('revise'), '保留原事实，只修措辞');
  const restored = zones.querySelector<HTMLTextAreaElement>('.sf-inline-chat__textarea')!;
  expect(restored).not.toBeNull();
  await act(async () =>
    restored.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }),
    ),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(writeback).not.toHaveBeenCalled();
});

it.each(['cancel', 'new-file'] as const)(
  'late HTTP failure after %s never reopens or overwrites original instruction',
  async (kind) => {
    const before = longManuscript(100000, 'paragraphs');
    model = makeModel(before);
    position.lineNumber = 1;
    const delayed = deferred<Response>();
    fetchMock.mockImplementationOnce(() => delayed.promise);
    await mount();
    await send(await open('revise'), 'A的原始长指令');
    let newer: HTMLTextAreaElement | null = null;
    if (kind === 'cancel')
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      );
    else {
      fileRef.current = PROJECT + '/正文/另一个文件.md';
      model = makeModel('B的正文');
      position.lineNumber = 1;
      await act(async () => root.render(<Harness file={fileRef.current!} />));
      newer = await open('revise');
      newer.value = 'B的新指令';
    }
    await act(async () => delayed.resolve(Response.json({ detail: 'A超时' }, { status: 504 })));
    expect(writeback).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('A超时');
    if (kind === 'cancel') expect(zones.querySelector('textarea')).toBeNull();
    else {
      expect(newer!.isConnected).toBe(true);
      expect(newer!.value).toBe('B的新指令');
      expect(zones.querySelectorAll('textarea')).toHaveLength(1);
    }
  },
);

it('review: failed generation retries original anchor after selection moves', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ detail: 'fixture failure' }, { status: 504 }));
  await mount();
  await send(await open('revise'), '原始作者要求');
  const restored = zones.querySelector<HTMLTextAreaElement>('textarea');
  expect(restored).not.toBeNull();
  expect(restored!.value).toBe('原始作者要求');
  position = { lineNumber: 3, column: 1 };
  fetchMock.mockResolvedValueOnce(
    Response.json({
      after: '越界首段。\n修改中段。\n越界尾段。',
      model: 'fixture',
      assistant_session_id: 71,
    }),
  );
  await send(restored!, '原始作者要求');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(body().instruction).toContain('原稿第 2–2 行');
  await act(async () => {
    zones.querySelector<HTMLButtonElement>('.sf-inline-btn-accept')!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(writeback.mock.calls[0][3]).toBe('首段。\n修改中段。\n尾段。');
});

it('review: restored input callbacks cannot send after Escape', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ detail: 'fixture failure' }, { status: 422 }));
  await mount();
  await send(await open('revise'), '保留这个要求');
  const restored = zones.querySelector<HTMLTextAreaElement>('textarea');
  expect(restored).not.toBeNull();
  await act(async () =>
    restored!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  await send(restored!, '过期输入');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(writeback).not.toHaveBeenCalled();
  expect(zones.querySelector('textarea')).toBeNull();
});

it('review: typing invalidates restored candidate input without stale resubmit', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ detail: 'fixture failure' }, { status: 504 }));
  await mount();
  await send(await open('revise'), '保留这个要求');
  const restored = zones.querySelector<HTMLTextAreaElement>('textarea');
  expect(restored).not.toBeNull();
  await act(async () => model.setValue('作者的新稿'));
  await send(restored!, '过期输入');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(model.getValue()).toBe('作者的新稿');
  expect(zones.querySelector('textarea')).toBeNull();
});

it('review: repeated failed retries have one request per Enter and restore same user text', async () => {
  fetchMock.mockImplementation(async () =>
    Response.json({ detail: 'fixture failure' }, { status: 504 }),
  );
  await mount();
  let input = await open('revise');
  for (let attempt = 1; attempt <= 3; attempt++) {
    await send(input, '原始作者要求');
    expect(fetchMock).toHaveBeenCalledTimes(attempt);
    input = zones.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('原始作者要求');
  }
  expect(writeback).not.toHaveBeenCalled();
});

it('422 restored instruction is editable and submits only the shortened manual retry', async () => {
  const raw = '  原始的多项要求\n保留结尾  ';
  fetchMock.mockResolvedValueOnce(Response.json({ detail: '请调整请求要求' }, { status: 422 }));
  await mount();
  await send(await open('revise'), raw);
  const input = zones.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(input.value).toBe(raw);
  fetchMock.mockResolvedValueOnce(
    Response.json({ after: BEFORE, model: 'fixture', assistant_session_id: 71 }),
  );
  await send(input, '只改措辞');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(body().instruction.startsWith('只改措辞\n\n')).toBe(true);
  expect(body().instruction).not.toContain('原始的多项要求');
  expect(writeback).not.toHaveBeenCalled();
});
