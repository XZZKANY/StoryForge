import { HomeShell } from '../components/home/HomeShell';
import { readRecentAssistantSessions } from '../components/home/assistant-session-store';
import { parseHomeView, type HomeSearchParams } from '../components/home/home-view';

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams?: Promise<HomeSearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const activeView = parseHomeView(resolvedSearchParams);
  const recentSessions = await readRecentAssistantSessions();
  const recentItems = recentSessions.status === 'ready' ? recentSessions.data : [];
  return (
    <HomeShell
      activeView={activeView}
      recentItems={recentItems}
      searchParams={resolvedSearchParams}
    />
  );
}
