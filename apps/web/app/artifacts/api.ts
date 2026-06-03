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
  artifactId: number | undefined,
): Promise<ArtifactDetailState> {
  if (artifactId === undefined) {
    return { status: 'idle', message: '读取制品详情需要先获得制品列表。' };
  }
  const result = await readJson(`${artifactsEndpoint}/${artifactId}`, {
    validate: isArtifactWorkbenchItem,
    invalidMessage: '制品详情 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', artifact: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '制品详情 API 返回') };
}

export async function readArtifactDownload(
  artifactId: number | undefined,
): Promise<ArtifactDownloadState> {
  if (artifactId === undefined) {
    return { status: 'idle', message: '读取制品下载摘要需要先获得制品列表。' };
  }
  const result = await readJson(`${artifactsEndpoint}/${artifactId}/download`, {
    validate: isArtifactDownloadSummary,
    invalidMessage: '制品下载摘要 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', download: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '制品下载摘要 API 返回') };
}

export async function readArtifactWorkbenchData(): Promise<ArtifactWorkbenchData> {
  const artifactListState = await readArtifacts();
  const firstArtifactId =
    artifactListState.status === 'ready' ? artifactListState.artifacts[0]?.id : undefined;
  const [artifactDetailState, artifactDownloadState] = await Promise.all([
    readArtifactDetail(firstArtifactId),
    readArtifactDownload(firstArtifactId),
  ]);
  return { artifactListState, artifactDetailState, artifactDownloadState };
}
