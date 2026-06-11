import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createIdeUrlHref,
  parseIdeUrlState,
  serializeIdeUrlState,
} from '../components/ide/url/ide-url-state';

test('parseIdeUrlState 解析 workspace、book、tab、active 与面板状态', () => {
  const state = parseIdeUrlState(
    'workspace=default&workspace_id=3&book=12&tab=legacy:studio&tab=chapter:5&active=chapter:5&panel.left=memory&panel.bottom=artifacts&inspector=ctx_unit&artifact=7',
  );

  assert.deepEqual(state, {
    workspace: 'default',
    workspaceId: 3,
    bookId: 12,
    tabs: ['legacy:studio', 'chapter:5'],
    activeTabId: 'chapter:5',
    inspectorId: 'ctx_unit',
    artifactId: 7,
    leftPanel: 'memory',
    bottomPanel: 'artifacts',
  });
});

test('serializeIdeUrlState 序列化 IDE 状态并保留多 tab', () => {
  const query = serializeIdeUrlState({
    workspace: 'default',
    workspaceId: 3,
    bookId: 12,
    tabs: ['legacy:studio', 'chapter:5'],
    activeTabId: 'chapter:5',
    inspectorId: 'ctx_unit',
    artifactId: 7,
    leftPanel: 'explorer',
    bottomPanel: 'diff',
  });

  assert.equal(
    query,
    'workspace=default&workspace_id=3&book=12&tab=legacy%3Astudio&tab=chapter%3A5&active=chapter%3A5&inspector=ctx_unit&artifact=7&panel.left=explorer&panel.bottom=diff',
  );
});

test('createIdeUrlHref 合并局部状态并保留可分享上下文', () => {
  const href = createIdeUrlHref(
    {
      workspace: 'default',
      workspaceId: 3,
      bookId: 12,
      tabs: ['legacy:studio', 'chapter:5'],
      activeTabId: 'chapter:5',
      inspectorId: 'ctx_unit',
      artifactId: 7,
      leftPanel: 'explorer',
      bottomPanel: 'problems',
    },
    { leftPanel: 'memory', bottomPanel: 'runs' },
  );

  assert.equal(
    href,
    '/ide?workspace=default&workspace_id=3&book=12&tab=legacy%3Astudio&tab=chapter%3A5&active=chapter%3A5&inspector=ctx_unit&artifact=7&panel.left=memory&panel.bottom=runs',
  );
});
