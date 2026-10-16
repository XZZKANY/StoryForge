import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/components/SettingsView';
import { readEngineMode } from '../src/lib/engine/flags';
import { DEFAULT_APP_SETTINGS } from '../src/lib/user-settings';

vi.mock('../src/lib/desktop-llm-config', () => ({
  getDesktopLlmConfig: vi.fn(async () => null),
  saveDesktopLlmConfig: vi.fn(),
}));
vi.mock('../src/lib/api-client', () => ({ probeProviderHealth: vi.fn() }));
vi.mock('../src/lib/update-check', () => ({
  currentAppVersion: async () => null,
  checkForUpdate: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | null = null;

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SettingsView
        settings={DEFAULT_APP_SETTINGS}
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );
  });
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  return (testId: string) =>
    host.querySelector<HTMLSelectElement>(`select[data-testid="${testId}"]`)!;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('DEV', false);
});
afterEach(() => {
  unmount?.();
  unmount = null;
  vi.unstubAllEnvs();
  localStorage.clear();
});

it('a release build defaults all three to the new engine, offers only new / old, and switching back sticks', async () => {
  const select = await render();
  for (const testId of [
    'engine-shadow-assistant',
    'engine-shadow-agent',
    'engine-shadow-commands',
  ]) {
    expect(select(testId).value).toBe('ts');
    expect([...select(testId).options].map((option) => [option.value, option.text])).toEqual([
      ['ts', '新引擎'],
      ['python', '旧引擎（Python）'],
    ]);
  }
  const agent = select('engine-shadow-agent');
  await act(async () => {
    agent.value = 'python';
    agent.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(agent.value).toBe('python');
  expect(readEngineMode('engine.agentLoop')).toBe('python');
  expect(readEngineMode('engine.assistant')).toBe('ts');
  const commands = select('engine-shadow-commands');
  await act(async () => {
    commands.value = 'python';
    commands.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(readEngineMode('engine.ideCommands')).toBe('python');
});

it('shows a choice the author made earlier', async () => {
  localStorage.setItem('engine.assistant', 'python');
  const select = await render();
  expect(select('engine-shadow-assistant').value).toBe('python');
  expect(select('engine-shadow-agent').value).toBe('ts');
});
