import { emitFileSuggestion, emitSuggestionResult } from '../../lib/assistant-events';
import { createRemoteFileSuggestion } from '../../lib/assistant-suggestions';
import {
  issueIdsFromAgentResult,
  issueScopesFromAgentResult,
  modelFromToolTrace,
  resolveProposedPatchFilePath,
  writableFilePatch,
  writingContextFromAgentResult,
} from './agent-result';
import {
  lengthHintFromAgentResult,
  scopeWarningFromAgentResult,
  truncationWarningFromAgentResult,
} from './review';
import type { AgentRunStatus, ChatWindowAgentResult } from './types';

/**
 * 把 Agent 返回的 proposed patch 投成编辑器建议事件。
 * 目标不在当前项目内即阻断写回并报错；成功则发 ready 建议并停在 waiting，
 * 两种情况都由调用方结束本轮（原实现两分支都以 return 收尾）。
 * 返回交给编辑器的目标文件；被拦下（不在作品里）为 null。
 */
export function emitProposedPatchOutcome(params: {
  response: ChatWindowAgentResult;
  proposed: NonNullable<ReturnType<typeof writableFilePatch>>;
  contextRelativePaths: string[];
  projectPath: string | null;
  goal: string;
  runId: string;
  settleDiagnostic: (detail: string) => void;
  settleText: (content: string, append?: boolean) => void;
  updateAgentStatus: (status: AgentRunStatus) => void;
}): string | null {
  const { response, proposed } = params;
  const writingContext = writingContextFromAgentResult(response, params.contextRelativePaths);
  const filePath = resolveProposedPatchFilePath(params.projectPath, proposed.file_path);
  if (!filePath) {
    const message = 'AI 返回的修订目标不在当前作品内，没有写进文件。';
    params.settleDiagnostic(message);
    emitSuggestionResult({
      filePath: proposed.file_path,
      status: 'error',
      message,
      assistantSessionId: response.assistant_session_id,
    });
    params.updateAgentStatus('failed');
    return null;
  }
  params.settleText(response.agent_result.summary ?? '已生成待确认修订。', false);
  emitFileSuggestion(
    createRemoteFileSuggestion({
      id: proposed.id,
      filePath,
      before: proposed.before,
      after: proposed.after,
      summary: response.agent_result.summary ?? 'AI 已生成修订建议。',
      model: modelFromToolTrace(response),
      userIntent: params.goal,
      assistantSessionId: response.assistant_session_id,
      issueIds: issueIdsFromAgentResult(response),
      issueScopes: issueScopesFromAgentResult(response),
      contextFiles: writingContext.contextFiles,
      knowledgeEntries: writingContext.knowledgeEntries,
      scopeWarning: scopeWarningFromAgentResult(response) ?? undefined,
      truncationWarning: truncationWarningFromAgentResult(response) ?? undefined,
      lengthHint: lengthHintFromAgentResult(response) ?? undefined,
      requiresConfirmation: proposed.requires_confirmation,
      runId: response.run_id ?? params.runId,
    }),
  );
  emitSuggestionResult({
    filePath,
    status: 'ready',
    message: response.agent_result.summary ?? 'AI 已生成修订建议。',
    assistantSessionId: response.assistant_session_id,
  });
  params.updateAgentStatus('waiting');
  return filePath;
}
