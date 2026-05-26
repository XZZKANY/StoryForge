import { apiFetch } from '../../lib/api-client';

type RetrievalWorkbenchSource = {
  readonly id: number;
  readonly book_id: number | null;
  readonly series_id: number | null;
  readonly source_type: string;
  readonly title: string;
  readonly status: string;
  readonly chunk_count: number;
  readonly refresh_status: string;
  readonly evidence_anchor: string;
};

type RetrievalSourceListState =
  | { readonly status: 'ready'; readonly sources: readonly RetrievalWorkbenchSource[] }
  | { readonly status: 'error'; readonly message: string };

type RetrievalWorkbenchRefreshRun = {
  readonly id: number;
  readonly source_id: number | null;
  readonly book_id: number | null;
  readonly series_id: number | null;
  readonly status: string;
  readonly chunk_count: number;
  readonly embedding_provider: string | null;
  readonly embedding_model: string | null;
  readonly credential_status: string | null;
  readonly source_ids: readonly number[];
};

type RetrievalRefreshRunListState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly refreshRuns: readonly RetrievalWorkbenchRefreshRun[] }
  | { readonly status: 'error'; readonly message: string };

type RetrievalWorkbenchHit = {
  readonly source_id: number;
  readonly chunk_id: number;
  readonly source_ref: string;
  readonly book_id: number | null;
  readonly series_id: number | null;
  readonly title: string;
  readonly excerpt: string;
  readonly score: number;
  readonly rank: number;
  readonly score_source: string;
  readonly evidence_href: string;
};

type RetrievalWorkbenchSearchResult = {
  readonly query: string;
  readonly hits: readonly RetrievalWorkbenchHit[];
};

type RetrievalSearchState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly result: RetrievalWorkbenchSearchResult }
  | { readonly status: 'error'; readonly message: string };

const retrievalSections = [
  '资料库',
  '资料来源类型',
  'Embedding 刷新任务',
  '搜索请求',
  '命中预览',
  '证据跳转',
  '检索命中与重排',
  'Scene Packet 检索证据',
];

const retrievalWorkbenchSourcesEndpoint = '/api/retrieval/workbench/sources';
const retrievalWorkbenchRefreshRunsEndpoint = '/api/retrieval/workbench/refresh-runs';
const retrievalWorkbenchSearchEndpoint = '/api/retrieval/workbench/search';

async function readRetrievalWorkbenchSources(
  bookId: number | undefined,
): Promise<RetrievalSourceListState> {
  try {
    const response = await apiFetch(retrievalWorkbenchSourcesEndpoint, {
      params: bookId === undefined ? {} : { book_id: bookId },
    });
    if (!response.ok) {
      return { status: 'error', message: `资料源列表 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return { status: 'error', message: '资料源列表 API 返回格式不符合预期' };
    }

    return { status: 'ready', sources: payload as RetrievalWorkbenchSource[] };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return { status: 'error', message };
  }
}

async function readRetrievalWorkbenchRefreshRuns(
  sourceListState: RetrievalSourceListState,
): Promise<RetrievalRefreshRunListState> {
  if (sourceListState.status !== 'ready' || sourceListState.sources.length === 0) {
    return { status: 'idle', message: '读取刷新任务需要先获得资料源列表。' };
  }

  try {
    const response = await apiFetch(retrievalWorkbenchRefreshRunsEndpoint, {
      params: { source_id: sourceListState.sources[0].id },
    });
    if (!response.ok) {
      return { status: 'error', message: `刷新任务 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return { status: 'error', message: '刷新任务 API 返回格式不符合预期' };
    }

    return { status: 'ready', refreshRuns: payload as RetrievalWorkbenchRefreshRun[] };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return { status: 'error', message };
  }
}

async function readRetrievalWorkbenchSearch(
  sourceListState: RetrievalSourceListState,
): Promise<RetrievalSearchState> {
  if (sourceListState.status !== 'ready' || sourceListState.sources.length === 0) {
    return { status: 'idle', message: '发送搜索请求需要先获得资料源列表。' };
  }

  const firstSource = sourceListState.sources[0];
  const requestBody =
    firstSource.book_id !== null
      ? { book_id: firstSource.book_id, query: firstSource.title, limit: 3 }
      : { series_id: firstSource.series_id, query: firstSource.title, limit: 3 };

  try {
    const response = await apiFetch(retrievalWorkbenchSearchEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      return { status: 'error', message: `搜索请求 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!isRetrievalWorkbenchSearchResult(payload)) {
      return { status: 'error', message: '搜索请求 API 返回格式不符合预期' };
    }

    return { status: 'ready', result: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return { status: 'error', message };
  }
}

function isRetrievalWorkbenchSearchResult(value: unknown): value is RetrievalWorkbenchSearchResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<RetrievalWorkbenchSearchResult>;
  return typeof candidate.query === 'string' && Array.isArray(candidate.hits);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function RetrievalPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly book_id?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const bookId = parsePositiveInt(resolvedSearchParams?.book_id);
  const sourceListState = await readRetrievalWorkbenchSources(bookId);
  const refreshRunListState = await readRetrievalWorkbenchRefreshRuns(sourceListState);
  const searchState = await readRetrievalWorkbenchSearch(sourceListState);

  return (
    <main aria-labelledby="retrieval-title">
      <h1 id="retrieval-title">Retrieval 证据链路</h1>
      <p>核对资料来源类型、搜索请求、命中预览、证据锚点和 Scene Packet 的检索证据来源。</p>
      <p>
        当前读取范围：
        {bookId === undefined ? '未指定 book_id，读取 API 默认资料源列表。' : `book_id=${bookId}`}
      </p>
      <section aria-labelledby="retrieval-current-scope-title">
        <h2 id="retrieval-current-scope-title">当前对象 / 当前证据 / 当前动作</h2>
        <dl>
          <dt>当前对象</dt>
          <dd>资料源、刷新任务和搜索请求。</dd>
          <dt>当前证据</dt>
          <dd>Retrieval Hit、来源标题、片段摘要、score、rank 和 evidence anchor。</dd>
          <dt>当前动作</dt>
          <dd>核对命中、跳转锚点、回到 Studio 复核 Scene Packet 证据。</dd>
          <dt>当前边界</dt>
          <dd>本页只展示已验证的最小闭环。未联通能力不会伪装为可用操作。</dd>
        </dl>
      </section>
      <section aria-labelledby="retrieval-sections">
        <h2 id="retrieval-sections">检索能力</h2>
        <ul>
          {retrievalSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="retrieval-source-list-title">
        <h2 id="retrieval-source-list-title">读取资料源列表</h2>
        <p>
          当前 Retrieval 工作台只读取 {retrievalWorkbenchSourcesEndpoint} 这一个资料源列表端点。
        </p>
        {sourceListState.status === 'error' ? (
          <p role="status">可重试错误摘要：{sourceListState.message}</p>
        ) : sourceListState.sources.length === 0 ? (
          <p>空列表：当前作品暂无可检索资料源，请先上传资料或生成章节快照。</p>
        ) : (
          <ul>
            {sourceListState.sources.map((source) => (
              <li id={source.evidence_anchor} key={source.id}>
                <strong>{source.title}</strong>
                <span>来源类型：{source.source_type}</span>
                <span>切片数量：{source.chunk_count}</span>
                <span>刷新状态：{source.refresh_status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="retrieval-refresh-runs-title">
        <h2 id="retrieval-refresh-runs-title">读取刷新任务</h2>
        <p>当前 Retrieval 工作台只在资料源列表之后读取 {retrievalWorkbenchRefreshRunsEndpoint}。</p>
        {refreshRunListState.status === 'idle' ? (
          <p>{refreshRunListState.message}</p>
        ) : refreshRunListState.status === 'error' ? (
          <p role="status">可重试错误摘要：{refreshRunListState.message}</p>
        ) : refreshRunListState.refreshRuns.length === 0 ? (
          <p>空列表：当前资料源暂无刷新任务记录。</p>
        ) : (
          <ul>
            {refreshRunListState.refreshRuns.map((run) => (
              <li key={run.id}>
                <strong>刷新任务 #{run.id}</strong>
                <span>状态：{run.status}</span>
                <span>切片数量：{run.chunk_count}</span>
                <span>Embedding：{run.embedding_provider ?? '暂无 provider'}</span>
                <span>凭据状态：{run.credential_status ?? '暂无凭据状态'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="retrieval-search-title">
        <h2 id="retrieval-search-title">搜索请求与命中预览</h2>
        <p>
          当前 Retrieval 工作台只发送 {retrievalWorkbenchSearchEndpoint}{' '}
          这一类搜索请求，并在结果中展示命中预览和证据跳转。
        </p>
        {searchState.status === 'idle' ? (
          <p>{searchState.message}</p>
        ) : searchState.status === 'error' ? (
          <p role="status">可重试错误摘要：{searchState.message}</p>
        ) : searchState.result.hits.length === 0 ? (
          <p>空列表：搜索请求“{searchState.result.query}”暂无命中。</p>
        ) : (
          <ol>
            {searchState.result.hits.map((hit) => (
              <li id={`retrieval-evidence-${hit.source_id}-${hit.chunk_id}`} key={hit.source_ref}>
                <strong>{hit.title}</strong>
                <span>排名：{hit.rank}</span>
                <span>得分：{hit.score}</span>
                <p>{hit.excerpt}</p>
                <a href={hit.evidence_href}>证据跳转：{hit.source_ref}</a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
