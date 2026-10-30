import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  planStepTitle,
  stepFromAgentPlanEvent,
  stepFromToolTraceEvent,
  stepsFromAgentResult,
  toolStepTitle,
  toolTraceDetail,
} from '../src/components/chat-window/agent-step-mapping';
import type { AgentToolTrace } from '../src/lib/api/types';

const trace = (overrides: Partial<AgentToolTrace>): AgentToolTrace => ({
  tool_name: 'fs.read',
  status: 'completed',
  input_summary: {},
  ...overrides,
});

test('tool steps read as an action on a file or a query, not as a tool id', () => {
  assert.equal(
    toolStepTitle(trace({ input_summary: { path: '正文/第005章.md' } })),
    '读取 正文/第005章.md',
  );
  assert.equal(
    toolStepTitle(trace({ tool_name: 'fs.search', input_summary: { query: '刘哥' } })),
    '搜索「刘哥」',
  );
  assert.equal(
    toolStepTitle(
      trace({
        tool_name: 'file.revise',
        input_summary: { path: '正文/第005章.md', instruction: '改结尾' },
      }),
    ),
    '改写 正文/第005章.md',
  );
  // 改稿记的是 file_path（相对项目根）；绝对路径只留文件名。
  assert.equal(
    toolStepTitle(
      trace({ tool_name: 'file.revise', input_summary: { file_path: '正文/第005章.md' } }),
    ),
    '改写 正文/第005章.md',
  );
  assert.equal(
    toolStepTitle(
      trace({
        tool_name: 'file.create',
        input_summary: { file_path: 'D:\\连载\\末世吞噬\\正文\\第006章.md' },
      }),
    ),
    '起草新文件 第006章.md',
  );
  assert.equal(toolStepTitle(trace({ tool_name: 'project.prose_check' })), '文笔检查');
  // 不认识的工具照原名，不编造说法。
  assert.equal(toolStepTitle(trace({ tool_name: 'mcp.unknown' })), 'mcp.unknown');
  const live = stepFromToolTraceEvent(0, trace({ input_summary: { path: '正文/第005章.md' } }));
  assert.equal(live.title, '读取 正文/第005章.md');
  assert.equal(live.tool, 'fs.read');
});

test('tool step metrics: right-side meta in author order, model only for the hover title', () => {
  const step = stepFromToolTraceEvent(
    0,
    trace({
      tool_name: 'file.review',
      output_summary: {
        model: 'gpt-6.1-terra',
        latency_ms: 220535,
        context_file_count: 4,
        issue_count: 3,
        suggested_action_count: 2,
      },
    }),
  );
  assert.deepEqual(step.metrics, ['问题 3 个', '建议 2 条', '上下文 4 个', '3 分 41 秒']);
  assert.equal(step.model, 'gpt-6.1-terra');
  assert.deepEqual(
    stepFromToolTraceEvent(0, trace({ output_summary: { latency_ms: 999 } })).metrics,
    ['不到 1 秒'],
  );
  assert.equal(stepFromToolTraceEvent(0, trace({})).model, undefined);
});

test('tool detail drops the English status; the glyph already says done or failed', () => {
  assert.equal(toolTraceDetail(trace({})), '');
  assert.equal(
    toolTraceDetail(
      trace({ output_summary: { model: 'deepseek-v4', latency_ms: 42, issue_count: 3 } }),
    ),
    '模型 deepseek-v4；不到 1 秒；问题 3 个',
  );
  assert.equal(toolTraceDetail(trace({ output_summary: { latency_ms: 220535 } })), '3 分 41 秒');
  assert.equal(
    toolTraceDetail(trace({ status: 'failed', error_message: '文件不存在' })),
    '文件不存在',
  );
  assert.doesNotMatch(toolTraceDetail(trace({ output_summary: { model: 'x' } })), /completed/);
});

test('plan steps from the chat loop speak plainly', () => {
  assert.equal(planStepTitle('agent.loop'), '整理回答');
  assert.equal(planStepTitle('permission.confirm'), '等你确认');
  assert.equal(planStepTitle('chapter.brief'), '拟章纲');
  assert.equal(planStepTitle('judge.run'), '自检');
  assert.equal(
    stepFromAgentPlanEvent(0, 'agent.loop', '工具循环完成：2 轮、1 次工具调用。', 'completed')
      .detail,
    '完成：2 轮、1 次工具调用。',
  );
  // 模型请求的进度说明（重试、退避）原样保留。
  assert.equal(
    stepFromAgentPlanEvent(-1, 'agent.provider', '模型请求暂不可用，等待 0.5 秒后重试。', 'running')
      .detail,
    '模型请求暂不可用，等待 0.5 秒后重试。',
  );
  const settled = stepsFromAgentResult({
    type: 'agent_result',
    session_id: 's',
    run_id: 'r',
    assistant_session_id: 1,
    user_message: '看看第 5 章',
    intent: 'chat.explain',
    plan: [
      { step: 'agent.loop', detail: '工具循环完成：2 轮、1 次工具调用。', status: 'completed' },
    ],
    tool_trace: [trace({ input_summary: { path: '正文/第005章.md' } })],
    agent_result: { summary: '读完了', requires_user_confirmation: false },
  });
  assert.deepEqual(
    settled.map((step) => [step.title, step.detail]),
    [
      ['整理回答', '完成：2 轮、1 次工具调用。'],
      ['读取 正文/第005章.md', ''],
    ],
  );
});
