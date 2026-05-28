'use client';

import type { Diagnostic } from '../../../../../packages/shared/src/diagnostic';
import type { ContextSnapshot } from '../views/ContextInspector';
import type { ArtifactViewerPreview } from '../views/ArtifactViewer';
import type { BookRunEventSnapshot } from '../views/BookRunEventsPanel';
import type { BookRunPanelRun } from '../views/BookRunPanel';
import type { StoryMemoryResult } from '../views/StoryMemoryExplorer';

export type IdeStoreState = {
  readonly tabs: readonly string[];
  readonly activeTabId?: string;
  readonly leftPanel: string;
  readonly bottomPanel: string;
  readonly workspace?: string;
  readonly bookId?: number;
  readonly inspectorId?: string;
  readonly artifactId?: number;
  readonly bookRunId?: number;
  readonly bookRun?: BookRunPanelRun;
  readonly bookRunEvents?: readonly BookRunEventSnapshot[];
  readonly artifactPreview?: ArtifactViewerPreview;
  readonly contextSnapshot?: ContextSnapshot;
  readonly contextSnapshotEvictedAt?: string;
  readonly storyMemoryResult?: StoryMemoryResult;
  readonly sceneId?: number;
  readonly sceneContent?: string;
  readonly diagnostics?: readonly Diagnostic[];
};

export function createInitialIdeState(overrides: Partial<IdeStoreState> = {}): IdeStoreState {
  const tabs = overrides.tabs && overrides.tabs.length > 0 ? overrides.tabs : ['legacy:studio'];
  return {
    tabs,
    activeTabId: overrides.activeTabId ?? tabs[0],
    leftPanel: overrides.leftPanel ?? 'explorer',
    bottomPanel: overrides.bottomPanel ?? 'problems',
    workspace: overrides.workspace,
    bookId: overrides.bookId,
    inspectorId: overrides.inspectorId,
    artifactId: overrides.artifactId,
    bookRunId: overrides.bookRunId,
    bookRun: overrides.bookRun,
    bookRunEvents: overrides.bookRunEvents,
    artifactPreview: overrides.artifactPreview,
    contextSnapshot: overrides.contextSnapshot,
    contextSnapshotEvictedAt: overrides.contextSnapshotEvictedAt,
    storyMemoryResult: overrides.storyMemoryResult,
    sceneId: overrides.sceneId,
    sceneContent: overrides.sceneContent,
    diagnostics: overrides.diagnostics,
  };
}
