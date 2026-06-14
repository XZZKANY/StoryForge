import { BlueprintWorkspacePanel } from './BlueprintWorkspacePanel';

export default async function BlueprintsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const blueprintId = params.blueprint_id ? Number(params.blueprint_id) : undefined;
  const bookRunId = params.book_run_id ? Number(params.book_run_id) : undefined;
  const intent = typeof params.intent === 'string' ? params.intent : undefined;

  return (
    <BlueprintWorkspacePanel
      blueprintId={blueprintId}
      bookRunId={bookRunId}
      intent={intent}
    />
  );
}
