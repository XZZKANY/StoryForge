import { artifactsEndpoint, readArtifactWorkbenchData } from './api';
import type { ArtifactWorkbenchData, ArtifactWorkbenchItem } from './types';

function formatOptionalId(prefix: string, id: number | null | undefined): string {
  return typeof id === 'number' ? `${prefix} #${id}` : '未关联';
}

function readArtifactJobId(artifact: ArtifactWorkbenchItem): number | null {
  const value = artifact.payload.job_id ?? artifact.payload.job_run_id ?? artifact.payload.jobId;
  return typeof value === 'number' ? value : null;
}

export function ArtifactsWorkbench({ data }: { readonly data: ArtifactWorkbenchData }) {
  const { artifactListState, artifactDetailState, artifactDownloadState } = data;

  return (
    <>
      <section aria-labelledby="artifacts-live-data-title">
        <h2 id="artifacts-live-data-title">产物列表</h2>
        <p>
          服务端实时读取 {artifactsEndpoint}，展示 artifact ID、类型、文件名或标题、版本、状态和关联
          book/job 信息。
        </p>
        {artifactListState.status === 'error' ? (
          <p role="status">可重试错误摘要：{artifactListState.message}。请刷新页面或稍后重试。</p>
        ) : artifactListState.artifacts.length === 0 ? (
          <p>空列表：当前没有可展示的制品记录。</p>
        ) : (
          <div>
            <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr_1fr] gap-4 border-y border-border py-2 text-xs font-semibold uppercase text-muted">
              <span>名称</span>
              <span>类型</span>
              <span>版本</span>
              <span>关联项目</span>
            </div>
            {artifactListState.artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="grid grid-cols-[1.2fr_0.8fr_0.7fr_1fr] gap-4 border-b border-border py-3 text-sm"
              >
                <strong>Artifact #{artifact.id}</strong>
                <span>{artifact.artifact_type}</span>
                <span>v{artifact.version}</span>
                <span>关联作品：{formatOptionalId('Book', artifact.book_id)}</span>
                <span className="col-span-4 text-muted">
                  {artifact.name} · 状态：{artifact.status} · 关联任务：
                  {formatOptionalId('Job', readArtifactJobId(artifact))}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="artifacts-detail-title">
        <h2 id="artifacts-detail-title">制品详情与下载摘要</h2>
        <p>
          服务端读取 {artifactsEndpoint}/{'{artifact_id}'} 与 {artifactsEndpoint}/{'{artifact_id}'}
          /download，展示首个制品的详情和 payload 预览。
        </p>
        {artifactDetailState.status === 'idle' ? (
          <p>{artifactDetailState.message}</p>
        ) : artifactDetailState.status === 'error' ? (
          <p role="status">可重试错误摘要：{artifactDetailState.message}</p>
        ) : (
          <dl>
            <dt>详情制品</dt>
            <dd>
              Artifact #{artifactDetailState.artifact.id}：{artifactDetailState.artifact.name}
            </dd>
            <dt>谱系版本</dt>
            <dd>v{artifactDetailState.artifact.version}</dd>
            <dt>关联任务</dt>
            <dd>{formatOptionalId('Job', readArtifactJobId(artifactDetailState.artifact))}</dd>
          </dl>
        )}
        {artifactDownloadState.status === 'idle' ? (
          <p>{artifactDownloadState.message}</p>
        ) : artifactDownloadState.status === 'error' ? (
          <p role="status">可重试错误摘要：{artifactDownloadState.message}</p>
        ) : (
          <dl>
            <dt>下载模式</dt>
            <dd>{artifactDownloadState.download.download_mode}</dd>
            <dt>MIME 类型</dt>
            <dd>{artifactDownloadState.download.mime_type}</dd>
            <dt>内容预览</dt>
            <dd>{artifactDownloadState.download.content_preview}</dd>
          </dl>
        )}
      </section>
    </>
  );
}

export async function ArtifactsPageContent({
  variant = 'page',
}: {
  readonly variant?: 'page' | 'home';
}) {
  const data = await readArtifactWorkbenchData();
  const content = (
    <>
      <h1 id="artifacts-title">Artifacts 制品治理</h1>
      <p>核对导出物、制品详情和 payload 下载摘要，保持对象制品可追溯。</p>
      <ArtifactsWorkbench data={data} />
    </>
  );

  return variant === 'home' ? (
    <section aria-labelledby="artifacts-title">{content}</section>
  ) : (
    <main aria-labelledby="artifacts-title">{content}</main>
  );
}
