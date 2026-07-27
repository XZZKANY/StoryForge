import { toAssistantContextBundlePayload } from '../../lib/api-client';
import type { EditorAuthorViewDetail } from '../../lib/assistant-events';
import type { ContextBundle } from '../../lib/project-context';
import { extractIssueScopeFromInstruction } from './review';
import type { AuthorViewPayload, ReviewReport, StableAgentRequestPayload } from './types';

export function buildStableAgentRequestPayload(params: {
  projectPath: string;
  currentFile: string | null;
  content: string | null;
  instruction: string;
  projectName: string | null;
  assistantSessionId: number | null;
  contextBundle: ContextBundle;
  reviewReport: ReviewReport | null;
  authorView: EditorAuthorViewDetail | null;
}): StableAgentRequestPayload {
  const scope = extractIssueScopeFromInstruction(params.instruction, params.reviewReport);
  // 此前这里还发 context / selection 两个与 content 同值的整篇正文键，后端从不读，
  // 且 selection 的名字骗人（选区从没进过请求）。真选区改由 author_view 携带。
  const filePayload =
    params.currentFile && params.content !== null
      ? {
          current_file: params.currentFile,
          file_path: params.currentFile,
          content: params.content,
        }
      : {};
  return {
    project_path: params.projectPath,
    instruction: params.instruction,
    project_name: params.projectName,
    assistant_session_id: params.assistantSessionId,
    context_bundle: toAssistantContextBundlePayload(params.contextBundle),
    ...filePayload,
    ...authorViewPayload(params.authorView, params.currentFile),
    ...(params.reviewReport ? { review_report: params.reviewReport } : {}),
    ...scope,
  };
}

/** 作者视图只在与当前打开文件同源时才发：切了文件而编辑器还没广播新视图时宁可不发。 */
function authorViewPayload(
  view: EditorAuthorViewDetail | null,
  currentFile: string | null,
): { author_view?: AuthorViewPayload } {
  if (!view || !currentFile || view.filePath !== currentFile) return {};
  if (view.cursorLine <= 0 && !view.selectionText) return {};
  return {
    author_view: {
      file_path: currentFile,
      cursor_line: view.cursorLine,
      cursor_column: view.cursorColumn,
      selection_text: view.selectionText,
    },
  };
}
