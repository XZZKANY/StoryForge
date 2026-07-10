import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  emitAcceptCurrentFileSuggestion,
  emitFileSuggestion,
  takePendingFileSuggestion,
} from '../src/lib/assistant-events';
import { createRemoteFileSuggestion } from '../src/lib/assistant-suggestions';

test('accept current file suggestion event is emitted for chat writeback confirmation', () => {
  const events: string[] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
    dispatchEvent(event: Event) {
      events.push(event.type);
      return true;
    },
    },
  });

  try {
    emitAcceptCurrentFileSuggestion();
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }

  assert.deepEqual(events, [ACCEPT_CURRENT_FILE_SUGGESTION_EVENT]);
});

test('pending file suggestion is buffered for the target file and taken exactly once', () => {
  const suggestion = createRemoteFileSuggestion({
    filePath: 'D:/项目/正文/第03章.md',
    before: '',
    after: '第三章初稿正文',
    summary: '起草第三章',
    model: 'test-model',
    userIntent: '写第三章',
  });

  emitFileSuggestion(suggestion);

  // 其他文件领取不到；目标文件可领取一次，再领为空（防切换文件后重复弹出）
  assert.equal(takePendingFileSuggestion('D:/项目/正文/第01章.md'), null);
  assert.equal(takePendingFileSuggestion(null), null);
  assert.equal(takePendingFileSuggestion('D:/项目/正文/第03章.md'), suggestion);
  assert.equal(takePendingFileSuggestion('D:/项目/正文/第03章.md'), null);
});
