import type { Dispatch, SetStateAction } from 'react';

import type { PaletteMode } from '../CommandPalette';
import type { Observation } from '../shell/ObsPanel';
import type { useShellState } from '../shell/useShellState';
import type { ObservationAnchor } from '../../lib/observations';
import type { FileCursor } from '../../lib/workspace-session';
import type { useAppDialog } from './AppDialog';
import type { AppPreferences } from './useAppPreferences';
import type { BookContextHandle } from './useBookContext';
import type { BookProfileHandle } from './useBookProfile';
import type { EditorWorkspaceTabs } from './useEditorWorkspaceTabs';
import type { useObservatory } from './useObservatory';
import type { ProjectCommands } from './useProjectCommands';
import type { useProjectSearch } from './useProjectSearch';

type WorkspaceProps = {
  projects: string[];
  activeProject: string | null;
  currentFile: string | null;
  projectAssistantSessions: Record<string, number>;
  setActiveProjectAssistantSession: (
    assistantSessionId: number | null,
    projectOverride?: string,
  ) => void;
};

type RuntimeProps = {
  isDesktopRuntime: boolean;
  tauriMenuReady: boolean;
  tauriMenuError: string;
  smokeApiReady: boolean;
};

/** 观测句柄：useObservatory 全量数据 + App 级定位回调（观测行 / 台账锚点两种入口）。 */
export type ObservatoryHandle = ReturnType<typeof useObservatory> & {
  locateObservation: (observation: Observation) => void;
  locateAnchor: (anchor: ObservationAnchor) => void;
};

export type AppShellProps = {
  onUnsentInputChange?: (hasInput: boolean) => void;
  confirmDiscardInput?: (action: string) => Promise<boolean>;
  workspace: WorkspaceProps;
  tabs: EditorWorkspaceTabs;
  commands: ProjectCommands;
  preferences: AppPreferences;
  shell: ReturnType<typeof useShellState>;
  dialogs: ReturnType<typeof useAppDialog>;
  runtime: RuntimeProps;
  settingsVisible: boolean;
  setSettingsVisible: Dispatch<SetStateAction<boolean>>;
  palette: PaletteMode | null;
  setPalette: Dispatch<SetStateAction<PaletteMode | null>>;
  obsPanelOpen: boolean;
  setObsPanelOpen: Dispatch<SetStateAction<boolean>>;
  toggleObsPanel: () => void;
  observatory: ObservatoryHandle;
  /** 手稿视图：作品底座只读投影 + 点章节行打开该章。 */
  bookContext: BookContextHandle;
  onOpenManuscriptChapter: (relativePath: string) => void;
  /** 作品视图：档案（book.json）+ 现算的进度 / 大纲 / 速记。 */
  bookProfile: BookProfileHandle;
  onOpenOutlineHeading: (path: string, line: number) => void;
  openSettings: () => Promise<void>;
  welcomeDismissed: boolean;
  onCloseWelcome: () => void;
  onReopenWelcome: () => void;
  /** 恢复现场：上次的光标位置 + 光标回写口子（写作时刻 01）。 */
  initialCursors: Record<string, FileCursor> | null;
  onCursorPersist: (filePath: string, cursor: FileCursor) => void;
  search: ReturnType<typeof useProjectSearch>;
  onOpenSearchHit: (path: string, line: number) => void;
};
