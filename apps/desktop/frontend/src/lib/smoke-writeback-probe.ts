import { isTauriRuntime } from './tauri-env';
import { TauriFileSystem } from './tauri-fs';

export type WritebackProbeMode = 'drop-first-write-reply' | 'observe';
export type WritebackProbeSnapshot = {
  writes: number;
  inspections: number;
  audits: number;
  dropped: number;
};
export type WritebackProbeInstallation = {
  installed: boolean;
  reason?:
    | 'invalid_mode'
    | 'already_installed'
    | 'tauri_runtime_required'
    | 'mock_filesystem_active';
};

let snapshot: WritebackProbeSnapshot = { writes: 0, inspections: 0, audits: 0, dropped: 0 };
let restoreActiveProbe: (() => void) | null = null;

export function getWritebackProbeSnapshot(): WritebackProbeSnapshot {
  return { ...snapshot };
}

export function restoreWritebackProbe(): WritebackProbeSnapshot {
  restoreActiveProbe?.();
  restoreActiveProbe = null;
  return getWritebackProbeSnapshot();
}

/** Explicit smoke-only opt-in; module loading never wraps production writes. */
export function installWritebackProbe(mode: WritebackProbeMode): WritebackProbeInstallation {
  if (mode !== 'observe' && mode !== 'drop-first-write-reply') {
    return { installed: false, reason: 'invalid_mode' };
  }
  if (restoreActiveProbe) return { installed: false, reason: 'already_installed' };
  if (!isTauriRuntime()) return { installed: false, reason: 'tauri_runtime_required' };
  if (window.__STORYFORGE_MOCK_FS__) return { installed: false, reason: 'mock_filesystem_active' };

  const originalWrite = TauriFileSystem.writeFileWithReceipt;
  const originalInspect = TauriFileSystem.inspectWritebackReceipt;
  const originalAudit = TauriFileSystem.createWritebackAudit;
  const counts: WritebackProbeSnapshot = { writes: 0, inspections: 0, audits: 0, dropped: 0 };
  let active = true;
  snapshot = counts;

  // Count adapter dispatches, not proven disk mutations. Keep no args, content, or credentials.
  TauriFileSystem.writeFileWithReceipt = async function (this: typeof TauriFileSystem, ...args) {
    counts.writes += 1;
    const result = await originalWrite.apply(this, args);
    if (
      active &&
      mode === 'drop-first-write-reply' &&
      counts.dropped === 0 &&
      result.state === 'applied' &&
      result.receiptPersisted
    ) {
      counts.dropped += 1;
      throw new Error('STORYFORGE_SMOKE_WRITE_REPLY_DROPPED');
    }
    return result;
  };
  TauriFileSystem.inspectWritebackReceipt = async function (this: typeof TauriFileSystem, ...args) {
    counts.inspections += 1;
    return await originalInspect.apply(this, args);
  };
  TauriFileSystem.createWritebackAudit = async function (this: typeof TauriFileSystem, ...args) {
    counts.audits += 1;
    return await originalAudit.apply(this, args);
  };
  restoreActiveProbe = () => {
    active = false;
    TauriFileSystem.writeFileWithReceipt = originalWrite;
    TauriFileSystem.inspectWritebackReceipt = originalInspect;
    TauriFileSystem.createWritebackAudit = originalAudit;
  };
  return { installed: true };
}
