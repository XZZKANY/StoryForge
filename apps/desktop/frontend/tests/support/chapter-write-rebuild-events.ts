import type { AgentRunEventRecord } from '../../src/lib/api/agent-run-events';

export const CHAPTER_TRUNCATION_WARNING = {
  message:
    'AI 写的这一章疑似没写完：正文停在半句（「…他推开门，看见」）。这条修订要你点接受才会写进文件，请先在对比里看看结尾，或让 AI 重写这一章。',
  missing_line_count: 0,
  missing_headings: [],
  ends_mid_sentence: true,
};

const artifact = (kind: string, payload: Record<string, unknown>): AgentRunEventRecord => ({
  event_type: 'agent_artifact',
  payload: { kind, requires_confirmation: kind === 'proposed_patch', payload },
});

/** 照引擎写章流程落库的顺序：确认章纲后的新一次执行 → 轨迹 → 产物 → 停在待确认。 */
export function chapterWriteRebuildEvents(fields: {
  patch: { id: string; file_path: string; before: string; after: string };
  truncationWarning: Record<string, unknown> | null;
}): AgentRunEventRecord[] {
  const patch = {
    ...fields.patch,
    kind: 'file_revision',
    created_by_tool: 'chapter.write',
    requires_confirmation: true,
    approval_action: 'desktop.confirm_file_writeback',
    brief_id: 'brief-1',
  };
  const check = {
    status: 'pass',
    execution_status: 'completed',
    manuscript_hard_failure_count: 0,
    attempt: 1,
    repair_count: 0,
    recheck_count: 0,
    ...(fields.truncationWarning ? { truncation_warning: fields.truncationWarning } : {}),
  };
  const trace = (tool_name: string): AgentRunEventRecord => ({
    event_type: 'tool_trace',
    payload: { trace: { tool_name, status: 'completed', input_summary: {} } },
  });
  return [
    { id: 11, event_type: 'agent_execution_started', payload: {} },
    trace('chapter.draft'),
    trace('chapter.check'),
    artifact('chapter_brief', { brief_id: 'brief-1' }),
    artifact('chapter_check', check),
    artifact('runtime_pending_call_resolution', {}),
    artifact('proposed_patch', patch),
    {
      event_type: 'permission_required',
      message: '该步骤需要作者确认后才能继续。',
      payload: {
        execution_id: 11,
        intent: 'chapter.write',
        assistant_session_id: 7,
        summary: fields.truncationWarning
          ? `章节草稿通过了章纲检查。 ${String(fields.truncationWarning.message)}`
          : '章节草稿通过了章纲检查。',
        requires_user_confirmation: true,
        proposed_patch: patch,
        blocked_tool: 'chapter.write',
      },
    },
  ];
}
