import { BlueprintWorkspacePanel } from './BlueprintWorkspacePanel';

export default async function BlueprintsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};

  return (
    <main aria-labelledby="blueprints-title">
      <h1 id="blueprints-title">Blueprint 全书编排</h1>
      <p>创建、锁定并触发三章章节计划后，启动 BookRun 查看整书生成状态。</p>
      <BlueprintWorkspacePanel searchParams={params} />
    </main>
  );
}
