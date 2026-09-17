import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { APP_SETTINGS_KEY, DEFAULT_APP_SETTINGS, loadAppSettings } from '../src/lib/user-settings';
import { APPLY_FILE_SUGGESTION_EVENT } from '../src/lib/assistant-events';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Probe({ kind, filePath }: { kind: string; filePath?: string | null }) {
  const [count, setCount] = useState(0);
  return (
    <button
      data-testid={`${kind}-probe`}
      data-file={filePath}
      onClick={() => setCount((value) => value + 1)}
    >
      {kind}:{count}
    </button>
  );
}
vi.mock('../src/components/Editor', () => ({
  Editor: ({ filePath }: { filePath: string | null }) => (
    <Probe kind="editor" filePath={filePath} />
  ),
}));
vi.mock('../src/components/ChatWindow', () => ({
  ChatWindow: ({
    onAgentRunSummaryChange,
  }: {
    onAgentRunSummaryChange?: (summary: {
      projectPath: string;
      status: 'running' | 'waiting' | 'paused';
      goal: string;
    }) => void;
  }) => (
    <>
      <Probe kind="agent" />
      <button
        data-testid="agent-run-trigger"
        onClick={() =>
          onAgentRunSummaryChange?.({
            projectPath: 'D:/overview-test',
            status: 'running',
            goal: '检查当前章节',
          })
        }
      />
    </>
  ),
}));

test('总览释放主区并保留编辑器、Agent、作品表单；导航和同文件补丁事件返回可见工作台', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"detail":"offline test"}', { status: 503 })),
  );
  localStorage.clear();
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['D:/overview-test']));
  localStorage.setItem(
    APP_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_APP_SETTINGS, sidePanelWidths: { book: 420 } }),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const get = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  const click = async (id: string) => {
    expect(get(id)).toBeTruthy();
    await act(async () => get(id).click());
  };
  const surface = () => get('desktop-shell').getAttribute('data-main-surface');
  try {
    await act(async () => root.render(<App />));
    await act(async () =>
      Array.from(host.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('overview-test'))!
        .click(),
    );
    expect(surface()).toBe('overview');
    expect(get('workspace-sidebar-surface').hidden).toBe(true);
    expect(get('assistant-panel').hidden).toBe(true);
    expect(get('writing-workspace-surface').hidden).toBe(true);
    expect(get('shell-center').style.minWidth).toBe('');
    await click('agent-run-trigger');
    expect(get('book-overview-agent-run').textContent).toContain('Agent 正在工作');
    await click('book-overview-agent-run');
    expect(surface()).toBe('workspace');
    await click('activity-book');
    const editor = get('editor-probe');
    const agent = get('agent-probe');
    await click('open-writing-workspace');
    await click('editor-probe');
    await click('agent-probe');
    await click('activity-book');
    expect(surface()).toBe('overview');
    await click('edit-book-profile');
    const form = get('book-note-input');
    expect(form).toBeTruthy();
    await click('back-to-book-overview');
    expect(form.isConnected).toBe(true);
    // 总览不覆写之前的布局；在 chat 模式返回总览也必须完整可见。
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true })),
    );
    expect(surface()).toBe('workspace');
    await click('activity-book');
    expect(get('desktop-shell').getAttribute('data-layout-focus')).toBe('chat');
    expect(get('shell-center').classList.contains('hidden')).toBe(false);
    expect(get('assistant-panel').hidden).toBe(true);
    const suggestion = {
      id: 'patch-1',
      filePath: 'D:/overview-test/正文/01.md',
      requiresConfirmation: true,
    };
    await act(async () =>
      window.dispatchEvent(new CustomEvent(APPLY_FILE_SUGGESTION_EVENT, { detail: suggestion })),
    );
    expect(surface()).toBe('workspace');
    expect(get('shell-center').classList.contains('hidden')).toBe(false);
    expect(get('editor-probe').getAttribute('data-file')).toBe(suggestion.filePath);
    await click('back-to-book-overview');
    await act(async () =>
      window.dispatchEvent(new CustomEvent(APPLY_FILE_SUGGESTION_EVENT, { detail: suggestion })),
    );
    expect(surface()).toBe('workspace'); // 当前文件相同也不能被早返回吞掉导航。
    expect(get('editor-probe')).toBe(editor);
    expect(editor.textContent).toBe('editor:1');
    expect(get('agent-probe')).toBe(agent);
    expect(agent.textContent).toBe('agent:1');
    expect(get('book-note-input')).toBe(form);
    expect(loadAppSettings().sidePanelWidths).toEqual({ book: 420 });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
