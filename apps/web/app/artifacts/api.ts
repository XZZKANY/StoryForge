import { readJson } from '../../lib/api-client';

import type {
  ArtifactDetailState,
  ArtifactDownloadState,
  ArtifactListState,
  ArtifactWorkbenchData,
  ArtifactWorkbenchItem,
} from './types';
import {
  isArtifactDownloadSummary,
  isArtifactWorkbenchItem,
  isArtifactWorkbenchItemList,
} from './validators';

export const artifactsEndpoint = '/api/artifacts';

export async function readArtifacts(): Promise<ArtifactListState> {
  const result = await readJson<ArtifactWorkbenchItem[]>(artifactsEndpoint, {
    validate: isArtifactWorkbenchItemList,
    invalidMessage: '制品列表 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', artifacts: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '制品列表 API 返回') };
}

export async function readArtifactDetail(
  artifact: ArtifactWorkbenchItem | undefined,
): Promise<ArtifactDetailState> {
  if (artifact === undefined) {
    return { status: 'idle', message: '读取制品详情需要先获得制品列表。' };
  }
  if (artifact.workspace_id === null) {
    return { status: 'error', message: '制品详情需要有效工作区作用域。' };
  }
  const result = await readJson(`${artifactsEndpoint}/${artifact.id}`, {
    params: { workspace_id: artifact.workspace_id },
    validate: isArtifactWorkbenchItem,
    invalidMessage: '制品详情 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', artifact: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '制品详情 API 返回') };
}

export async function readArtifactDownload(
  artifact: ArtifactWorkbenchItem | undefined,
): Promise<ArtifactDownloadState> {
  if (artifact === undefined) {
    return { status: 'idle', message: '读取制品下载摘要需要先获得制品列表。' };
  }
  if (artifact.workspace_id === null) {
    return { status: 'error', message: '制品下载摘要需要有效工作区作用域。' };
  }
  const result = await readJson(`${artifactsEndpoint}/${artifact.id}/download`, {
    params: { workspace_id: artifact.workspace_id },
    validate: isArtifactDownloadSummary,
    invalidMessage: '制品下载摘要 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', download: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '制品下载摘要 API 返回') };
}

export async function readArtifactWorkbenchData(): Promise<ArtifactWorkbenchData> {
  const artifactListState = await readArtifacts();
  const firstArtifact =
    artifactListState.status === 'ready' ? artifactListState.artifacts[0] : undefined;
  const [artifactDetailState, artifactDownloadState] = await Promise.all([
    readArtifactDetail(firstArtifact),
    readArtifactDownload(firstArtifact),
  ]);
  return { artifactListState, artifactDetailState, artifactDownloadState };
}
