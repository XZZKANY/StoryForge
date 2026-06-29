import { useCallback, useState } from 'react';
import type { ComposerLayoutMode } from '../DynamicIDELayout';
import type { LayoutMode } from './helpers';

export function useShellLayout() {
  const [workspaceVisible, setWorkspaceVisible] = useState(true);
  const [editorVisible, setEditorVisible] = useState(true);
  const [composerMode, setComposerMode] = useState<ComposerLayoutMode>('panel');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('normal');

  const restoreFullLayout = useCallback(() => {
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode('panel');
    setLayoutMode('normal');
  }, []);

  const focusAssistantOnly = useCallback(() => {
    setWorkspaceVisible(false);
    setEditorVisible(false);
    setComposerMode('full');
    setLayoutMode('assistant-only');
  }, []);

  const focusWorkspaceOnly = useCallback(() => {
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode('floating');
    setLayoutMode('workspace-only');
  }, []);

  const markCustomLayout = useCallback(() => {
    setLayoutMode('custom');
    setEditorVisible(true);
  }, []);

  const showWorkbenchPanel = useCallback(() => {
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode('panel');
    setLayoutMode('custom');
  }, []);

  const showEditorForFile = useCallback(() => {
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode((mode) => (mode === 'full' ? 'panel' : mode));
  }, []);

  const restoreWorkspacePanel = useCallback(() => {
    setLayoutMode('custom');
    setWorkspaceVisible(true);
    setEditorVisible(true);
    setComposerMode((mode) => (mode === 'full' ? 'panel' : mode));
  }, []);

  const toggleWorkspace = useCallback(() => {
    setLayoutMode('custom');
    setEditorVisible(true);
    setWorkspaceVisible((visible) => !visible);
  }, []);

  const toggleWorkspaceWithEditor = useCallback(() => {
    setLayoutMode('custom');
    setWorkspaceVisible((visible) => !visible);
    setEditorVisible(true);
  }, []);

  const applyComposerMode = useCallback((mode: ComposerLayoutMode) => {
    setComposerMode(mode);
    setLayoutMode(
      mode === 'full' ? 'assistant-only' : mode === 'floating' ? 'workspace-only' : 'custom',
    );
    if (mode === 'full') {
      setWorkspaceVisible(false);
      setEditorVisible(false);
      return;
    }
    setWorkspaceVisible(true);
    setEditorVisible(true);
  }, []);

  const prepareSettingsLayout = useCallback(() => {
    setComposerMode((mode) => (mode === 'floating' ? 'panel' : mode));
    setLayoutMode('custom');
  }, []);

  return {
    workspaceVisible,
    editorVisible,
    composerMode,
    layoutMode,
    restoreFullLayout,
    focusAssistantOnly,
    focusWorkspaceOnly,
    markCustomLayout,
    showWorkbenchPanel,
    showEditorForFile,
    restoreWorkspacePanel,
    toggleWorkspace,
    toggleWorkspaceWithEditor,
    applyComposerMode,
    prepareSettingsLayout,
  };
}
