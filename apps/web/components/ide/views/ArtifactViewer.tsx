export type ArtifactViewerTraceLink = {
  readonly id?: number | null;
  readonly href?: string | null;
  readonly label: string;
};

export type ArtifactViewerPreview = {
  readonly artifact: {
    readonly id: number;
    readonly artifact_type: string;
    readonly lineage_key: string;
    readonly name: string;
    readonly status: string;
    readonly storage_uri: string;
    readonly mime_type: string;
    readonly size_bytes: number;
    readonly version: number;
  };
  readonly preview: {
    readonly format: string;
    readonly content_preview: string;
    readonly summary: Record<string, unknown>;
  };
  readonly download: {
    readonly download_mode: string;
    readonly mime_type: string;
    readonly storage_uri: string;
    readonly content_preview: string;
    readonly payload_summary: Record<string, unknown>;
  };
  readonly versions: readonly {
    readonly id: number;
    readonly version: number;
    readonly name: string;
    readonly status: string;
    readonly created_at: string;
  }[];
  readonly trace: {
    readonly book_run: ArtifactViewerTraceLink;
    readonly model_run: ArtifactViewerTraceLink;
    readonly judge_report: ArtifactViewerTraceLink;
    readonly approve: ArtifactViewerTraceLink;
  };
};

export type ArtifactViewerProps = {
  readonly preview?: ArtifactViewerPreview;
};

export function ArtifactViewer({ preview }: ArtifactViewerProps) {
  if (!preview) {
    return (
      <section className="space-y-3 rounded-xl border border-stone-800 bg-stone-900 p-4 text-stone-100">
        <header>
          <p className="text-xs uppercase tracking-wide text-stone-400">Artifact Viewer</p>
          <h2 className="mt-1 text-lg font-semibold">制品预览</h2>
        </header>
        <p className="rounded-lg border border-dashed border-stone-700 p-4 text-sm text-stone-400">
          当前没有选中的制品
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-800 bg-stone-900 p-4 text-stone-100">
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-400">Artifact Viewer</p>
        <h2 className="mt-1 text-lg font-semibold">
          Artifact #{preview.artifact.id}：{preview.artifact.name}
        </h2>
        <p className="mt-2 text-sm text-stone-300">
          {preview.artifact.artifact_type} · {preview.artifact.mime_type} · v
          {preview.artifact.version}
        </p>
      </header>

      <section className="rounded-lg border border-stone-800 bg-stone-950 p-3">
        <h3 className="text-sm font-semibold">预览：{preview.preview.format}</h3>
        <pre className="mt-2 whitespace-pre-wrap rounded bg-stone-900 p-3 text-sm text-stone-200">
          {preview.preview.content_preview}
        </pre>
        <KeyValueList values={preview.preview.summary} />
      </section>

      <section className="rounded-lg border border-stone-800 bg-stone-950 p-3">
        <h3 className="text-sm font-semibold">下载摘要</h3>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <Pair label="download_mode" value={preview.download.download_mode} />
          <Pair label="mime_type" value={preview.download.mime_type} />
          <Pair label="storage_uri" value={preview.download.storage_uri} />
          <Pair label="content_preview" value={preview.download.content_preview} />
        </dl>
      </section>

      <section className="rounded-lg border border-stone-800 bg-stone-950 p-3">
        <h3 className="text-sm font-semibold">版本对比</h3>
        <ul className="mt-2 space-y-1 text-sm text-stone-300">
          {preview.versions.map((item) => (
            <li key={item.id}>
              v{item.version} · Artifact #{item.id} · {item.status} · {item.created_at}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-sky-900 bg-sky-950/30 p-3">
        <h3 className="text-sm font-semibold">BookRun → ModelRun → Approve</h3>
        <ol className="mt-2 space-y-1 text-sm text-sky-100">
          <TraceItem link={preview.trace.book_run} fallback="BookRun" />
          <TraceItem link={preview.trace.model_run} fallback="ModelRun" />
          <TraceItem link={preview.trace.judge_report} fallback="JudgeReport" />
          <TraceItem link={preview.trace.approve} fallback="Approve" />
        </ol>
      </section>
    </section>
  );
}

function TraceItem({
  link,
  fallback,
}: {
  readonly link: ArtifactViewerTraceLink;
  readonly fallback: string;
}) {
  const text = link.id ? `${link.label} #${link.id}` : `${fallback} 未记录`;
  return <li>{link.href ? <a href={link.href}>{text}</a> : text}</li>;
}

function KeyValueList({ values }: { readonly values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2 grid gap-2 text-xs text-stone-400 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <Pair key={key} label={key} value={formatValue(value)} />
      ))}
    </dl>
  );
}

function Pair({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="break-all text-stone-200">{value}</dd>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
}
