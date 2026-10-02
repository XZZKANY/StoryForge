import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HostCloseNotice } from '../src/components/app/HostCloseNotice';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../src/lib/tauri-env', () => ({ isTauriRuntime: () => true }));

async function withNotice(check: (element: HTMLElement) => void) {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<HostCloseNotice />));
    check(element);
    expect(invoke).toHaveBeenCalledWith('read_host_close_diagnostic');
  } finally {
    await act(async () => root.unmount());
    element.remove();
    invoke.mockReset();
  }
}

it('does not present a confirmed handshake as an outstanding error', async () => {
  invoke.mockResolvedValue({ reason: 'close_confirmed' });
  await withNotice((element) => expect(element.textContent).toBe(''));
});

it('shows bounded counts without requesting approval or replaying an operation', async () => {
  invoke.mockResolvedValue({
    reason: 'close_timeout_unsettled', deliveryTickets: 2, activeCommands: 1,
  });
  await withNotice((element) => {
    expect(element.querySelector('[role="status"]')?.textContent).toContain('交付 2');
    expect(element.textContent).toContain('未知结果不会自动重放');
    expect(element.querySelector('button')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

it('does not render malformed diagnostic data as trustworthy settlement', async () => {
  invoke.mockResolvedValue({
    reason: 'close_timeout_unsettled', deliveryTickets: 'invalid', activeCommands: 1,
  });
  await withNotice((element) => expect(element.textContent).toContain('诊断无法读取'));
});

it('read failure remains a nonblocking warning, not a successful shutdown', async () => {
  invoke.mockRejectedValue(new Error('unavailable'));
  await withNotice((element) => {
    expect(element.textContent).toContain('不会自动重放');
    expect(element.querySelector('[role="dialog"]')).toBeNull();
  });
});
