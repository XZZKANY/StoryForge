import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import {
  buildPatchReviewTraceTitle,
  PatchReviewPanel,
} from '../src/components/PatchReviewPanel';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';

function sampleSuggestion(
  overrides: Partial<AssistantFileSuggestion> = {},
): AssistantFileSuggestion {
  return {
    id: 'patch-42',
    filePath: '正文/第01章.md',
    title: 'AI 修订建议',
    summary: '收紧开篇节奏',
    before: '第一行\n第二行\n',
    after: '第一行改\n第二行\n第三行\n',
    note: '旁注',
    createdAt: 1,
    model: 'deepseek-v4',
    assistantSessionId: 7,
    issueIds: ['iss-1', 'iss-2'],
    scopeWarning: '修订范围偏大',
    ...overrides,
  };
}

test('buildPatchReviewTraceTitle packs engineering fields', () => {
  const title = buildPatchReviewTraceTitle(sampleSuggestion());
  assert.match(title, /补丁 patch-42/);
  assert.match(title, /会话 7/);
  assert.match(title, /deepseek-v4/);
  assert.match(title, /iss-1/);
  assert.match(title, /iss-2/);
});

test('patch panel main text is author-facing without Patch/Session labels', () => {
  const suggestion = sampleSuggestion();
  const html = renderToStaticMarkup(
    <PatchReviewPanel
      suggestion={suggestion}
      onAccept={() => undefined}
      onAcceptHunk={() => undefined}
      onReject={() => undefined}
      onSaveNote={() => undefined}
    />,
  );

  assert.match(html, /data-testid="patch-review"/);
  assert.match(html, /AI 修订建议/);
  assert.match(html, /收紧开篇节奏/);
  assert.match(html, /正文\/第01章\.md/);
  assert.match(html, /data-testid="patch-stats"/);
  assert.match(html, /\+\d+ \/ -\d+/);
  assert.match(html, /修订范围偏大/);

  assert.doesNotMatch(html, />Patch patch-42</);
  assert.doesNotMatch(html, />Session 7</);
  assert.doesNotMatch(html, /Patch patch-42/);
  assert.doesNotMatch(html, /Session 7/);

  // model / issueIds 不作为主行可见元数据
  assert.doesNotMatch(html, /data-testid="patch-meta"[^>]*>[\s\S]*deepseek-v4/);
  assert.doesNotMatch(html, /data-testid="patch-meta"[^>]*>[\s\S]*iss-1/);

  assert.match(html, /data-testid="patch-trace"/);
  assert.match(html, /title="补丁 patch-42 · 会话 7 · deepseek-v4 · iss-1, iss-2"/);

  assert.match(html, /data-testid="suggestion-accept"/);
  assert.match(html, /保存旁注/);
  assert.match(html, /拒绝/);
});

test('trace title omits missing optional fields', () => {
  const title = buildPatchReviewTraceTitle(
    sampleSuggestion({
      model: undefined,
      assistantSessionId: null,
      issueIds: [],
    }),
  );
  assert.equal(title, '补丁 patch-42');
});
