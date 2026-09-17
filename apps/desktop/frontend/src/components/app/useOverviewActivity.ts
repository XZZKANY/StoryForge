import { useCallback, useState } from 'react';
import type { EditorPendingSuggestionSummary } from '../Editor';
import type { AgentRunOverviewSummary } from '../chat-window/types';

/** Only a read-only, project-scoped view of the existing Editor/Chat owners. */
export function useOverviewActivity({
  projectPath,
  displayedFile,
  openFile,
  showEditor,
}: {
  projectPath: string | null;
  displayedFile: string | null;
  openFile: (path: string, actionLabel?: string) => Promise<void>;
  showEditor: () => void;
}) {
  const [pending, setPending] = useState<EditorPendingSuggestionSummary | null>(null);
  const [run, setRun] = useState<AgentRunOverviewSummary | null>(null);
  const onPendingChange = useCallback(
    (value: EditorPendingSuggestionSummary | null) => {
      if (!value || value.projectPath === projectPath) setPending(value);
    },
    [projectPath],
  );
  const onRunChange = useCallback(
    (value: AgentRunOverviewSummary | null) => {
      if (!value || value.projectPath === projectPath) setRun(value);
    },
    [projectPath],
  );
  const pendingSuggestion = pending?.projectPath === projectPath ? pending : null;
  const agentRun = run?.projectPath === projectPath ? run : null;
  const openPendingSuggestion = useCallback(() => {
    showEditor();
    if (pendingSuggestion && displayedFile !== pendingSuggestion.filePath) {
      void openFile(pendingSuggestion.filePath, '打开待确认修改');
    }
  }, [displayedFile, openFile, pendingSuggestion, showEditor]);
  return { pendingSuggestion, agentRun, onPendingChange, onRunChange, openPendingSuggestion };
}
