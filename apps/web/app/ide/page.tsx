import type { Diagnostic } from '@storyforge/shared';
import { IdeShellPreferencesHydrator } from '../../components/ide/shell/IdeShellPreferencesHydrator';
import type { ArtifactViewerPreview } from '../../components/ide/views/ArtifactViewer';
import type { ContextSnapshot } from '../../components/ide/views/ContextInspector';
import type { BookRunEventSnapshot } from '../../components/ide/views/BookRunEventsPanel';
import type { BookRunPanelRun } from '../../components/ide/views/BookRunPanel';
import type {
  StoryMemoryConflict,
  StoryMemoryItem,
  StoryMemoryResult,
} from '../../components/ide/views/StoryMemoryExplorer';
import { parseIdeUrlState } from '../../components/ide/url/ide-url-state';
import { apiFetch, readJson } from '../../lib/api-client';

export default async function IdePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedParams)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  const state = parseIdeUrlState(params);
  const contextState = state.inspectorId ? await readContextSnapshot(state.inspectorId) : {};
  const storyMemoryState =
    state.leftPanel === 'memory' && state.bookId !== undefined
      ? await readStoryMemoryResult(state.bookId)
      : {};
  const artifactState =
    state.bottomPanel === 'artifacts' &&
    state.artifactId !== undefined &&
    state.workspaceId !== undefined
      ? await readArtifactPreview(state.artifactId, state.workspaceId)
      : {};
  const bookRunState =
    state.bottomPanel === 'runs' && state.bookRunId !== undefined
      ? await readBookRunPanelState(state.bookRunId)
      : {};
  const sceneState =
    state.sceneId !== undefined ? await readSceneWorkbenchState(state.sceneId) : {};
  return (
    <IdeShellPreferencesHydrator
      initialState={{
        ...state,
        ...contextState,
        ...storyMemoryState,
        ...artifactState,
        ...bookRunState,
        ...sceneState,
      }}
    />
  );
}

type IdeSceneRead = {
  readonly id: number;
  readonly chapter_id: number;
  readonly book_id: number;
  readonly title: string;
  readonly status: string;
  readonly content: string;
};

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!value || typeof value !== 'object') return false;
  const diagnostic = value as Record<string, unknown>;
  const range = diagnostic.range as Record<string, unknown> | undefined;
  return (
    typeof diagnostic.id === 'string' &&
    typeof diagnostic.severity === 'string' &&
    typeof diagnostic.code === 'string' &&
    typeof diagnostic.message === 'string' &&
    !!range &&
    typeof range.start === 'number' &&
    typeof range.end === 'number' &&
    typeof diagnostic.source === 'string' &&
    (diagnostic.quickFixes === undefined || Array.isArray(diagnostic.quickFixes))
  );
}

function isDiagnosticList(value: unknown): value is readonly Diagnostic[] {
  return Array.isArray(value) && value.every(isDiagnostic);
}

function isIdeSceneRead(value: unknown): value is IdeSceneRead {
  if (!value || typeof value !== 'object') return false;
  const scene = value as Record<string, unknown>;
  return (
    typeof scene.id === 'number' &&
    typeof scene.chapter_id === 'number' &&
    typeof scene.book_id === 'number' &&
    typeof scene.title === 'string' &&
    typeof scene.status === 'string' &&
    typeof scene.content === 'string'
  );
}

async function readSceneWorkbenchState(sceneId: number): Promise<{
  readonly sceneId?: number;
  readonly sceneContent?: string;
  readonly diagnostics?: readonly Diagnostic[];
}> {
  const [sceneResult, diagnosticsResult] = await Promise.all([
    readJson<IdeSceneRead>(`/api/ide/scenes/${sceneId}`, {
      validate: isIdeSceneRead,
      invalidMessage: 'IDE 场景响应格式错误',
    }),
    readJson<readonly Diagnostic[]>('/api/ide/diagnostics', {
      params: { scene_id: sceneId },
      validate: isDiagnosticList,
      invalidMessage: 'IDE diagnostics 响应格式错误',
    }),
  ]);
  return {
    sceneId,
    sceneContent: sceneResult.status === 'ready' ? sceneResult.data.content : '',
    diagnostics: diagnosticsResult.status === 'ready' ? diagnosticsResult.data : [],
  };
}

function isContextBlockRef(value: unknown): value is ContextSnapshot['injected_blocks'][number] {
  if (!value || typeof value !== 'object') return false;
  const block = value as Record<string, unknown>;
  return (
    typeof block.block_id === 'string' &&
    typeof block.kind === 'string' &&
    typeof block.source_ref === 'string' &&
    typeof block.token_count === 'number' &&
    typeof block.priority === 'string' &&
    typeof block.reason === 'string'
  );
}

function isContextSnapshot(value: unknown): value is ContextSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  const budget = snapshot.budget as Record<string, unknown> | undefined;
  return (
    typeof snapshot.compiled_context_id === 'string' &&
    typeof snapshot.book_id === 'number' &&
    typeof snapshot.chapter_id === 'number' &&
    typeof snapshot.scene_id === 'number' &&
    !!budget &&
    typeof budget.token_budget === 'number' &&
    typeof budget.used_tokens === 'number' &&
    typeof budget.dropped_tokens === 'number' &&
    typeof budget.truncated === 'boolean' &&
    Array.isArray(snapshot.injected_blocks) &&
    snapshot.injected_blocks.every(isContextBlockRef) &&
    Array.isArray(snapshot.dropped_blocks) &&
    snapshot.dropped_blocks.every(isContextBlockRef) &&
    Array.isArray(snapshot.debug_summary) &&
    snapshot.debug_summary.every((item) => typeof item === 'string')
  );
}

async function readContextSnapshot(inspectorId: string): Promise<{
  readonly contextSnapshot?: ContextSnapshot;
  readonly contextSnapshotEvictedAt?: string;
}> {
  const result = await readJson<ContextSnapshot>(`/api/ide/context-snapshot/${inspectorId}`, {
    validate: isContextSnapshot,
    invalidMessage: 'Context Snapshot 响应格式错误',
  });
  if (result.status === 'ready') {
    return { contextSnapshot: result.data };
  }
  return { contextSnapshotEvictedAt: 'unknown' };
}

function isStoryMemoryItem(value: unknown): value is StoryMemoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.memory_id === 'string' &&
    typeof item.entity_type === 'string' &&
    typeof item.entity_id === 'string' &&
    typeof item.fact_type === 'string' &&
    typeof item.value === 'string' &&
    typeof item.source_ref === 'string' &&
    (typeof item.source_chapter_id === 'number' || item.source_chapter_id === null) &&
    typeof item.valid_from_chapter === 'number' &&
    (typeof item.valid_to_chapter === 'number' || item.valid_to_chapter === null) &&
    typeof item.confidence === 'number' &&
    typeof item.immutable === 'boolean' &&
    typeof item.revision === 'number' &&
    Array.isArray(item.conflict_ids) &&
    item.conflict_ids.every((conflictId) => typeof conflictId === 'string')
  );
}

function isStoryMemoryConflict(value: unknown): value is StoryMemoryConflict {
  if (!value || typeof value !== 'object') return false;
  const conflict = value as Record<string, unknown>;
  return (
    typeof conflict.conflict_id === 'string' &&
    typeof conflict.entity_id === 'string' &&
    typeof conflict.fact_type === 'string' &&
    typeof conflict.left_memory_id === 'string' &&
    typeof conflict.right_memory_id === 'string' &&
    typeof conflict.severity === 'string' &&
    typeof conflict.reason === 'string' &&
    Array.isArray(conflict.source_refs) &&
    conflict.source_refs.every((sourceRef) => typeof sourceRef === 'string')
  );
}

function isStoryMemoryResult(value: unknown): value is StoryMemoryResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  const filters = result.filters as Record<string, unknown> | undefined;
  return (
    !!filters &&
    typeof filters.book_id === 'number' &&
    (typeof filters.entity_type === 'string' || filters.entity_type === null) &&
    (typeof filters.entity_id === 'string' || filters.entity_id === null) &&
    (typeof filters.fact_type === 'string' || filters.fact_type === null) &&
    (typeof filters.chapter === 'number' || filters.chapter === null) &&
    typeof filters.conflict_status === 'string' &&
    Array.isArray(result.items) &&
    result.items.every(isStoryMemoryItem) &&
    Array.isArray(result.conflict_queue) &&
    result.conflict_queue.every(isStoryMemoryConflict) &&
    typeof result.total === 'number' &&
    typeof result.conflicted_count === 'number'
  );
}

async function readStoryMemoryResult(bookId: number): Promise<{
  readonly storyMemoryResult?: StoryMemoryResult;
}> {
  const result = await readJson<StoryMemoryResult>('/api/ide/story-memory/query', {
    validate: isStoryMemoryResult,
    invalidMessage: 'Story Memory 响应格式错误',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ book_id: bookId }),
    },
  });
  if (result.status === 'ready') {
    return { storyMemoryResult: result.data };
  }
  return {};
}

function isBookRunPanelRun(value: unknown): value is BookRunPanelRun {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'number' &&
    typeof value.status === 'string' &&
    typeof value.current_chapter_index === 'number' &&
    typeof value.total_chapters === 'number' &&
    (typeof value.token_budget === 'number' || value.token_budget === null) &&
    typeof value.tokens_used === 'number' &&
    typeof value.elapsed_time_sec === 'number' &&
    (typeof value.time_budget_sec === 'number' || value.time_budget_sec === null) &&
    typeof value.estimated_cost === 'number' &&
    Array.isArray(value.checkpoint) &&
    isRecord(value.progress)
  );
}

function parseSseSnapshot(text: string): readonly BookRunEventSnapshot[] {
  return text
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event: '));
      const dataLine = lines.find((line) => line.startsWith('data: '));
      if (!eventLine || !dataLine) return null;
      try {
        const data = JSON.parse(dataLine.slice('data: '.length)) as unknown;
        return isRecord(data) ? { event: eventLine.slice('event: '.length), data } : null;
      } catch {
        return null;
      }
    })
    .filter((item): item is BookRunEventSnapshot => item !== null);
}

async function readSseSnapshot(path: string): Promise<readonly BookRunEventSnapshot[]> {
  try {
    const response = await apiFetch(path);
    if (!response.ok) return [];
    return parseSseSnapshot(await response.text());
  } catch {
    return [];
  }
}

async function readBookRunPanelState(bookRunId: number): Promise<{
  readonly bookRun?: BookRunPanelRun;
  readonly bookRunEvents?: readonly BookRunEventSnapshot[];
}> {
  const [bookRunResult, bookRunEvents] = await Promise.all([
    readJson<BookRunPanelRun>(`/api/book-runs/${bookRunId}`, {
      validate: isBookRunPanelRun,
      invalidMessage: 'BookRun 响应格式错误',
    }),
    readSseSnapshot(`/api/ide/runs/${bookRunId}/events`),
  ]);
  if (bookRunResult.status !== 'ready') {
    return { bookRunEvents };
  }
  const progress = isRecord(bookRunResult.data.progress) ? bookRunResult.data.progress : {};
  return {
    bookRun: {
      ...bookRunResult.data,
      blocked_chapter: isRecord(progress.blocked_chapter) ? progress.blocked_chapter : null,
      provider_fallback: isRecord(progress.provider_fallback) ? progress.provider_fallback : null,
    },
    bookRunEvents,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isArtifactTraceLink(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (typeof value.id === 'number' || value.id === null || value.id === undefined) &&
    (typeof value.href === 'string' || value.href === null || value.href === undefined) &&
    (typeof value.context_href === 'string' ||
      value.context_href === null ||
      value.context_href === undefined) &&
    typeof value.label === 'string'
  );
}

function isArtifactViewerPreview(value: unknown): value is ArtifactViewerPreview {
  if (!isRecord(value)) return false;
  const artifact = value.artifact;
  const preview = value.preview;
  const download = value.download;
  const trace = value.trace;
  return (
    isRecord(artifact) &&
    typeof artifact.id === 'number' &&
    typeof artifact.artifact_type === 'string' &&
    typeof artifact.lineage_key === 'string' &&
    typeof artifact.name === 'string' &&
    typeof artifact.status === 'string' &&
    typeof artifact.storage_uri === 'string' &&
    typeof artifact.mime_type === 'string' &&
    typeof artifact.size_bytes === 'number' &&
    typeof artifact.version === 'number' &&
    isRecord(preview) &&
    typeof preview.format === 'string' &&
    typeof preview.content_preview === 'string' &&
    isRecord(preview.summary) &&
    isRecord(download) &&
    typeof download.download_mode === 'string' &&
    typeof download.mime_type === 'string' &&
    typeof download.storage_uri === 'string' &&
    typeof download.content_preview === 'string' &&
    isRecord(download.payload_summary) &&
    Array.isArray(value.versions) &&
    value.versions.every(isArtifactVersion) &&
    isRecord(trace) &&
    isArtifactTraceLink(trace.book_run) &&
    isArtifactTraceLink(trace.model_run) &&
    isArtifactTraceLink(trace.judge_report) &&
    isArtifactTraceLink(trace.approve)
  );
}

function isArtifactVersion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'number' &&
    typeof value.version === 'number' &&
    typeof value.name === 'string' &&
    typeof value.status === 'string' &&
    typeof value.created_at === 'string'
  );
}

async function readArtifactPreview(
  artifactId: number,
  workspaceId: number,
): Promise<{
  readonly artifactPreview?: ArtifactViewerPreview;
}> {
  const result = await readJson<ArtifactViewerPreview>(`/api/ide/artifacts/${artifactId}/preview`, {
    params: { workspace_id: workspaceId },
    validate: isArtifactViewerPreview,
    invalidMessage: 'Artifact Preview 响应格式错误',
  });
  if (result.status === 'ready') {
    return { artifactPreview: result.data };
  }
  return {};
}
