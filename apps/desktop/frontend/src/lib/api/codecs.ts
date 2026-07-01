import type { AssistantContextBundlePayload, ReviseRequest } from './types';

export function toAssistantContextBundlePayload(
  contextBundle: ReviseRequest['contextBundle'],
): AssistantContextBundlePayload | null {
  if (!contextBundle) return null;
  return {
    project_root: contextBundle.projectRoot,
    ...(contextBundle.currentFile ? { current_file: contextBundle.currentFile } : {}),
    files: contextBundle.files.map((file) => ({
      path: file.path,
      relative_path: file.relativePath,
      kind: file.kind,
      title: file.title,
      excerpt: file.excerpt,
    })),
    summary: contextBundle.summary,
    budget: contextBundle.budget
      ? {
          file_count: contextBundle.budget.fileCount,
          char_count: contextBundle.budget.charCount,
          max_files: contextBundle.budget.maxFiles,
          max_excerpt_chars: contextBundle.budget.maxExcerptChars,
          truncated: contextBundle.budget.truncated,
          pinned_file_count: contextBundle.budget.pinnedFileCount,
          missing_pinned_files: contextBundle.budget.missingPinnedFiles,
        }
      : undefined,
  };
}
