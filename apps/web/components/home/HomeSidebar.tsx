'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  homeAccountMenuItems,
  homeNavItems,
  homeProviderUncheckedLabel,
  homeRecentEmpty,
  homeWorkspaceLabel,
  type HomeRecentItem,
} from './home-data';
import { createHomeViewHref, type HomeView } from './home-view';

export function HomeSidebar({
  activeView,
  recentItems = [],
}: {
  readonly activeView: HomeView;
  readonly recentItems?: readonly HomeRecentItem[];
}) {
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);

  return (
    <aside
      aria-label="StoryForge 主导航"
      className="sticky top-0 hidden h-screen min-h-screen overflow-hidden border-r border-[#34332f] bg-[#171715] px-4 pb-6 pt-4 md:flex md:flex-col"
    >
      <div className="flex h-9 items-center justify-between">
        <Link
          href="/"
          className="font-serif text-[clamp(21px,1.55vw,26px)] font-semibold leading-none !text-[#f4eadb] no-underline"
        >
          StoryForge
        </Link>
        <Link
          href={createHomeViewHref('projects')}
          aria-label="New project 新建项目"
          className="grid h-7 w-7 place-items-center rounded-lg bg-[#2d2d2a] text-lg !text-[#f4eadb] no-underline hover:bg-[#383832]"
        >
          +
        </Link>
      </div>

      <nav aria-label="StoryForge 主导航" className="mt-[clamp(24px,3vh,34px)]">
        <ul className="!m-0 !grid !grid-cols-1 !gap-[clamp(7px,1vh,10px)] !p-0">
          {homeNavItems.map((item) => (
            <li
              key={`${item.label}-${item.href}`}
              className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
            >
              <Link
                href={createHomeViewHref(item.view)}
                title={item.description}
                aria-current={activeView === item.view ? 'page' : undefined}
                className={`group flex min-h-[clamp(36px,4.4vh,42px)] items-center gap-3 rounded-lg px-2 text-[clamp(13px,0.9vw,15px)] no-underline hover:bg-[#252522] ${
                  activeView === item.view ? 'bg-[#2c2b27] !text-[#f8efe2]' : '!text-[#e7dfd3]'
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-semibold ${
                    activeView === item.view
                      ? 'border-[#6f675a] bg-[#3a3832] text-[#f6ead7]'
                      : 'border-[#3d3b36] text-[#cfc5b8]'
                  }`}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 truncate">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section
        aria-labelledby="home-recent-title"
        className="mt-[clamp(24px,3vh,34px)] min-h-0 !border-0 !bg-transparent !p-0 !shadow-none"
      >
        <h2 id="home-recent-title" className="text-xs font-normal text-[#89827a]">
          最近记录
        </h2>
        {recentItems.length > 0 ? (
          <ul className="!m-0 mt-3 !grid !grid-cols-1 !gap-3 !p-0 text-sm text-[#d7cec1]">
            {recentItems.map((item) => (
              <li key={item.title} className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
                <Link
                  href={item.href}
                  title={item.summary}
                  className="block truncate leading-tight !text-[#d7cec1] no-underline hover:!text-[#f4eadb]"
                >
                  {item.title}
                </Link>
                <span className="sr-only">{item.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-3 text-sm leading-5 text-[#8f877d]">{homeRecentEmpty}</p>
        )}
      </section>

      <section
        className="relative !mb-0 !mt-auto !rounded-none !border-0 !border-t !border-[#34332f] !bg-transparent !p-0 pt-4 !shadow-none"
        aria-label="账号和工作区菜单"
      >
        {isAccountMenuOpen && (
          <div
            id="home-account-menu"
            role="menu"
            className="absolute bottom-[76px] left-0 right-0 z-10 rounded-xl border border-[#4b4943] bg-[#353530] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
          >
            <p className="m-0 px-3 pb-2 pt-1 text-xs text-[#aaa39a]">StoryForge 本地工作区</p>
            <ul className="!m-0 !grid !grid-cols-1 !gap-1 !p-0">
              {homeAccountMenuItems.map((item) => (
                <li key={item.label} className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
                  <Link
                    href={item.href}
                    role="menuitem"
                    title={item.description}
                    className="block rounded-lg px-3 py-2 text-sm font-semibold !text-[#f0e6d7] no-underline hover:bg-[#44423b]"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          aria-controls="home-account-menu"
          aria-expanded={isAccountMenuOpen}
          onClick={() => setIsAccountMenuOpen((open) => !open)}
          className="flex w-full items-center gap-3 rounded-xl border border-[#34332f] bg-[#20201e] p-3 text-left hover:bg-[#252522]"
        >
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#d9d2c5] font-bold text-[#141412]">
            SF
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm font-bold text-[#e8decb]">{homeWorkspaceLabel}</p>
            <p className="m-0 text-xs text-[#c69a6a]">{homeProviderUncheckedLabel}</p>
          </div>
          <span className="text-lg text-[#aaa39a]" aria-hidden>
            {isAccountMenuOpen ? '⌄' : '⌃'}
          </span>
        </button>
      </section>
    </aside>
  );
}
