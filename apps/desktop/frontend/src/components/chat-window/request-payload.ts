import { toAssistantContextBundlePayload } from '../../lib/api-client';
import type { ContextBundle } from '../../lib/project-context';
import { extractIssueScopeFromInstruction } from './review';
import type { ReviewReport, StableAgentRequestPayload } from './types';

export function buildStableAgentRequestPayload(params: {
  projectPath: string;
  currentFile: string;
  content: string;
  instruction: string;
  projectName: string | null;
  assistantSessionId: number | null;
  contextBundle: ContextBundle;
  reviewReport: ReviewReport | null;
}): StableAgentRequestPayload {
  const scope = extractIssueScopeFromInstruction(params.instruction, params.reviewReport);
  return {
    project_path: params.projectPath,
    current_file: params.currentFile,
    file_path: params.currentFile,
    content: params.content,
    instruction: params.instruction,
    context: params.content,
    selection: params.content,
    project_name: params.projectName,
    assistant_session_id: params.assistantSessionId,
    context_bundle: toAssistantContextBundlePayload(params.contextBundle),
    ...(params.reviewReport ? { review_report: params.reviewReport } : {}),
    ...scope,
  };
}
