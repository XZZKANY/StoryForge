export type ArtifactWorkbenchItem = {
  readonly id: number;
  readonly workspace_id: number | null;
  readonly book_id: number | null;
  readonly artifact_type: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
  readonly payload: Record<string, unknown>;
};

export type ArtifactListState =
  | { readonly status: 'ready'; readonly artifacts: readonly ArtifactWorkbenchItem[] }
  | { readonly status: 'error'; readonly message: string };

export type ArtifactDetailState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly artifact: ArtifactWorkbenchItem }
  | { readonly status: 'error'; readonly message: string };

export type ArtifactDownloadSummary = {
  readonly id: number;
  readonly artifact_type: string;
  readonly name: string;
  readonly mime_type: string;
  readonly storage_uri: string;
  readonly download_mode: string;
  readonly content_preview: string;
  readonly payload_summary: Record<string, unknown>;
};

export type ArtifactDownloadState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly download: ArtifactDownloadSummary }
  | { readonly status: 'error'; readonly message: string };

export type ArtifactWorkbenchData = {
  readonly artifactListState: ArtifactListState;
  readonly artifactDetailState: ArtifactDetailState;
  readonly artifactDownloadState: ArtifactDownloadState;
};
