import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  applyWritingRunEventProjection,
  buildStableAgentRequestPayload,
  extractIssueScopeFromInstruction,
  reviewIssuesFromReport,
  scopeWarningFromAgentResult,
  WritingRunProgressPanel,
  writingRunIdFromResult,
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

test('managed Writing Run mock SSE progress renders lightweight tool progress', () => {
  const progress = applyWritingRunEventProjection(null, {
    event: 'progress',
    data: {
      writing_run_id: 700,
      book_run_id: 7,
      status: 'running',
      current_chapter_index: 3,
      total_chapters: 8,
      completed_count: 2,
    },
  });
  assert.ok(progress);

  const progressMarkup = renderToStaticMarkup(React.createElement(WritingRunProgressPanel, { projection: progress }));
  assert.match(progressMarkup, /写作任务 #700/);
  assert.match(progressMarkup, /running/);
  assert.match(progressMarkup, /2\/8/);
  assert.match(progressMarkup, /当前第 3 章/);

  const failed = applyWritingRunEventProjection(progress, {
    event: 'failed',
    data: {
      book_run_id: 7,
      pause_reason: '预算不足',
    },
  });
  assert.ok(failed);
  const failedMarkup = renderToStaticMarkup(React.createElement(WritingRunProgressPanel, { projection: failed }));
  assert.match(failedMarkup, /最近事件：failed/);
  assert.match(failedMarkup, /预算不足/);
});

test('scope warning is extracted from agent_result for the patch panel', () => {
  const base = {
    type: 'agent_result',
    session_id: 'agent-session',
    assistant_session_id: 1,
    intent: 'file.revise',
    user_message: '只压缩雾气意象，其余别动',
    plan: [],
    tool_trace: [],
  };
  const withWarning = {
    ...base,
    agent_result: {
      summary: '已修订。',
      scope_warning: {
        message: '本次定向修订改动了约 100% 的原文行（4/4 行），可能超出指定范围，请在 diff 面板逐块核对后再接受。',
        drift_ratio: 1.0,
      },
    },
  };
  assert.match(scopeWarningFromAgentResult(withWarning), /逐块核对/);
  assert.equal(scopeWarningFromAgentResult({ ...base, agent_result: { summary: '已修订。' } }), null);
});

test('managed Writing Run result id prefers canonical id and falls back to legacy book_run_id', () => {
  const canonical = {
    type: 'agent_result',
    session_id: 'agent-session',
    assistant_session_id: 1,
    intent: 'bookrun.start',
    user_message: '启动写作任务',
    plan: [],
    agent_result: {
      writing_run_id: 700,
      writing_run: {
        writing_run_id: 701,
        scope: 'full_book',
        mode: 'managed',
        status: 'running',
        book_run_id: 7,
      },
      book_run_id: 7,
      book_run: { id: 7 },
    },
    tool_trace: [],
  };
  assert.equal(writingRunIdFromResult(canonical), 700);

  const nestedCanonical = {
    ...canonical,
    agent_result: {
      writing_run: {
        writing_run_id: 701,
        scope: 'full_book',
        mode: 'managed',
        status: 'running',
        book_run_id: 7,
      },
      book_run_id: 7,
      book_run: { id: 7 },
    },
  };
  assert.equal(writingRunIdFromResult(nestedCanonical), 701);

  const legacy = {
    ...canonical,
    agent_result: {
      book_run_id: 7,
      book_run: { id: 8 },
    },
  };
  assert.equal(writingRunIdFromResult(legacy), 7);
});
