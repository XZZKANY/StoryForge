import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  APPLY_FILE_SUGGESTION_EVENT,
  bufferPendingFileSuggestion,
  emitFileSuggestion,
  isAuthorRequestedSuggestion,
  reofferPendingFileSuggestion,
} from '../src/lib/assistant-events';
import { createRemoteFileSuggestion } from '../src/lib/assistant-suggestions';
import { READING_WINDOW_MS, isReadingFile, noteEditorActivity } from '../src/lib/editor-reading';

test('一分钟内在这份文件里翻过才算在读，换写法的同一路径也认', () => {
  noteEditorActivity('D:\\书\\正文\\第002章.md', 1_000);
  assert.equal(isReadingFile('D:/书/正文/第002章.md', 1_000 + READING_WINDOW_MS - 1), true);
  assert.equal(isReadingFile('D:/书/正文/第002章.md', 1_000 + READING_WINDOW_MS), false);
  assert.equal(isReadingFile('D:/书/正文/第001章.md', 1_000), false);
});

test('作者点接受时补发的修订带「作者要看」标记，AI 刚交来的不带', () => {
  const suggestion = createRemoteFileSuggestion({
    id: 'p-reading',
    filePath: 'D:/书/正文/第003章.md',
    before: '',
    after: '第三章',
    summary: '起草第三章',
    model: 'fixture',
    userIntent: '写第三章',
  });
  const marks: boolean[] = [];
  const onOffer = (event: Event) => marks.push(isAuthorRequestedSuggestion(event));
  window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onOffer);
  try {
    emitFileSuggestion(suggestion);
    bufferPendingFileSuggestion(suggestion);
    assert.equal(
      reofferPendingFileSuggestion({ patchId: suggestion.id, filePath: suggestion.filePath }),
      true,
    );
    assert.deepEqual(marks, [false, true]);
  } finally {
    window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onOffer);
  }
});
