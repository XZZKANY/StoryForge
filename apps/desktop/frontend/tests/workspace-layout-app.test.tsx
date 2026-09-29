import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { APP_SETTINGS_KEY, DEFAULT_APP_SETTINGS, loadAppSettings } from '../src/lib/user-settings';

// 保留真实 App / AppShell / shell hook / 偏好及项目选择链路，只替换重型叶子。
// 计数器验证挂载身份，不冒充真实 Monaco buffer 或真实 Agent 运行。
function StateProbe({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount((value) => value + 1)}>
      {label}:{count}
    </button>
  );
}
vi.mock('../src/components/Editor', () => ({ Editor: () => <StateProbe label="editor-probe" /> }));
vi.mock('../src/components/ChatWindow', () => ({
  ChatWindow: () => <StateProbe label="agent-probe" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('真实 App 项目态 resize / 聚焦布局不改宽度偏好或卸载 Editor / Agent', async () => {
  let viewport = 1024;
  vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => viewport);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // 断开外部边界：所有请求明确失败，不返回虚构业务记录。
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"detail":"layout test offline"}', { status: 503 })),
  );
  localStorage.clear();
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['D:/layout-test-project']));
  // 旧格式（按视图 map、无单宽字段）种子：启动即迁移，整轮运行不得覆盖成别的宽度。
  const legacySettings: Record<string, unknown> = { ...DEFAULT_APP_SETTINGS };
  delete legacySettings.sidePanelWidth;
  legacySettings.sidePanelWidths = { book: 420 };
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(legacySettings));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const click = async (button: HTMLElement | null | undefined) => {
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  try {
    await act(async () => root.render(<App />));
    await click(
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('layout-test-project'),
      ),
    );
    await click(container.querySelector('[data-testid="activity-book"]'));
    // 作品图标现在是总览目的地；编辑资料仍沿用原 book 面板与宽度偏好。
    await click(container.querySelector('[data-testid="edit-book-profile"]'));
    const panel = () => container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
    expect(panel()?.style.width).toBe('236px');
    expect(loadAppSettings().sidePanelWidth).toBe(420);
    const editor = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'editor-probe:0',
    );
    const agent = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'agent-probe:0',
    );
    await click(editor);
    await click(agent);
    await act(async () => {
      viewport = 1440;
      window.dispatchEvent(new Event('resize'));
    });
    expect(panel()?.style.width).toBe('420px');
    await act(async () => {
      viewport = 1024;
      window.dispatchEvent(new Event('resize'));
    });
    for (const [key, mode] of [
      ['3', 'chat'],
      ['1', 'editor'],
      ['2', 'balanced'],
    ]) {
      await act(async () =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true })),
      );
      expect(
        container.querySelector('[data-testid="desktop-shell"]')?.getAttribute('data-layout-focus'),
      ).toBe(mode);
      expect(
        container
          .querySelector<HTMLElement>('[data-testid="shell-center"]')
          ?.classList.contains('hidden'),
      ).toBe(mode === 'chat');
      expect(container.querySelector<HTMLElement>('[data-testid="assistant-panel"]')?.hidden).toBe(
        mode === 'editor',
      );
      expect(editor?.isConnected).toBe(true);
      expect(agent?.isConnected).toBe(true);
      expect(editor?.textContent).toBe('editor-probe:1');
      expect(agent?.textContent).toBe('agent-probe:1');
    }
    expect(panel()?.style.width).toBe('236px');
    expect(loadAppSettings().sidePanelWidth).toBe(420);
    expect(
      container.querySelector<HTMLElement>('[data-testid="shell-center"]')?.style.minWidth,
    ).toBe('420px');
    expect(
      container.querySelector<HTMLElement>('[data-testid="assistant-panel"]')?.style.minWidth,
    ).toBe('320px');
    // 1024 physical pixels at 125%/150% zoom yield ~819/683 CSS px.
    // Resize only changes the displayed layout, never the user's saved mode/width.
    for (const width of [819, 683]) {
      await act(async () => {
        viewport = width;
        window.dispatchEvent(new Event('resize'));
      });
      expect(
        container.querySelector('[data-testid="desktop-shell"]')?.getAttribute('data-layout-focus'),
      ).toBe('editor');
      expect(container.querySelector<HTMLElement>('[data-testid="assistant-panel"]')?.hidden).toBe(
        true,
      );
      expect(localStorage.getItem('storyforge:shell:layoutMode')).toBe('balanced');
      expect(loadAppSettings().sidePanelWidth).toBe(420);
      expect(
        container.querySelector<HTMLElement>('[data-testid="shell-center"]')?.style.minWidth,
      ).toBe('0');
    }
    await click(container.querySelector('[data-testid="titlebar-toggle-right"]'));
    expect(container.querySelector<HTMLElement>('[data-testid="assistant-panel"]')?.hidden).toBe(
      false,
    );
    expect(
      container.querySelector<HTMLElement>('[data-testid="assistant-panel"]')?.style.minWidth,
    ).toBe('0');
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="shell-center"]')
        ?.classList.contains('hidden'),
    ).toBe(true);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true }),
      ),
    );
    await click(
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('恢复：完整布局'),
      ),
    );
    expect(localStorage.getItem('storyforge:shell:layoutMode')).toBe('balanced');
    expect(
      container.querySelector('[data-testid="desktop-shell"]')?.getAttribute('data-layout-focus'),
    ).toBe('editor');

    await act(async () => {
      viewport = 1024;
      window.dispatchEvent(new Event('resize'));
    });
    expect(
      container.querySelector('[data-testid="desktop-shell"]')?.getAttribute('data-layout-focus'),
    ).toBe('balanced');
    expect(editor?.isConnected && agent?.isConnected).toBe(true);
    expect(editor?.textContent).toBe('editor-probe:1');
    expect(agent?.textContent).toBe('agent-probe:1');
    expect(loadAppSettings().sidePanelWidth).toBe(420);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
