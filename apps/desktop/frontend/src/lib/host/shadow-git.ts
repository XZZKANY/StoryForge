import { invoke } from '@tauri-apps/api/core';

import { assertTauriRuntime } from './tauri-env';

export type ShadowSnapshot = {
  treeHash: string;
  gitVersion: string;
};

export type ShadowFileState = {
  exists: boolean;
  content: string;
};

export async function createShadowSnapshot(
  projectRoot: string,
  deliveryTicket?: string,
): Promise<ShadowSnapshot> {
  assertTauriRuntime('createShadowSnapshot');
  return await invoke<ShadowSnapshot>('create_shadow_snapshot', {
    ...(deliveryTicket ? { deliveryTicket } : {}),
    payload: { projectRoot },
  });
}

export async function retainShadowSnapshot(
  projectRoot: string,
  treeHash: string,
  recordId: string,
  deliveryTicket?: string,
): Promise<void> {
  assertTauriRuntime('retainShadowSnapshot');
  await invoke('retain_shadow_snapshot', {
    ...(deliveryTicket ? { deliveryTicket } : {}),
    payload: { projectRoot, treeHash, recordId },
  });
}

export async function releaseShadowSnapshot(
  projectRoot: string,
  recordId: string,
  deliveryTicket?: string,
): Promise<void> {
  assertTauriRuntime('releaseShadowSnapshot');
  await invoke('release_shadow_snapshot', {
    ...(deliveryTicket ? { deliveryTicket } : {}),
    payload: { projectRoot, recordId },
  });
}

export async function readShadowSnapshotFile(
  projectRoot: string,
  treeHash: string,
  filePath: string,
): Promise<ShadowFileState> {
  assertTauriRuntime('readShadowSnapshotFile');
  return await invoke<ShadowFileState>('read_shadow_snapshot_file', {
    payload: { projectRoot, treeHash, filePath },
  });
}

export async function filterShadowSnapshotHashes(
  projectRoot: string,
  hashes: string[],
): Promise<string[]> {
  if (hashes.length === 0) return [];
  assertTauriRuntime('filterShadowSnapshotHashes');
  return await invoke<string[]>('filter_shadow_snapshot_hashes', {
    payload: { projectRoot, hashes },
  });
}
