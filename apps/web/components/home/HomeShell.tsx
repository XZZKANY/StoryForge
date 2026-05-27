import Link from 'next/link';

import { HomeComposer } from './HomeComposer';
import { HomeContextStrip } from './HomeContextStrip';
import { HomeQuickActions } from './HomeQuickActions';
import { HomeSidebar } from './HomeSidebar';
import { homeProviderUncheckedLabel, homeWorkspaceLabel } from './home-data';

export function HomeShell() {
  return (
    <div
      data-home-shell
      className="min-h-screen bg-stone-950 text-stone-100 md:grid md:grid-cols-[18rem_1fr]"
    >
      <HomeSidebar />
      <main aria-labelledby="home-composer-title" className="!m-0 !w-full !max-w-none !px-6 !py-10">
        <div className="flex justify-end">
          <Link
            href="/providers"
            className="inline-flex items-center gap-2 rounded-full border border-stone-800 bg-stone-900/60 px-3 py-1 text-xs text-stone-300 hover:border-amber-700 hover:text-amber-300"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>{homeWorkspaceLabel}</span>
            <span aria-hidden>·</span>
            <span>{homeProviderUncheckedLabel}</span>
          </Link>
        </div>
        <div className="mx-auto mt-12 w-full max-w-2xl">
          <HomeComposer />
          <HomeQuickActions />
          <HomeContextStrip />
        </div>
      </main>
    </div>
  );
}
