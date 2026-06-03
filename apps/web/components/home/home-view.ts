export const homeViews = ['assistant', 'projects', 'artifacts'] as const;

export type HomeView = (typeof homeViews)[number];

export type HomeSearchParams = Record<string, string | string[] | undefined>;

export function parseHomeView(searchParams: HomeSearchParams | undefined): HomeView {
  const rawView = searchParams?.view;
  const view = Array.isArray(rawView) ? rawView[0] : rawView;
  if (view === 'new-project') return 'projects';
  return homeViews.includes(view as HomeView) ? (view as HomeView) : 'assistant';
}

export function createHomeViewHref(view: HomeView): string {
  return view === 'assistant' ? '/' : `/?view=${view}`;
}
