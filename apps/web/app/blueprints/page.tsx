import { BlueprintWorkbench, readBlueprint, readBookRun } from './api';

function readPositiveInt(value: string | string[] | undefined): number | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function BlueprintsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const blueprintId = readPositiveInt(params.blueprint_id);
  const bookRunId = readPositiveInt(params.book_run_id);
  const [blueprint, bookRun] = await Promise.all([
    blueprintId ? readBlueprint(blueprintId) : Promise.resolve(null),
    bookRunId ? readBookRun(bookRunId) : Promise.resolve(null),
  ]);

  return (
    <main aria-labelledby="blueprints-title">
      <h1 id="blueprints-title">Blueprint 全书编排</h1>
      <p>创建、锁定并触发三章章节计划后，启动 BookRun 查看整书生成状态。</p>
      <BlueprintWorkbench blueprint={blueprint} bookRun={bookRun} />
      <section aria-labelledby="blueprints-actions-title">
        <h2 id="blueprints-actions-title">最小操作链</h2>
        <ol>
          <li>创建 Blueprint。</li>
          <li>锁定 Blueprint。</li>
          <li>触发章节计划写回。</li>
          <li>启动 BookRun。</li>
          <li>查看 BookRun 状态和导出证据。</li>
        </ol>
      </section>
    </main>
  );
}
