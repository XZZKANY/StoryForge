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
      className="min-h-screen overflow-hidden bg-[#1f1f1d] text-[#e8decb] [--legacy-home-bg:bg-stone-950] md:grid md:grid-cols-[290px_1fr]"
    >
      <HomeSidebar />
      <main
        aria-labelledby="home-composer-title"
        className="relative !m-0 flex min-h-screen !w-full !max-w-none flex-col !px-0 !py-0"
      >
        <div className="absolute left-4 top-4 text-[#e5ded1] md:hidden" aria-hidden>
          ▯
        </div>
        <div className="flex h-12 items-center justify-center">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 rounded-lg bg-[#131312] px-3 py-1.5 text-sm text-[#aaa39a] no-underline hover:text-[#d8cab8]"
          >
            <span aria-hidden className="mr-1 h-1.5 w-1.5 rounded-full bg-[#a9d2b4]" />
            <span>{homeWorkspaceLabel}</span>
            <span aria-hidden>·</span>
            <span className="underline underline-offset-4">{homeProviderUncheckedLabel}</span>
          </Link>
        </div>
        <div className="absolute right-5 top-4 text-lg text-[#e3dbce]" aria-hidden>
          ♙
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-16 md:pb-20">
          <div className="flex w-full max-w-[676px] flex-col items-center">
            <HomeComposer />
            <HomeQuickActions />
            <HomeContextStrip />
          </div>
        </div>
        <div
          className="absolute -right-5 top-[78%] grid h-10 w-10 place-items-center rounded-full border border-[#3a3936] bg-[#2d2d2a]"
          aria-hidden
        >
          🦉
        </div>
      </main>
    </div>
  );
}
