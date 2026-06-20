import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectLocalConversationAction } from '../src/lib/local-conversation-action';

test('local conversation action recognizes writeback confirmation phrases before backend routing', () => {
  for (const phrase of [
    '确认写回',
    '接受这版',
    '就这版写回',
    '应用这版',
    '确认应用',
    '确认一下写回',
    '应用当前补丁',
    '接受当前修订',
    'accept this',
    'apply this',
    'confirm writeback',
  ]) {
    assert.equal(detectLocalConversationAction(phrase), 'file.writeback', phrase);
  }
});

test('local conversation action keeps export and agent requests separate', () => {
  assert.equal(detectLocalConversationAction('导出当前文件'), 'file.export');
  assert.equal(detectLocalConversationAction('审一下这一章'), 'agent');
  assert.equal(detectLocalConversationAction('应用这个人物动机来审一下'), 'agent');
});
