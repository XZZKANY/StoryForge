import type { ArtifactDownloadSummary, ArtifactWorkbenchItem } from './types';

export function isArtifactWorkbenchItem(value: unknown): value is ArtifactWorkbenchItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ArtifactWorkbenchItem>;
  return (
    typeof candidate.id === 'number' &&
    (typeof candidate.workspace_id === 'number' || candidate.workspace_id === null) &&
    (typeof candidate.book_id === 'number' || candidate.book_id === null) &&
    typeof candidate.artifact_type === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.version === 'number' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  );
}

export function isArtifactWorkbenchItemList(value: unknown): value is ArtifactWorkbenchItem[] {
  return Array.isArray(value) && value.every(isArtifactWorkbenchItem);
}

export function isArtifactDownloadSummary(value: unknown): value is ArtifactDownloadSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ArtifactDownloadSummary>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.artifact_type === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.mime_type === 'string' &&
    typeof candidate.storage_uri === 'string' &&
    typeof candidate.download_mode === 'string' &&
    typeof candidate.content_preview === 'string' &&
    typeof candidate.payload_summary === 'object' &&
    candidate.payload_summary !== null
  );
}
