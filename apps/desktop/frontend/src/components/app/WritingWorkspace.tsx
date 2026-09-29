import { Editor } from '../Editor';
import { EditorTabs, type CenterTab } from '../shell/EditorTabs';
import { ObsPanel } from '../shell/ObsPanel';
import {
  emitEditorCommand,
  emitChapterPolishRequest,
  emitExportCurrentFile,
  flushActiveEditorToDisk,
} from '../../lib/assistant-events';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { AppShellProps } from './app-shell-types';

/** Mounted regardless of the current surface; Editor remains the state owner. */
export function WritingWorkspace({
  hidden,
  workspace,
  tabs,
  preferences,
  dialogs,
  shell,
  initialCursors,
  onCursorPersist,
  onPendingSuggestionChange,
  obsPanelOpen,
  setObsPanelOpen,
  observatory,
  onOverview,
  activeCenterTab,
  permissionProfile,
}: Pick<
  AppShellProps,
  | 'workspace'
  | 'tabs'
  | 'preferences'
  | 'dialogs'
  | 'shell'
  | 'initialCursors'
  | 'onCursorPersist'
  | 'onPendingSuggestionChange'
  | 'obsPanelOpen'
  | 'setObsPanelOpen'
  | 'observatory'
> & {
  hidden: boolean;
  onOverview?: () => void;
  activeCenterTab: CenterTab | null;
  /** P2-D：编辑器区对项目档位做被动指示（只读档徽标 + 自动档提示），业务判定仍在后端。 */
  permissionProfile?: AgentPermissionProfile;
}) {
  return (
    <div
      className={`${hidden ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col overflow-hidden`}
      hidden={hidden}
      data-testid="writing-workspace-surface"
    >
      <EditorTabs
        openFiles={tabs.openFiles}
        activeFile={workspace.currentFile}
        previewFile={tabs.previewFile}
        dirtyFiles={tabs.dirtyFiles}
        activeTab={activeCenterTab}
        onOverview={onOverview}
        activeReadOnly={
          tabs.displayedFile ? isReadOnlyDerivedProjectPath(tabs.displayedFile) : false
        }
        permissionProfile={permissionProfile}
        onFocusFile={tabs.focusFile}
        onReorderFiles={tabs.reorderOpenFiles}
        onFocusPreview={tabs.focusPreview}
        onPinPreview={tabs.pinPreview}
        onCloseFile={(path) => void tabs.handleFileClose(path)}
        onClosePreview={tabs.closePreview}
        onSaveActive={() => {
          if (tabs.displayedFile)
            void flushActiveEditorToDisk(tabs.displayedFile).catch(() => undefined);
        }}
        onToggleHistory={() => emitEditorCommand('toggle-history')}
        onExportActive={() => emitExportCurrentFile()}
        onPolishActive={(useMainModel) => emitChapterPolishRequest({ useMainModel })}
        onCloseOthers={() => void tabs.handleCloseOthers()}
        onCloseAll={() => void tabs.handleCloseAll()}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <section
          className="h-full min-h-0 overflow-hidden bg-background"
          data-testid="editor-panel"
        >
          <Editor
            projectPath={workspace.activeProject}
            filePath={tabs.displayedFile}
            editorFontSize={preferences.settings.editorFontSize}
            editorFontMode={preferences.settings.editorFontMode}
            editorProseMeasure={preferences.settings.editorProseMeasure}
            editorLineNumbers={preferences.settings.editorLineNumbers}
            autoSave={preferences.settings.autoSave}
            retainedFilePaths={tabs.retainedEditorFiles}
            onDirtyChange={tabs.handleEditorDirtyChange}
            initialCursors={initialCursors}
            onCursorPersist={onCursorPersist}
            dropOpenFilePath={tabs.dropOpenFilePath}
            sidebarVisible={!shell.sidebarHidden}
            dialogs={dialogs}
            onPendingSuggestionChange={onPendingSuggestionChange}
          />
        </section>
      </div>
      {obsPanelOpen && workspace.activeProject && (
        <ObsPanel
          observations={observatory.observations}
          availability={observatory.availability}
          onClose={() => setObsPanelOpen(false)}
          onResolve={observatory.resolveObservation}
          onLocate={observatory.locateObservation}
        />
      )}
    </div>
  );
}
