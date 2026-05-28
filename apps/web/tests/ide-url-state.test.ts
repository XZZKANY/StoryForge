import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseIdeUrlState, serializeIdeUrlState } from '../components/ide/url/ide-url-state';

test('parseIdeUrlState 解析 workspace、book、tab、active 与面板状态', () => {
  const state = parseIdeUrlState(
    'workspace=default&book=12&tab=legacy:studio&tab=chapter:5&active=chapter:5&panel.left=search&panel.bottom=problems',
  );

  assert.deepEqual(state, {
    workspace: 'default',
    bookId: 12,
    tabs: ['legacy:studio', 'chapter:5'],
    activeTabId: 'chapter:5',
    leftPanel: 'search',
    bottomPanel: 'problems',
  });
});

test('serializeIdeUrlState 序列化 IDE 状态并保留多 tab', () => {
  const query = serializeIdeUrlState({
    workspace: 'default',
    bookId: 12,
    tabs: ['legacy:studio', 'chapter:5'],
    activeTabId: 'chapter:5',
    leftPanel: 'explorer',
    bottomPanel: 'diff',
  });

  assert.equal(
    query,
    'workspace=default&book=12&tab=legacy%3Astudio&tab=chapter%3A5&active=chapter%3A5&panel.left=explorer&panel.bottom=diff',
  );
});
