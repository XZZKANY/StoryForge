import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useHostCloseNotice } from '../src/lib/host-close';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';
import { ToastHost } from '../src/components/shell/ToastHost';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../src/lib/tauri-env', () => ({ isTauriRuntime: () => true }));

function Harness() {
  useHostCloseNotice();
  return <main data-testid="shell" />;
}

async function toastsFor(diagnostic: () => Promise<unknown>): Promise<ToastDetail[]> {
  const toasts: ToastDetail[] = [];
  const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);
  window.addEventListener(TOAST_EVENT, onToast);
  invoke.mockImplementation(diagnostic);
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<Harness />));
    expect(invoke.mock.calls).toEqual([['read_host_close_diagnostic']]);
    // 不再是外壳之上的横幅：页面里除了外壳什么都没多。
    expect(element.querySelector('[role="status"]')).toBeNull();
    return toasts;
  } finally {
    await act(async () => root.unmount());
    element.remove();
    window.removeEventListener(TOAST_EVENT, onToast);
    invoke.mockReset();
  }
}

it('does not present a confirmed handshake as an outstanding error', async () => {
  expect(await toastsFor(async () => ({ reason: 'close_confirmed' }))).toEqual([]);
});

it('stays quiet when nothing was in flight at the last exit', async () => {
  const toasts = await toastsFor(async () => ({
    reason: 'close_timeout_unsettled',
    deliveryTickets: 0,
    activeCommands: 0,
    rendererFenced: false,
  }));
  expect(toasts).toEqual([]);
});

it('raises one bottom-corner notice with the pending count and no replay', async () => {
  const toasts = await toastsFor(async () => ({
    reason: 'close_timeout_unsettled',
    deliveryTickets: 2,
    activeCommands: 1,
  }));
  expect(toasts).toHaveLength(1);
  expect(toasts[0].message).toContain('3 个写入操作');
  expect(toasts[0].message).toContain('不会自动重做');
  expect(toasts[0].tone).toBe('error');
  expect(toasts[0].action).toBeUndefined();
});

it('does not render malformed diagnostic data as trustworthy settlement', async () => {
  const toasts = await toastsFor(async () => ({
    reason: 'close_timeout_unsettled',
    deliveryTickets: 'invalid',
    activeCommands: 1,
  }));
  expect(toasts.map((toast) => toast.message)).toEqual([
    expect.stringContaining('没读到上次关闭时的记录'),
  ]);
});

it('read failure remains a nonblocking notice, not a successful shutdown', async () => {
  const toasts = await toastsFor(async () => {
    throw new Error('unavailable');
  });
  expect(toasts).toHaveLength(1);
  expect(toasts[0].message).toContain('不会自动重做');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('reaches the bottom-corner toast stack mounted below it in the shell', async () => {
  function Shell() {
    useHostCloseNotice();
    return <ToastHost />;
  }
  invoke.mockResolvedValue({
    reason: 'close_timeout_unsettled',
    deliveryTickets: 1,
    activeCommands: 0,
  });
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<Shell />));
    expect(element.textContent).toContain('1 个写入操作没确认完成');
  } finally {
    await act(async () => root.unmount());
    element.remove();
    invoke.mockReset();
  }
});

it('the app shell actually wires the notice in (P6-1b once dropped it silently)', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  expect(app).toMatch(/^\s*useHostCloseNotice\(\);$/m);
});
