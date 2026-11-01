import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useAcknowledgeHostClosing } from '../src/lib/host/host-close';

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  handler: null as null | (() => void),
  unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    if (event === 'storyforge:host-closing') bridge.handler = handler;
    return bridge.unlisten;
  }),
}));
vi.mock('../src/lib/host/tauri-env', () => ({ isTauriRuntime: () => true }));

function Probe() {
  useAcknowledgeHostClosing();
  return null;
}

it('answers the host closing broadcast so the native deadline does not have to run out', async () => {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  await act(async () => root.render(<Probe />));
  await vi.waitFor(() => expect(bridge.handler).not.toBeNull());
  expect(bridge.invoke).not.toHaveBeenCalled();
  bridge.handler!();
  expect(bridge.invoke).toHaveBeenCalledWith('acknowledge_host_closing');
  await act(async () => root.unmount());
  expect(bridge.unlisten).toHaveBeenCalledOnce();
  element.remove();
});
