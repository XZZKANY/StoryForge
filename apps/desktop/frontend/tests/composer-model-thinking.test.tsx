import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ComposerSurface } from '../src/components/chat-window/Composer';
import { ModelProfileSelector } from '../src/components/chat-window/ModelProfileSelector';
import { ReasoningEffortSelector } from '../src/components/chat-window/ReasoningEffortSelector';
import {
  activateLlmProfile,
  listLlmProfiles,
  type LlmProfiles,
} from '../src/lib/desktop-llm-config';
import { readReasoningEffort, writeReasoningEffort } from '../src/lib/reasoning-effort';

vi.mock('../src/lib/desktop-llm-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/desktop-llm-config')>();
  return { ...actual, listLlmProfiles: vi.fn(), activateLlmProfile: vi.fn() };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\书\\甲';
const PROFILES: LlmProfiles = {
  profiles: [
    {
      id: 'p1',
      name: '主力',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-opus-5-5',
      models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
      hasApiKey: true,
    },
    {
      id: 'p2',
      name: '',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3-pro-preview',
      models: ['gemini-3-pro-preview'],
      hasApiKey: true,
    },
  ],
  activeProfileId: 'p1',
  polishProfileId: null,
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(listLlmProfiles).mockReset();
  vi.mocked(activateLlmProfile).mockReset();
  vi.mocked(listLlmProfiles).mockResolvedValue(PROFILES);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  host = null;
  root = null;
});

async function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

const byTestId = <T extends HTMLElement = HTMLButtonElement>(id: string) =>
  document.querySelector<T>(`[data-testid="${id}"]`);

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => element!.click());
}

test('输入框底部从左到右：权限 · 模型 · 思考', async () => {
  await mount(
    <ComposerSurface
      value=""
      disabled={false}
      busy={false}
      explicitContextPaths={[]}
      onAddContext={() => undefined}
      onChange={() => undefined}
      permissionProfile="ask"
      onPermissionProfileChange={() => undefined}
      projectPath={PROJECT}
    />,
  );
  const order = Array.from(
    byTestId('composer-toolbar')!.querySelectorAll<HTMLElement>('[data-testid]'),
  )
    .map((element) => element.dataset.testid)
    .filter((id) =>
      [
        'permission-profile-selector',
        'model-profile-selector',
        'reasoning-effort-selector',
      ].includes(id!),
    );
  expect(order).toEqual([
    'permission-profile-selector',
    'model-profile-selector',
    'reasoning-effort-selector',
  ]);
  expect(byTestId('model-profile-selector')!.textContent).toContain('claude-opus-5-5');
  expect(byTestId('reasoning-effort-selector')!.textContent).toContain('思考：关');
});

test('模型下拉按服务商分组列出勾过的模型，当前那个打勾；换同一套或另一套的模型都调全局切换', async () => {
  const [main, gemini] = PROFILES.profiles;
  vi.mocked(activateLlmProfile)
    .mockResolvedValueOnce({
      ...PROFILES,
      profiles: [{ ...main, model: 'claude-sonnet-5-5' }, gemini],
    })
    .mockResolvedValueOnce({ ...PROFILES, activeProfileId: 'p2' });
  await mount(<ModelProfileSelector />);
  const trigger = byTestId('model-profile-selector')!;
  expect(trigger.textContent).toContain('claude-opus-5-5');
  expect(trigger.title).toBe('主力 · claude-opus-5-5');

  await click(trigger);
  const groups = [...document.querySelectorAll('[data-testid="model-profile-selector-group"]')];
  expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
    '主力',
    'Google Gemini',
  ]);
  expect(groups.map((group) => [...group.querySelectorAll('[role="option"]')].length)).toEqual([
    2, 1,
  ]);
  const opus = byTestId('model-profile-selector-option-p1/claude-opus-5-5')!;
  expect(opus.getAttribute('aria-selected')).toBe('true');
  expect(opus.textContent).toBe('claude-opus-5-5');
  await click(opus);
  expect(activateLlmProfile).not.toHaveBeenCalled();

  await click(byTestId('model-profile-selector'));
  await click(byTestId('model-profile-selector-option-p1/claude-sonnet-5-5'));
  expect(activateLlmProfile).toHaveBeenLastCalledWith('p1', 'claude-sonnet-5-5');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(byTestId('model-profile-selector')!.textContent).toContain('claude-sonnet-5-5');

  await click(byTestId('model-profile-selector'));
  await click(byTestId('model-profile-selector-option-p2/gemini-3-pro-preview'));
  expect(activateLlmProfile).toHaveBeenLastCalledWith('p2', 'gemini-3-pro-preview');
  expect(byTestId('model-profile-selector')!.textContent).toContain('gemini-3-pro-preview');
  expect(byTestId('model-profile-selector')!.title).toBe('Google Gemini · gemini-3-pro-preview');
});

test('有配置时菜单最后是「管理模型…」，点了去设置', async () => {
  const openSettings = vi.fn();
  await mount(<ModelProfileSelector onOpenSettings={openSettings} />);
  await click(byTestId('model-profile-selector'));
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options.map((option) => option.textContent)).toEqual([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'gemini-3-pro-preview',
    '管理模型…',
  ]);
  await click(options[3]);
  expect(openSettings).toHaveBeenCalledOnce();
  expect(activateLlmProfile).not.toHaveBeenCalled();
});

test('切换失败就地给出原因，菜单不收、不弹居中对话框', async () => {
  vi.mocked(activateLlmProfile).mockRejectedValue(new Error('配置文件被占用'));
  await mount(<ModelProfileSelector />);
  await click(byTestId('model-profile-selector'));
  await click(byTestId('model-profile-selector-option-p2/gemini-3-pro-preview'));
  const listbox = document.querySelector('[role="listbox"]');
  expect(listbox).not.toBeNull();
  expect(listbox!.querySelector('[role="alert"]')!.textContent).toBe('切换失败：配置文件被占用');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(byTestId('model-profile-selector')!.textContent).toContain('claude-opus-5-5');
});

test('没有任何配置：显示「未配置模型」，菜单里只有「去设置里添加」', async () => {
  vi.mocked(listLlmProfiles).mockResolvedValue({
    profiles: [],
    activeProfileId: null,
    polishProfileId: null,
  });
  const openSettings = vi.fn();
  await mount(<ModelProfileSelector onOpenSettings={openSettings} />);
  expect(byTestId('model-profile-selector')!.textContent).toContain('未配置模型');
  await click(byTestId('model-profile-selector'));
  const options = document.querySelectorAll('[role="option"]');
  expect(options.length).toBe(1);
  expect(options[0].textContent).toContain('去设置里添加');
  await click(options[0] as HTMLButtonElement);
  expect(openSettings).toHaveBeenCalledOnce();
  expect(activateLlmProfile).not.toHaveBeenCalled();
});

test('运行中模型与思考下拉跟权限下拉一样不能改', async () => {
  await mount(
    <>
      <ModelProfileSelector busy />
      <ReasoningEffortSelector projectPath={PROJECT} busy />
    </>,
  );
  expect(byTestId('model-profile-selector')!.disabled).toBe(true);
  expect(byTestId('reasoning-effort-selector')!.disabled).toBe(true);
  expect(byTestId('reasoning-effort-selector')!.title).toBe('本轮正在按启动时的思考等级执行');
});

test('思考下拉：四档，「关」有说明，底部有提示；选了写进本项目的 localStorage', async () => {
  writeReasoningEffort('D:\\书\\别的', 'low');
  await mount(<ReasoningEffortSelector projectPath={PROJECT} />);
  const trigger = byTestId('reasoning-effort-selector')!;
  expect(trigger.textContent).toBe('思考：关');
  await click(trigger);
  const labels = Array.from(document.querySelectorAll('[role="option"]')).map(
    (option) => option.querySelector('span span')!.textContent,
  );
  expect(labels).toEqual(['关', '低', '中', '高']);
  expect(byTestId('reasoning-effort-selector-option-off')!.textContent).toContain(
    '不传思考参数，按模型默认',
  );
  expect(document.querySelector('[role="listbox"]')!.textContent).toContain(
    '中转或模型不认时会报错，调回「关」即可。',
  );
  await click(byTestId('reasoning-effort-selector-option-high'));
  expect(localStorage.getItem(`storyforge:reasoning-effort:${PROJECT}`)).toBe('high');
  expect(readReasoningEffort('D:\\书\\别的')).toBe('low');
  expect(byTestId('reasoning-effort-selector')!.textContent).toBe('思考：高');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

test('键盘与权限下拉一致：方向键打开并聚焦已选项，移焦不改值，Enter 选中后焦点回按钮，Esc 取消', async () => {
  writeReasoningEffort(PROJECT, 'medium');
  await mount(<ReasoningEffortSelector projectPath={PROJECT} />);
  const trigger = byTestId('reasoning-effort-selector')!;
  const option = (value: string) => byTestId(`reasoning-effort-selector-option-${value}`)!;
  const press = async (target: Element, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event));
  };
  trigger.focus();
  await press(trigger, 'ArrowDown');
  expect(document.activeElement).toBe(option('medium'));
  await press(option('medium'), 'ArrowDown');
  expect(document.activeElement).toBe(option('high'));
  expect(readReasoningEffort(PROJECT)).toBe('medium');
  await press(option('high'), 'Escape');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(readReasoningEffort(PROJECT)).toBe('medium');
  await press(trigger, 'ArrowUp');
  await press(option('medium'), 'Home');
  expect(document.activeElement).toBe(option('off'));
  await press(option('off'), 'Enter');
  expect(readReasoningEffort(PROJECT)).toBe('off');
  expect(document.activeElement).toBe(trigger);
});
