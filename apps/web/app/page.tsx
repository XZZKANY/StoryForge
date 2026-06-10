import { HomeShell } from '../components/home/HomeShell';
import { parseHomeView, type HomeSearchParams } from '../components/home/home-view';

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams?: Promise<HomeSearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const activeView = parseHomeView(resolvedSearchParams);

  return <HomeShell activeView={activeView} searchParams={resolvedSearchParams} />;
}
