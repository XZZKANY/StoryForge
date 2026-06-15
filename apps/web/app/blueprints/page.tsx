import { BlueprintWorkspacePanel } from './BlueprintWorkspacePanel';

export default async function BlueprintsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};

  return <BlueprintWorkspacePanel searchParams={params} />;
}
