import {
  BlueprintWorkbench,
  createBlueprintWorkflowAction,
  readBlueprint,
  readBookRun,
} from './api';

type BlueprintWorkspaceSearchParams = Record<string, string | string[] | undefined>;

function readPositiveInt(value: string | string[] | undefined): number | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function BlueprintWorkspacePanel({
  searchParams,
}: {
  readonly searchParams?: BlueprintWorkspaceSearchParams;
}) {
  const blueprintId = readPositiveInt(searchParams?.blueprint_id);
  const bookRunId = readPositiveInt(searchParams?.book_run_id);
  const [blueprint, bookRun] = await Promise.all([
    blueprintId ? readBlueprint(blueprintId) : Promise.resolve(null),
    bookRunId ? readBookRun(bookRunId) : Promise.resolve(null),
  ]);
  const rawError = Array.isArray(searchParams?.blueprint_error)
    ? searchParams?.blueprint_error[0]
    : searchParams?.blueprint_error;
  const intent = Array.isArray(searchParams?.intent)
    ? searchParams?.intent[0]
    : searchParams?.intent;

  return (
    <>
      {rawError ? <p role="status">操作失败：{decodeURIComponent(rawError)}</p> : null}
      <section aria-labelledby="blueprint-workflow-actions-title">
        <h2 id="blueprint-workflow-actions-title">可执行操作</h2>
        <form action={createBlueprintWorkflowAction}>
          <input type="hidden" name="blueprint_action" value="create-blueprint" />
          <input type="hidden" name="book_id" value={blueprint?.book_id ?? 1} />
          {intent ? <input type="hidden" name="intent" value={intent} /> : null}
          <button type="submit">创建 Blueprint</button>
        </form>
        {blueprint ? (
          <>
            <form action={createBlueprintWorkflowAction}>
              <input type="hidden" name="blueprint_action" value="lock-blueprint" />
              <input type="hidden" name="blueprint_id" value={blueprint.id} />
              <input type="hidden" name="book_id" value={blueprint.book_id} />
              <button type="submit">锁定 Blueprint</button>
            </form>
            <form action={createBlueprintWorkflowAction}>
              <input type="hidden" name="blueprint_action" value="trigger-chapter-plan" />
              <input type="hidden" name="blueprint_id" value={blueprint.id} />
              <input type="hidden" name="book_id" value={blueprint.book_id} />
              <button type="submit">触发章节计划</button>
            </form>
            <form action={createBlueprintWorkflowAction}>
              <input type="hidden" name="blueprint_action" value="start-book-run" />
              <input type="hidden" name="blueprint_id" value={blueprint.id} />
              <input type="hidden" name="book_id" value={blueprint.book_id} />
              <button type="submit">启动 BookRun</button>
            </form>
          </>
        ) : null}
      </section>
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
    </>
  );
}
