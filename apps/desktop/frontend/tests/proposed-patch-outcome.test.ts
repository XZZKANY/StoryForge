import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import { emitProposedPatchOutcome } from '../src/components/chat-window/proposed-patch-outcome';
import type { ChatWindowAgentResult } from '../src/components/chat-window/types';
import {
  APPLY_FILE_SUGGESTION_EVENT,
  takePendingFileSuggestion,
} from '../src/lib/assistant-events';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';
import { reconstructAgentResultFromEvents } from '../src/lib/api/agent-run-events';
import {
  CHAPTER_TRUNCATION_WARNING,
  chapterWriteRebuildEvents,
} from './support/chapter-write-rebuild-events';

const PROJECT = 'D:\\连载\\雾港回声';
const FILE = 'D:\\连载\\雾港回声\\大纲\\总纲.md';
const WARNING = 'AI 的输出可能没写完：原文最后的『七、伏笔』『八、边界』共 7 段在新稿里没有。';

afterEach(() => {
  takePendingFileSuggestion(FILE);
});

function emitted(response: ChatWindowAgentResult): AssistantFileSuggestion {
  const received: AssistantFileSuggestion[] = [];
  const listen = (event: Event) =>
    received.push((event as CustomEvent<AssistantFileSuggestion>).detail);
  window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, listen);
  try {
    const patch = response.proposed_patch as Record<string, unknown>;
    emitProposedPatchOutcome({
      response,
      proposed: {
        id: patch.id as string,
        file_path: FILE,
        before: patch.before as string,
        after: patch.after as string,
        requires_confirmation: true,
      },
      contextRelativePaths: [],
      projectPath: PROJECT,
      goal: '先建立五卷章节总目',
      runId: 'run-1',
      settleDiagnostic: () => undefined,
      settleText: () => undefined,
      updateAgentStatus: () => undefined,
    });
  } finally {
    window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, listen);
  }
  assert.equal(received.length, 1);
  return received[0];
}

const response = (agentResult: Record<string, unknown>): ChatWindowAgentResult => ({
  type: 'agent_result',
  session_id: 'agent-session',
  run_id: 'run-1',
  assistant_session_id: 1,
  intent: 'chat.explain',
  user_message: '先建立五卷章节总目',
  plan: [],
  tool_trace: [],
  agent_result: { summary: '改好了，等你确认。', ...agentResult },
  proposed_patch: {
    id: 'file-revision-1',
    kind: 'file_revision',
    file_path: FILE,
    before: '原稿',
    after: '半截',
    requires_confirmation: true,
    approval_action: 'desktop.confirm_file_writeback',
  },
});

test('引擎给的截断警告随补丁交给编辑器；没有警告就不带', () => {
  const warned = emitted(response({ truncation_warning: { message: WARNING } }));
  assert.equal(warned.truncationWarning, WARNING);
  assert.match(warned.note, /可能没写完/);
  const plain = emitted(response({}));
  assert.equal(plain.truncationWarning, undefined);
});

test('引擎给的字数提示随补丁交给编辑器、写进旁注；没有就不带', () => {
  const hint = '字数提示：目标约 3600–4400 字，这版实际 5999 字（偏多 1599 字）。';
  const hinted = emitted(response({ length_hint: { message: hint, actual_chars: 5999 } }));
  assert.equal(hinted.lengthHint, hint);
  assert.equal(hinted.truncationWarning, undefined);
  assert.equal(hinted.requiresConfirmation, true);
  assert.ok(hinted.note.split('\n').includes(hint));
  const plain = emitted(response({}));
  assert.equal(plain.lengthHint, undefined);
  assert.ok(!plain.note.includes('字数提示'));
});

test('断线重建的写章结果：截断警告同样随补丁交给编辑器；收句的不带', () => {
  const rebuilt = (truncationWarning: Record<string, unknown> | null) =>
    reconstructAgentResultFromEvents(
      chapterWriteRebuildEvents({
        patch: { id: 'chapter-writing-1', file_path: FILE, before: '', after: '他推开门，看见' },
        truncationWarning,
      }),
      { sessionId: 'agent-session', runId: 'run-1' },
    ) as ChatWindowAgentResult;
  const warned = emitted(rebuilt(CHAPTER_TRUNCATION_WARNING));
  assert.equal(warned.truncationWarning, CHAPTER_TRUNCATION_WARNING.message);
  assert.equal(warned.before, '');
  assert.equal(emitted(rebuilt(null)).truncationWarning, undefined);
});
