import { expect, test, vi } from 'vitest';
import type { invoke } from '@tauri-apps/api/core';

import { checkForUpdate } from '../src/lib/update-check';

const host = (outcome: () => Promise<unknown>) => vi.fn(outcome) as unknown as typeof invoke;

test('有新版：问宿主 app_update_check，带回版本与更新说明', async () => {
  const invokeImpl = host(async () => ({
    version: '0.2.4',
    currentVersion: '0.2.3',
    notes: '修了两处断流',
  }));
  expect(await checkForUpdate('0.2.3', invokeImpl)).toEqual({
    kind: 'update-available',
    current: 'v0.2.3',
    latest: 'v0.2.4',
    notes: '修了两处断流',
  });
  expect(invokeImpl).toHaveBeenCalledWith('app_update_check');
});

test('宿主说没有新版 → up-to-date，用运行中的版本号', async () => {
  expect(
    await checkForUpdate(
      '0.2.4',
      host(async () => null),
    ),
  ).toEqual({
    kind: 'up-to-date',
    current: 'v0.2.4',
  });
});

test('宿主报错（连不上 GitHub、清单坏了）→ error 降级不抛', async () => {
  expect(
    await checkForUpdate(
      '0.2.3',
      host(async () => {
        throw 'Could not fetch a valid release JSON from the remote';
      }),
    ),
  ).toEqual({ kind: 'error', message: 'Could not fetch a valid release JSON from the remote' });
  expect(
    await checkForUpdate(
      '0.2.3',
      host(async () => {
        throw new Error('error sending request');
      }),
    ),
  ).toEqual({ kind: 'error', message: 'error sending request' });
});
