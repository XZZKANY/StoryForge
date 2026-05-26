'use client';

import Link from 'next/link';
import { useState } from 'react';

import { primaryNavLinks } from './site-nav-links';

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="site-nav-sidebar"
        className="fixed left-3 top-3 z-30 inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white/90 px-3 py-1 text-sm font-semibold shadow md:hidden dark:border-stone-700 dark:bg-stone-900/80"
      >
        <span aria-hidden>≡</span>
        <span>导航</span>
      </button>
      <aside
        id="site-nav-sidebar"
        aria-label="StoryForge 全局导航"
        data-open={open ? 'true' : 'false'}
        className="fixed inset-y-0 left-0 z-20 w-72 -translate-x-full overflow-y-auto border-r border-stone-200 bg-white/95 p-5 backdrop-blur transition-transform data-[open=true]:translate-x-0 dark:border-stone-800 dark:bg-stone-950/95 md:sticky md:top-0 md:h-screen md:translate-x-0"
      >
        <div className="mb-5">
          <p className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
            StoryForge
          </p>
          <p className="text-lg font-bold">创作工作台</p>
        </div>
        <nav aria-label="StoryForge 全局导航主菜单">
          <ul className="grid gap-2">
            {primaryNavLinks.map((link) => (
              <li key={link.href} className="!m-0 !p-0 !border-0 !bg-transparent !shadow-none">
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg border border-stone-200 px-3 py-2 text-sm hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
                >
                  <span className="font-semibold">{link.label}</span>
                  {link.description ? (
                    <span className="mt-0.5 block text-xs text-stone-600 dark:text-stone-400">
                      {link.description}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      {open ? (
        <button
          type="button"
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-10 bg-black/30 md:hidden"
        />
      ) : null}
    </>
  );
}
