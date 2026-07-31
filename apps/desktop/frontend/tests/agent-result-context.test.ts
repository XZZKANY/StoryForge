import { describe, expect, it } from 'vitest';

import { contextFilesFromAgentResult } from '../src/components/chat-window/agent-result';
import type { AgentResultMessage } from '../src/lib/api-client';

function agentResult(toolTrace: AgentResultMessage['tool_trace']): AgentResultMessage {
  return {
    type: 'agent_result',
    session_id: 'session-context-provenance',
    assistant_session_id: 7,
    intent: 'chat.explain',
    user_message: '写第三章',
    plan: [],
    agent_result: { summary: '已生成补丁。', requires_user_confirmation: true },
    tool_trace: toolTrace,
  };
}

describe('contextFilesFromAgentResult', () => {
  it('prefers sanitized backend provenance over the local request bundle', () => {
    const message = agentResult([
      {
        tool_name: 'file.create',
        status: 'completed',
        input_summary: {
          llm_context_snapshot_id: 'llmctx-1234',
          context_provenance: {
            snapshot_id: 'llmctx-1234',
            context_file_count: 5,
            context_files: [
              '.资料\\黄金三章spec.md',
              '.资料/黄金三章spec.md',
              '人物/林岚.md',
              '../outside.md',
              'D:/outside.md',
            ],
            context_source: 'request_bundle',
            warning_count: 0,
          },
        },
      },
    ]);

    expect(contextFilesFromAgentResult(message, ['本地/旧值.md'])).toEqual([
      '.资料/黄金三章spec.md',
      '人物/林岚.md',
    ]);
  });

  it('treats an explicit empty backend provenance as authoritative', () => {
    const message = agentResult([
      {
        tool_name: 'file.revise',
        status: 'completed',
        input_summary: {
          llm_context_snapshot_id: 'llmctx-empty',
          context_provenance: {
            snapshot_id: 'llmctx-empty',
            context_file_count: 0,
            context_files: [],
            context_source: 'request_bundle',
            warning_count: 0,
          },
        },
      },
    ]);

    expect(contextFilesFromAgentResult(message, ['大纲/本地回退.md'])).toEqual([]);
  });

  it('falls back to stable sanitized local paths for old responses without provenance', () => {
    const message = agentResult([
      {
        tool_name: 'file.create',
        status: 'completed',
        input_summary: { path: '正文/第03章.md' },
      },
    ]);

    expect(
      contextFilesFromAgentResult(message, [
        '大纲\\总纲.md',
        '大纲/总纲.md',
        '/outside.md',
        '人物/林岚.md',
      ]),
    ).toEqual(['大纲/总纲.md', '人物/林岚.md']);
  });
});
