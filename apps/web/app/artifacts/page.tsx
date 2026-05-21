import { readJson } from "../../lib/api-client";

type ArtifactWorkbenchItem = {
  readonly id: number;
  readonly workspace_id: number | null;
  readonly book_id: number | null;
  readonly artifact_type: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
  readonly payload: Record<string, unknown>;
};

type ArtifactListState =
  | { readonly status: "ready"; readonly artifacts: readonly ArtifactWorkbenchItem[] }
  | { readonly status: "error"; readonly message: string };

type ArtifactDetailState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly artifact: ArtifactWorkbenchItem }
  | { readonly status: "error"; readonly message: string };

type ArtifactDownloadSummary = {
  readonly id: number;
  readonly artifact_type: string;
  readonly name: string;
  readonly mime_type: string;
  readonly storage_uri: string;
  readonly download_mode: string;
  readonly content_preview: string;
  readonly payload_summary: Record<string, unknown>;
};

type ArtifactDownloadState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly download: ArtifactDownloadSummary }
  | { readonly status: "error"; readonly message: string };

const artifactSections = [
  "导出物",
  "导出下载",
  "上传资料",
  "资料入库状态",
  "工作流快照",
  "快照追溯",
  "评测报告",
  "报告追溯",
];

const artifactsEndpoint = "/api/artifacts";

async function readArtifacts(): Promise<ArtifactListState> {
  const result = await readJson<ArtifactWorkbenchItem[]>(artifactsEndpoint, {
    validate: isArtifactWorkbenchItemList,
    invalidMessage: "制品列表 API 返回格式不符合预期",
  });
  return result.status === "ready"
    ? { status: "ready", artifacts: result.data }
    : { status: "error", message: result.message.replace("API 返回", "制品列表 API 返回") };
}

async function readArtifactDetail(artifactId: number | undefined): Promise<ArtifactDetailState> {
  if (artifactId === undefined) {
    return { status: "idle", message: "读取制品详情需要先获得制品列表。" };
  }
  const result = await readJson(`${artifactsEndpoint}/${artifactId}`, {
    validate: isArtifactWorkbenchItem,
    invalidMessage: "制品详情 API 返回格式不符合预期",
  });
  return result.status === "ready"
    ? { status: "ready", artifact: result.data }
    : { status: "error", message: result.message.replace("API 返回", "制品详情 API 返回") };
}

async function readArtifactDownload(artifactId: number | undefined): Promise<ArtifactDownloadState> {
  if (artifactId === undefined) {
    return { status: "idle", message: "读取制品下载摘要需要先获得制品列表。" };
  }
  const result = await readJson(`${artifactsEndpoint}/${artifactId}/download`, {
    validate: isArtifactDownloadSummary,
    invalidMessage: "制品下载摘要 API 返回格式不符合预期",
  });
  return result.status === "ready"
    ? { status: "ready", download: result.data }
    : { status: "error", message: result.message.replace("API 返回", "制品下载摘要 API 返回") };
}

function isArtifactWorkbenchItem(value: unknown): value is ArtifactWorkbenchItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ArtifactWorkbenchItem>;
  return (
    typeof candidate.id === "number" &&
    (typeof candidate.workspace_id === "number" || candidate.workspace_id === null) &&
    (typeof candidate.book_id === "number" || candidate.book_id === null) &&
    typeof candidate.artifact_type === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.version === "number" &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}

function isArtifactWorkbenchItemList(value: unknown): value is ArtifactWorkbenchItem[] {
  return Array.isArray(value) && value.every(isArtifactWorkbenchItem);
}

function isArtifactDownloadSummary(value: unknown): value is ArtifactDownloadSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ArtifactDownloadSummary>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.artifact_type === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.mime_type === "string" &&
    typeof candidate.storage_uri === "string" &&
    typeof candidate.download_mode === "string" &&
    typeof candidate.content_preview === "string" &&
    typeof candidate.payload_summary === "object" &&
    candidate.payload_summary !== null
  );
}

function formatOptionalId(prefix: string, id: number | null | undefined): string {
  return typeof id === "number" ? `${prefix} #${id}` : "未关联";
}

function readArtifactJobId(artifact: ArtifactWorkbenchItem): number | null {
  const value = artifact.payload.job_id ?? artifact.payload.job_run_id ?? artifact.payload.jobId;
  return typeof value === "number" ? value : null;
}

export default async function ArtifactsPage() {
  const artifactListState = await readArtifacts();
  const firstArtifactId = artifactListState.status === "ready" ? artifactListState.artifacts[0]?.id : undefined;
  const [artifactDetailState, artifactDownloadState] = await Promise.all([
    readArtifactDetail(firstArtifactId),
    readArtifactDownload(firstArtifactId),
  ]);

  return (
    <main aria-labelledby="artifacts-title">
      <h1 id="artifacts-title">Artifacts 制品治理</h1>
      <p>核对导出物、制品详情和 payload 下载摘要，保持对象制品可追溯。</p>
      <section aria-labelledby="artifacts-current-scope-title">
        <h2 id="artifacts-current-scope-title">当前对象 / 当前证据 / 当前动作</h2>
        <dl>
          <dt>当前对象</dt>
          <dd>Artifact 列表中的首个制品及其关联作品或任务。</dd>
          <dt>当前证据</dt>
          <dd>制品详情、版本、状态、payload 下载摘要和内容预览。</dd>
          <dt>当前动作</dt>
          <dd>下载摘要核对、追溯关联 Job 或 Book。</dd>
          <dt>当前边界</dt>
          <dd>本页只展示已验证的最小闭环。未联通能力不会伪装为可用操作。</dd>
        </dl>
      </section>
      <section aria-labelledby="artifact-sections">
        <h2 id="artifact-sections">制品分类</h2>
        <ul>
          {artifactSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="artifacts-live-data-title">
        <h2 id="artifacts-live-data-title">制品真实读取</h2>
        <p>服务端实时读取 {artifactsEndpoint}，展示 artifact ID、类型、文件名或标题、版本、状态和关联 book/job 信息。</p>
        {artifactListState.status === "error" ? (
          <p role="status">可重试错误摘要：{artifactListState.message}。请刷新页面或稍后重试。</p>
        ) : artifactListState.artifacts.length === 0 ? (
          <p>空列表：当前没有可展示的制品记录。</p>
        ) : (
          <ul>
            {artifactListState.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <strong>Artifact #{artifact.id}</strong>
                <span>类型：{artifact.artifact_type}</span>
                <span>文件名/标题：{artifact.name}</span>
                <span>版本：v{artifact.version}</span>
                <span>状态：{artifact.status}</span>
                <span>关联作品：{formatOptionalId("Book", artifact.book_id)}</span>
                <span>关联任务：{formatOptionalId("Job", readArtifactJobId(artifact))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="artifacts-unimplemented-title">
        <h2 id="artifacts-unimplemented-title">未实现边界</h2>
        <p>对象存储签名 URL、指标趋势图和报告详情页仍未实现；当前页面已读取制品详情和 payload 下载摘要。</p>
      </section>
      <section aria-labelledby="artifacts-detail-title">
        <h2 id="artifacts-detail-title">制品详情与下载摘要</h2>
        <p>服务端读取 {artifactsEndpoint}/{"{artifact_id}"} 与 {artifactsEndpoint}/{"{artifact_id}"}/download，展示首个制品的详情和 payload 预览。</p>
        {artifactDetailState.status === "idle" ? (
          <p>{artifactDetailState.message}</p>
        ) : artifactDetailState.status === "error" ? (
          <p role="status">可重试错误摘要：{artifactDetailState.message}</p>
        ) : (
          <dl>
            <dt>详情制品</dt>
            <dd>Artifact #{artifactDetailState.artifact.id}：{artifactDetailState.artifact.name}</dd>
            <dt>谱系版本</dt>
            <dd>v{artifactDetailState.artifact.version}</dd>
            <dt>关联任务</dt>
            <dd>{formatOptionalId("Job", readArtifactJobId(artifactDetailState.artifact))}</dd>
          </dl>
        )}
        {artifactDownloadState.status === "idle" ? (
          <p>{artifactDownloadState.message}</p>
        ) : artifactDownloadState.status === "error" ? (
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
    </main>
  );
}
