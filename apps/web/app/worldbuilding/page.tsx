import { readJson } from '../../lib/api-client';

export const dynamic = 'force-dynamic';

type WorldbuildingItem = {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
};

type WorldbuildingMemory = {
  readonly id: number;
  readonly subject: string;
  readonly type: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
};

type WorldbuildingSeries = {
  readonly id: number;
  readonly title: string;
  readonly status: string;
  readonly description: string | null;
};

type WorldbuildingCenterData = {
  readonly series: WorldbuildingSeries;
  readonly characters: readonly WorldbuildingItem[];
  readonly locations: readonly WorldbuildingItem[];
  readonly organizations: readonly WorldbuildingItem[];
  readonly world_rules: readonly WorldbuildingMemory[];
  readonly unresolved_foreshadowing: readonly WorldbuildingItem[];
  readonly cross_book_constraints: readonly WorldbuildingMemory[];
  readonly chapter_constraints: readonly string[];
};

type WorldbuildingState =
  | { readonly status: 'missing_param'; readonly message: string }
  | { readonly status: 'ready'; readonly data: WorldbuildingCenterData }
  | { readonly status: 'error'; readonly message: string };

function isWorldbuildingCenterData(value: unknown): value is WorldbuildingCenterData {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<WorldbuildingCenterData>;
  return (
    typeof c.series === 'object' &&
    c.series !== null &&
    Array.isArray(c.characters) &&
    Array.isArray(c.locations) &&
    Array.isArray(c.organizations) &&
    Array.isArray(c.world_rules) &&
    Array.isArray(c.unresolved_foreshadowing) &&
    Array.isArray(c.cross_book_constraints) &&
    Array.isArray(c.chapter_constraints)
  );
}

async function readWorldbuildingCenter(
  seriesId: number,
  bookId: number | undefined,
): Promise<WorldbuildingState> {
  const result = await readJson<WorldbuildingCenterData>('/api/worldbuilding/center', {
    params: { series_id: seriesId, book_id: bookId },
    validate: isWorldbuildingCenterData,
    invalidMessage: '世界观中心 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', data: result.data }
    : { status: 'error', message: result.message };
}

type PageProps = {
  searchParams: Promise<{ series_id?: string; book_id?: string }>;
};

export default async function WorldbuildingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const seriesId = params.series_id ? Number(params.series_id) : undefined;
  const bookId = params.book_id ? Number(params.book_id) : undefined;

  const state: WorldbuildingState =
    seriesId === undefined || Number.isNaN(seriesId)
      ? { status: 'missing_param', message: '请提供 series_id 查询参数以加载世界观中心。' }
      : await readWorldbuildingCenter(seriesId, bookId);

  return (
    <main aria-labelledby="worldbuilding-title">
      <h1 id="worldbuilding-title">世界观中心</h1>
      <p>聚合系列记忆、作品资产和连续性约束，提供只读世界观全景。</p>

      {state.status === 'missing_param' ? (
        <p role="status">{state.message}</p>
      ) : state.status === 'error' ? (
        <p role="status">可重试错误摘要：{state.message}。请刷新页面或稍后重试。</p>
      ) : (
        <>
          <section aria-labelledby="wb-series-title">
            <h2 id="wb-series-title">系列信息</h2>
            <dl>
              <dt>系列</dt>
              <dd>
                {state.data.series.title}（#{state.data.series.id}）
              </dd>
              <dt>状态</dt>
              <dd>{state.data.series.status}</dd>
              {state.data.series.description && (
                <>
                  <dt>描述</dt>
                  <dd>{state.data.series.description}</dd>
                </>
              )}
            </dl>
          </section>

          <section aria-labelledby="wb-characters-title">
            <h2 id="wb-characters-title">角色（{state.data.characters.length}）</h2>
            {state.data.characters.length === 0 ? (
              <p>当前范围内无角色资产。</p>
            ) : (
              <ul>
                {state.data.characters.map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span>（{JSON.stringify(item.payload)}）</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wb-locations-title">
            <h2 id="wb-locations-title">地点（{state.data.locations.length}）</h2>
            {state.data.locations.length === 0 ? (
              <p>当前范围内无地点资产。</p>
            ) : (
              <ul>
                {state.data.locations.map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span>（{JSON.stringify(item.payload)}）</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wb-organizations-title">
            <h2 id="wb-organizations-title">组织（{state.data.organizations.length}）</h2>
            {state.data.organizations.length === 0 ? (
              <p>当前范围内无组织资产。</p>
            ) : (
              <ul>
                {state.data.organizations.map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span>（{JSON.stringify(item.payload)}）</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wb-rules-title">
            <h2 id="wb-rules-title">世界规则（{state.data.world_rules.length}）</h2>
            {state.data.world_rules.length === 0 ? (
              <p>当前系列无世界规则记忆。</p>
            ) : (
              <ul>
                {state.data.world_rules.map((item) => (
                  <li key={item.id}>
                    <strong>{item.subject}</strong>
                    <span>（{JSON.stringify(item.payload)}）</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wb-foreshadowing-title">
            <h2 id="wb-foreshadowing-title">
              未回收伏笔（{state.data.unresolved_foreshadowing.length}）
            </h2>
            {state.data.unresolved_foreshadowing.length === 0 ? (
              <p>当前范围内无未回收伏笔。</p>
            ) : (
              <ul>
                {state.data.unresolved_foreshadowing.map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span>（{JSON.stringify(item.payload)}）</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wb-cross-book-title">
            <h2 id="wb-cross-book-title">跨书约束（{state.data.cross_book_constraints.length}）</h2>
            {state.data.cross_book_constraints.length === 0 ? (
              <p>当前系列无跨书约束。</p>
            ) : (
              <ul>
                {state.data.cross_book_constraints.map((item) => (
                  <li key={item.id}>
                    <strong>{item.subject}</strong>
                    <span>（{JSON.stringify(item.payload)}）</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wb-chapter-constraints-title">
            <h2 id="wb-chapter-constraints-title">
              章节继承约束（{state.data.chapter_constraints.length}）
            </h2>
            {state.data.chapter_constraints.length === 0 ? (
              <p>当前作品范围内无章节继承约束。</p>
            ) : (
              <ul>
                {state.data.chapter_constraints.map((constraint, index) => (
                  <li key={index}>{constraint}</li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wb-boundary-title">
            <h2 id="wb-boundary-title">未实现边界</h2>
            <p>世界观写入、冲突仲裁和时间线演化仍未实现；当前页面只展示只读聚合结果。</p>
          </section>
        </>
      )}
    </main>
  );
}
