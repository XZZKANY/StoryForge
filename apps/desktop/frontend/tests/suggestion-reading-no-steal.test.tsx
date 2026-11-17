import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { emitFileSuggestion, reofferPendingFileSuggestion } from '../src/lib/assistant-events';
import { createRemoteFileSuggestion } from '../src/lib/assistant-suggestions';
import { READING_WINDOW_MS } from '../src/lib/editor-reading';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/components/editor/Editor', () => ({
  Editor: ({ filePath }: { filePath: string | null }) => (
    <div className="monaco-editor" data-testid="editor-probe" data-file={filePath ?? ''} />
  ),
}));
vi.mock('../src/components/chat-window/ChatWindow', () => ({ ChatWindow: () => null }));

const ROOT = 'D:/reading-test';
const chapter = (n: number) => `${ROOT}/正文/第${String(n).padStart(3, '0')}章.md`;

test('读着上一章时，等作者点头的新章修订不抢画面；点「打开」、点接受、免确认、没在读都照旧打开', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"detail":"offline test"}', { status: 503 })),
  );
  localStorage.clear();
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify([ROOT]));
  const toasts: ToastDetail[] = [];
  const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);
  window.addEventListener(TOAST_EVENT, onToast);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const shown = () =>
    host.querySelector<HTMLElement>('[data-testid="editor-probe"]')?.getAttribute('data-file');
  const openFile = async (path: string) =>
    act(async () => window.__STORYFORGE_SMOKE__?.openFile(path));
  const scrollEditor = async () =>
    act(async () =>
      host
        .querySelector('[data-testid="editor-probe"]')!
        .dispatchEvent(new Event('wheel', { bubbles: true })),
    );
  const propose = async (n: number, requiresConfirmation = true) => {
    const suggestion = createRemoteFileSuggestion({
      id: `patch-${n}`,
      filePath: chapter(n),
      before: '',
      after: `第${n}章正文`,
      summary: `起草第${n}章`,
      model: 'fixture',
      userIntent: `写第${n}章`,
      requiresConfirmation,
    });
    await act(async () => emitFileSuggestion(suggestion));
    return suggestion;
  };
  try {
    await act(async () => root.render(<App />));
    await act(async () =>
      Array.from(host.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('reading-test'))!
        .click(),
    );
    await openFile(chapter(2));
    expect(shown()).toBe(chapter(2));

    // 读着第二章，第三章写好了：不切走，通知里点「打开」才过去。
    await scrollEditor();
    await propose(3);
    expect(shown()).toBe(chapter(2));
    const notice = toasts.at(-1)!;
    expect(notice.message).toContain('正文/第003章.md');
    expect(notice.action?.label).toBe('打开');
    await act(async () => notice.action!.run());
    expect(shown()).toBe(chapter(3));

    // 在对话里点接受（编辑器没接住，补发一次）：作者自己要看，照样打开。
    await openFile(chapter(2));
    await scrollEditor();
    const fifth = await propose(5);
    expect(shown()).toBe(chapter(2));
    await act(async () => {
      reofferPendingFileSuggestion({ patchId: fifth.id, filePath: fifth.filePath });
    });
    expect(shown()).toBe(chapter(5));

    // 免确认的修订（自动档、/写）要在编辑器里写进文件：读着也照旧打开。
    await openFile(chapter(2));
    await scrollEditor();
    const toastCount = toasts.length;
    await propose(4, false);
    expect(shown()).toBe(chapter(4));
    expect(toasts.length).toBe(toastCount);

    // 一分钟没碰编辑器，算在干等：照旧打开。
    await openFile(chapter(2));
    await scrollEditor();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + READING_WINDOW_MS);
    await propose(6);
    expect(shown()).toBe(chapter(6));
  } finally {
    window.removeEventListener(TOAST_EVENT, onToast);
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
