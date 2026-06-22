import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildStableAgentRequestPayload,
  extractIssueScopeFromInstruction,
  reviewIssuesFromReport,
} from '../src/components/ChatWindow';

const reviewReport = {
  kind: 'review_report',
  issues: [
    {
      id: 'plot-1',
      category: 'plot',
      severity: 'high',
      message: '剧情冲突不足。',
      evidence: '未检测到阻碍。',
      suggested_action: '补一个明确阻碍。',
    },
    {
      id: 'character-1',
      category: 'character',
      severity: 'medium',
      message: '人物动机不清。',
      evidence: '她突然离开。',
      suggested_action: '用动作或对白证明决定。',
    },
  ],
};

test('review report issues expose stable ids and issue-level suggested actions', () => {
  const issues = reviewIssuesFromReport(reviewReport);

  assert.deepEqual(
    issues.map((issue) => [issue.id, issue.category, issue.suggestedAction]),
    [
      ['plot-1', 'plot', '补一个明确阻碍。'],
      ['character-1', 'character', '用动作或对白证明决定。'],
    ],
  );
});

test('issue scope can be inferred from explicit issue id or category instruction', () => {
  assert.deepEqual(extractIssueScopeFromInstruction('只修 character-1，保留结尾', reviewReport), {
    selected_issue_ids: ['character-1'],
    included_categories: ['character'],
  });
  assert.deepEqual(extractIssueScopeFromInstruction('只修人物问题，保留结尾', reviewReport), {
    included_categories: ['character'],
  });
});

test('stable agent request payload carries project, file, content, selection, session and context', () => {
  const payload = buildStableAgentRequestPayload({
    projectPath: 'D:\\Books\\雾港回声',
    currentFile: 'D:\\Books\\雾港回声\\正文\\第01章.md',
    content: '当前正文',
    instruction: '只修 character-1',
    projectName: '雾港回声',
    assistantSessionId: 42,
    reviewReport,
    contextBundle: {
      projectRoot: 'D:\\Books\\雾港回声',
      currentFile: 'D:\\Books\\雾港回声\\正文\\第01章.md',
      summary: {
        hasStoryStructure: true,
        counts: {
          outline: 1,
          character: 1,
          setting: 0,
          timeline: 0,
          foreshadowing: 0,
          draft: 1,
          quality: 0,
          export: 0,
          other: 0,
        },
      },
      files: [
        {
          path: 'D:\\Books\\雾港回声\\人物\\林岚.md',
          relativePath: '人物\\林岚.md',
          kind: 'character',
          title: '林岚.md',
          excerpt: '林岚害怕失去证据。',
        },
      ],
    },
  });

  assert.equal(payload.project_path, 'D:\\Books\\雾港回声');
  assert.equal(payload.current_file, 'D:\\Books\\雾港回声\\正文\\第01章.md');
  assert.equal(payload.content, '当前正文');
  assert.equal(payload.selection, '当前正文');
  assert.equal(payload.assistant_session_id, 42);
  assert.deepEqual(payload.selected_issue_ids, ['character-1']);
  assert.equal(payload.context_bundle?.files[0].relative_path, '人物\\林岚.md');
});
