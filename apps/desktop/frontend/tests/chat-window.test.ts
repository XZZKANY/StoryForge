import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AgentRunRecoveryPanel,
  applyWritingRunEventProjection,
  buildAgentRunRecoveryDisplay,
  buildStableAgentRequestPayload,
  ChatWindow,
  displayFromResumeDiagnostic,
  extractIssueScopeFromInstruction,
  filePathFromAgentResult,
  repairPatchApproval,
  resolveAgentFilePath,
  reviewIssuesFromReport,
  shouldApplyAgentControlAck,
  scopeWarningFromAgentResult,
  statusFromAgentResult,
  stepsFromResumedAgentResult,
  WritingRunProgressPanel,
  writingRunIdFromResult,
} from '../src/components/ChatWindow';
import { reviewIssueForCurrentFile } from '../src/components/chat-window/review';
import type { AgentRunSavePointProjection } from '../src/lib/api-client';

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

test('revise issue lookup only accepts ids from the active review file', () => {
  const reportFile = 'D:\\Books\\雾港回声\\正文\\第01章.md';
  assert.equal(
    reviewIssueForCurrentFile(
      reviewReport,
      'character-1',
      reportFile,
      'D:/Books/雾港回声/正文/第01章.md',
    )?.id,
    'character-1',
  );
  assert.equal(
    reviewIssueForCurrentFile(
      reviewReport,
      'character-1',
      reportFile,
      'D:\\Books\\雾港回声\\正文\\第02章.md',
    ),
    null,
  );
  assert.equal(
    reviewIssueForCurrentFile(reviewReport, 'missing-issue', reportFile, reportFile),
    null,
  );
  assert.equal(reviewIssueForCurrentFile(reviewReport, 'plot-1', reportFile, null), null);
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

test('stable agent request payload omits file content when project-only chat is used', () => {
  const payload = buildStableAgentRequestPayload({
    projectPath: 'D:\\Books\\雾港回声',
    currentFile: null,
    content: null,
    instruction: '聊一下这本书的主线冲突',
    projectName: '雾港回声',
    assistantSessionId: null,
    reviewReport: null,
    contextBundle: {
      projectRoot: 'D:\\Books\\雾港回声',
      currentFile: null,
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
      files: [],
    },
  });

  assert.equal(payload.current_file, undefined);
  assert.equal(payload.file_path, undefined);
  assert.equal(payload.content, undefined);
  assert.equal(payload.context, undefined);
  assert.equal(payload.selection, undefined);
  assert.equal(payload.context_bundle?.current_file, undefined);
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

  const progressMarkup = renderToStaticMarkup(
    React.createElement(WritingRunProgressPanel, { projection: progress }),
  );
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
  const failedMarkup = renderToStaticMarkup(
    React.createElement(WritingRunProgressPanel, { projection: failed }),
  );
  assert.match(failedMarkup, /最近事件：failed/);
  assert.match(failedMarkup, /预算不足/);
});

function savePointProjection(
  patch: Partial<AgentRunSavePointProjection>,
): AgentRunSavePointProjection {
  return {
    run_id: 'run-1',
    status: 'running',
    current_step: null,
    save_points: [],
    pending: {},
    recoverability: {
      can_retry_from_checkpoint: false,
      latest_checkpoint_artifact_id: null,
      failed_without_checkpoint: false,
      terminal_event_id: null,
      resume_strategy: 'none',
    },
    runtime_recovery: {
      latest_execution_marker: null,
      latest_replay_safe_marker: null,
      latest_failure: null,
      latest_control: null,
      latest_interruption: null,
      latest_resume_diagnostic: null,
      latest_pending_call: null,
      latest_pending_call_resolution: null,
      automatic_resume_supported: false,
      manual_restart_required: false,
    },
    interruption_model: {
      uses_existing_paused_status: false,
      uses_existing_stopped_status: false,
      has_interrupted_event: false,
    },
    ...patch,
  };
}

test('agent run recovery display summarizes pending permission and proposed patch', () => {
  const recovery = buildAgentRunRecoveryDisplay(
    savePointProjection({
      status: 'paused',
      pending: {
        permission_required: true,
        blocked_tool: 'file.revise',
        proposed_patch_artifact_id: 12,
      },
      recoverability: {
        can_retry_from_checkpoint: false,
        latest_checkpoint_artifact_id: null,
        failed_without_checkpoint: false,
        terminal_event_id: null,
        resume_strategy: 'await_permission_decision',
      },
    }),
  );

  assert.ok(recovery);
  assert.equal(recovery.tone, 'waiting');
  assert.equal(recovery.resumeText, '恢复：等待权限确认');
  assert.match(recovery.pendingText ?? '', /等待权限：file\.revise/);
  assert.match(recovery.pendingText ?? '', /待确认补丁 #12/);

  const html = renderToStaticMarkup(React.createElement(AgentRunRecoveryPanel, { recovery }));
  assert.match(html, /data-testid="agent-run-recovery"/);
  assert.match(html, /等待权限：file\.revise/);
});

test('agent run recovery display surfaces checkpoint and latest retry control', () => {
  const recovery = buildAgentRunRecoveryDisplay(
    savePointProjection({
      save_points: [
        {
          kind: 'bookrun_checkpoint',
          source: 'artifact',
          artifact_id: 77,
          artifact_kind: 'bookrun_checkpoint',
          requires_confirmation: false,
          summary: {
            latest_checkpoint_chapter_index: 4,
            completed_count: 3,
            total_chapters: 8,
          },
        },
      ],
      recoverability: {
        can_retry_from_checkpoint: true,
        latest_checkpoint_artifact_id: 77,
        failed_without_checkpoint: false,
        terminal_event_id: null,
        resume_strategy: 'bookrun_checkpoint',
      },
      runtime_recovery: {
        latest_control: {
          event_type: 'retry_from_checkpoint',
          book_run_status: 'running',
        },
      },
    }),
  );

  assert.ok(recovery);
  assert.equal(recovery.canRetryFromCheckpoint, true);
  assert.equal(recovery.tone, 'ok');
  assert.equal(recovery.resumeText, '恢复：可从 BookRun checkpoint 继续');
  assert.equal(recovery.latestControlText, '最近控制：从 checkpoint 重试 · running');
  assert.equal(recovery.checkpointText, 'checkpoint #77 · 第 4 章 · 3/8');
});

test('agent run recovery display keeps failed run without checkpoint conservative', () => {
  const recovery = buildAgentRunRecoveryDisplay(
    savePointProjection({
      status: 'failed',
      recoverability: {
        can_retry_from_checkpoint: false,
        latest_checkpoint_artifact_id: null,
        failed_without_checkpoint: true,
        terminal_event_id: 9,
        resume_strategy: 'manual_restart_required',
      },
      runtime_recovery: {
        manual_restart_required: true,
        latest_failure: {
          event_type: 'agent_run_failed',
          message: 'provider timeout',
        },
      },
    }),
  );

  assert.ok(recovery);
  assert.equal(recovery.tone, 'error');
  assert.equal(recovery.manualRestartRequired, true);
  assert.equal(recovery.resumeText, '恢复：需要手动重启本轮');
  assert.equal(recovery.boundaryText, '最近失败：provider timeout');
});

test('resumed agent result maps to completed recovery steps when no confirmation is needed', () => {
  const response = {
    type: 'agent_result',
    session_id: 'agent-session',
    run_id: 'run-1',
    assistant_session_id: 42,
    intent: 'file.review',
    user_message: '继续审稿',
    plan: [{ step: 'subagents.review', detail: '从 pending boundary 继续', status: 'completed' }],
    agent_result: {
      summary: '审稿完成。',
      requires_user_confirmation: false,
      resumed_from_pending_call: true,
    },
    tool_trace: [
      {
        tool_name: 'file.review',
        status: 'completed',
        input_summary: {},
      },
    ],
  };

  assert.equal(statusFromAgentResult(response), 'completed');
  const steps = stepsFromResumedAgentResult(response);
  assert.equal(steps[0].id, 'resume');
  assert.equal(steps[0].status, 'completed');
  assert.equal(steps.at(-1)?.id, 'approval');
  assert.equal(steps.at(-1)?.status, 'completed');
});

test('resumed agent result preserves waiting status for confirmation results', () => {
  const response = {
    type: 'agent_result',
    session_id: 'agent-session',
    run_id: 'run-1',
    assistant_session_id: 42,
    intent: 'file.revise',
    user_message: '继续修订',
    plan: [{ step: 'file.revise', detail: '生成修订建议', status: 'completed' }],
    agent_result: {
      summary: '已生成修订建议。',
      requires_user_confirmation: true,
    },
    tool_trace: [
      {
        tool_name: 'file.revise',
        status: 'completed',
        input_summary: {},
      },
    ],
  };

  assert.equal(statusFromAgentResult(response), 'waiting');
  const steps = stepsFromResumedAgentResult(response);
  assert.equal(steps[0].detail, 'resume_run 已返回 file.revise');
  assert.equal(steps.at(-1)?.status, 'waiting');
  assert.match(steps.at(-1)?.detail ?? '', /diff 面板/);
});

test('resume diagnostic display marks unsupported pending call as manual restart', () => {
  const display = displayFromResumeDiagnostic({
    reason: 'unsupported_pending_call_intent',
    intent: 'file.revise',
    requires_manual_restart: true,
  });

  assert.equal(display.status, 'failed');
  assert.match(display.message, /暂不支持自动恢复/);
  assert.match(display.message, /file\.revise/);
  assert.match(display.message, /手动重启/);
});

test('resume diagnostic display keeps run waiting when resume command is premature', () => {
  const display = displayFromResumeDiagnostic({
    reason: 'run_not_resumed',
    pending_tool: 'file.review',
    requires_manual_restart: false,
  });

  assert.equal(display.status, 'waiting');
  assert.match(display.message, /尚未进入 resumed 状态/);
  assert.match(display.message, /file\.review/);
});

test('control ack guard ignores stale or mismatched run acknowledgements', () => {
  assert.equal(shouldApplyAgentControlAck('run-2', 'run-1', 'run-1'), false);
  assert.equal(shouldApplyAgentControlAck('run-1', 'run-1', 'run-2'), false);
  assert.equal(shouldApplyAgentControlAck('run-1', 'run-1', 'run-1'), true);
  assert.equal(shouldApplyAgentControlAck('run-1', 'run-1'), true);
});

test('agent result file path prefers review report or proposed patch path', () => {
  assert.equal(
    filePathFromAgentResult({
      type: 'agent_result',
      session_id: 'agent-session',
      assistant_session_id: 1,
      intent: 'file.review',
      user_message: '继续审稿',
      plan: [],
      agent_result: {
        summary: '完成',
        review_report: {
          kind: 'review_report',
          file_path: '正文/第09章.md',
        },
      },
      tool_trace: [],
    }),
    '正文/第09章.md',
  );
  assert.equal(
    filePathFromAgentResult({
      type: 'agent_result',
      session_id: 'agent-session',
      assistant_session_id: 1,
      intent: 'file.revise',
      user_message: '继续修订',
      plan: [],
      agent_result: { summary: '完成', requires_user_confirmation: true },
      tool_trace: [],
      proposed_patch: {
        kind: 'file_revision',
        file_path: '正文/第10章.md',
        before: '旧',
        after: '新',
        requires_confirmation: true,
        approval_action: 'desktop.confirm_file_writeback',
      },
    }),
    '正文/第10章.md',
  );
});

test('agent patch paths are resolved to a contained absolute project path before suggestion dispatch', () => {
  const project = 'D:\\StoryForge\\Books\\雾港回声';

  assert.equal(
    resolveAgentFilePath(project, '正文/第10章.md'),
    'D:\\StoryForge\\Books\\雾港回声\\正文\\第10章.md',
  );
  assert.equal(resolveAgentFilePath(project, '../secret.md'), null);
  assert.equal(resolveAgentFilePath(project, 'D:/outside/secret.md'), null);
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
        message:
          '本次定向修订改动了约 100% 的原文行（4/4 行），可能超出指定范围，请在 diff 面板逐块核对后再接受。',
        drift_ratio: 1.0,
      },
    },
  };
  assert.match(scopeWarningFromAgentResult(withWarning), /逐块核对/);
  assert.equal(
    scopeWarningFromAgentResult({ ...base, agent_result: { summary: '已修订。' } }),
    null,
  );
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

// G2 护栏：ChatWindow 主外壳 renderToStaticMarkup 快照（拆分前固定 trunk 结构）。
// 此处不做 useEffect 级别行为测试（session 相关调用依赖后端），仅固化 launch/empty-trunk 外壳。

test('ChatWindow 主外壳渲染 ConversationHeader 并展示「新的创作会话」标题', () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatWindow, {
      projectPath: 'D:\\Books\\雾港回声',
      currentFile: 'D:\\Books\\雾港回声\\正文\\第01章.md',
      assistantSessionId: null,
    }),
  );
  assert.match(html, /新的创作会话/);
  assert.match(html, /雾港回声 · 正文\\第01章\.md/);
  assert.match(html, /上下文尚未生成/);
  assert.match(html, /data-testid="context-summary"/);
});

test('ChatWindow 在无项目时禁用 composer 并提示打开项目后即可使用 StoryForge', () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatWindow, {
      projectPath: null,
      currentFile: null,
      assistantSessionId: null,
    }),
  );
  assert.match(html, /打开项目后即可使用 StoryForge/);
});

test('ChatWindow 根容器锁定高度，消息流不能把右栏状态栏挤走', () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatWindow, {
      projectPath: 'D:\\Books\\雾港回声',
      currentFile: 'D:\\Books\\雾港回声\\正文\\第01章.md',
      assistantSessionId: null,
    }),
  );
  assert.match(html, /min-h-0/);
  assert.match(html, /overflow-hidden/);
});

test('ChatWindow sends current-file content only after editor flush, before building context bundle', () => {
  const source = readFileSync('src/components/ChatWindow.tsx', 'utf8');
  const contextBuildIndex = source.indexOf('await buildContextBundle({');
  const flushBeforeContextIndex = source.lastIndexOf(
    'await flushActiveEditorToDisk(file);',
    contextBuildIndex,
  );
  assert.ok(contextBuildIndex > 0);
  assert.ok(flushBeforeContextIndex > 0);
});

test('ChatWindow resolves explicit @context through project containment before reading files', () => {
  const source = readFileSync('src/components/ChatWindow.tsx', 'utf8');
  assert.ok(source.includes('resolveProjectRelativePath(projectPath, trimmed)'));
  assert.equal(source.includes('looksAbsolutePath(trimmed) ? trimmed'), false);
});

test('repair patch proposal is surfaced with an executable approval command', () => {
  const base = {
    type: 'agent_result',
    session_id: 'agent-session',
    assistant_session_id: 1,
    intent: 'chapter.review',
    user_message: '审阅这一章',
    plan: [],
    agent_result: { summary: '完成', requires_user_confirmation: true },
    tool_trace: [],
  };

  const proposal = repairPatchApproval({
    ...base,
    proposed_patch: {
      kind: 'repair_patch',
      repair_patch: {
        id: 7,
        target_span: '左臂完好无损',
        replacement_text: '左臂旧伤未愈',
        reason: '回到必含事实约束。',
      },
      requires_confirmation: true,
      approval_command: { command_id: 'judge.approve', args: { repair_patch_id: 7 } },
    },
  });
  assert.ok(proposal);
  assert.match(proposal.summary, /左臂完好无损/);
  assert.match(proposal.summary, /左臂旧伤未愈/);
  assert.match(proposal.summary, /judge\.approve/);
  assert.deepEqual(proposal.command, {
    command_id: 'judge.approve',
    args: { repair_patch_id: 7 },
  });

  // 缺少 approval_command 时必须明说无法从对话内写回，而不是给一个假「批准」。
  const withoutCommand = repairPatchApproval({
    ...base,
    proposed_patch: {
      kind: 'repair_patch',
      repair_patch: { id: 8, target_span: '旧', replacement_text: '新' },
      requires_confirmation: true,
    },
  });
  assert.ok(withoutCommand);
  assert.equal(withoutCommand.command, null);
  assert.match(withoutCommand.summary, /无法从对话内写回/);

  // file_revision 走既有 diff 面板路径，不归 repair patch 处理。
  assert.equal(
    repairPatchApproval({
      ...base,
      proposed_patch: {
        kind: 'file_revision',
        file_path: '正文/第10章.md',
        before: '旧',
        after: '新',
        requires_confirmation: true,
        approval_action: 'desktop.confirm_file_writeback',
      },
    }),
    null,
  );
});
