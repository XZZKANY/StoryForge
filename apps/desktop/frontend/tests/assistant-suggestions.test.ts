import assert from 'node:assert/strict';
import { test } from 'vitest';

import { createRemoteFileSuggestion } from '../src/lib/assistant-suggestions';

const scopeWarning =
  '本次定向修订改动了约 100% 的原文行（4/4 行），可能超出指定范围，请在 diff 面板逐块核对后再接受。';

test('remote file suggestion surfaces scope warning in note and field', () => {
  const suggestion = createRemoteFileSuggestion({
    id: 'patch-1',
    filePath: '正文/第01章.md',
    before: '当前正文',
    after: '修订后正文',
    summary: '已修订。',
    model: 'deepseek',
    userIntent: '只压缩雾气意象，其余别动',
    scopeWarning,
  });
  assert.equal(suggestion.scopeWarning, scopeWarning);
  assert.match(suggestion.note, /范围提醒/);
  assert.match(suggestion.note, /逐块核对/);
});

test('remote file suggestion omits scope warning line when none provided', () => {
  const suggestion = createRemoteFileSuggestion({
    filePath: '正文/第01章.md',
    before: '当前正文',
    after: '修订后正文',
    summary: '已修订。',
    model: 'deepseek',
    userIntent: '改写当前文件',
  });
  assert.equal(suggestion.scopeWarning, undefined);
  assert.doesNotMatch(suggestion.note, /范围提醒/);
});
