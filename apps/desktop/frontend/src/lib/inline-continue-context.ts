import { buildContextBundle, readProjectKnowledgeSelection } from './project-context';
import type { ContextBundle } from './project-context';

/** Keep shortcut continuation on the same project/pin seam as conversation writers. */
export async function loadInlineContinueContext(
  projectPath: string | null,
  filePath: string,
): Promise<ContextBundle | null> {
  if (!projectPath) return null;
  return buildContextBundle({
    projectPath,
    currentFile: filePath,
    pinnedFiles: readProjectKnowledgeSelection(projectPath),
  });
}
