import Link from 'next/link';

import { homeNavItems, homeRecentEmpty, homeRecentItems } from './home-data';

export function HomeSidebar() {
  return (
    <aside
      aria-label="StoryForge 主导航"
      className="hidden border-r border-[#3b3a37] bg-gradient-to-r from-[#171715] to-[#1c1c1a] px-4 py-3 md:flex md:flex-col"
    >
      <div className="flex h-9 items-center justify-between">
        <Link href="/" className="font-serif text-2xl font-semibold tracking-tight text-[#f4eadb] no-underline">
          StoryForge
        </Link>
        <span className="text-sm text-[#c9c0b5]" aria-hidden>
          ▯
        </span>
      </div>
      <nav aria-label="StoryForge 主导航" className="mt-6">
        <ul className="!m-0 !grid !grid-cols-1 !gap-3.5 !p-0">
          {homeNavItems.map((item, index) => (
            <li
              key={`${item.label}-${item.href}`}
              className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
            >
              <Link
                href={item.href}
                title={item.description}
                className="group flex items-center gap-3 rounded-lg text-[15px] text-[#e7dfd3] no-underline hover:bg-[#2b2b29]/70"
              >
                <span
                  aria-hidden
                  className={`grid h-5 w-5 place-items-center text-[#f3eadf] ${
                    index === 0 ? 'rounded-full bg-[#353532]' : ''
                  }`}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {item.label === '运行诊断' ? (
                  <span className="ml-auto rounded-full border border-[#45536a] px-2 py-0.5 text-xs text-[#a9c0ff]">
                    审计
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby="home-recent-title" className="mt-7 min-h-0">
        <h2 id="home-recent-title" className="text-xs font-normal text-[#89827a]">最近记录</h2>
        <p className="sr-only">{homeRecentEmpty}</p><ul className="!m-0 mt-3 !grid !grid-cols-1 !gap-3.5 !p-0 text-sm text-[#d7cec1]">
          {homeRecentItems.map((item) => (
            <li key={item.title} className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
              <span className="block leading-tight">{item.title}</span>
              <span className="mt-1 block text-xs text-[#827b72]">{item.summary}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-auto flex items-center gap-3 border-t border-[#3b3a37] pt-3" aria-label="工作区状态">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-[#d9d2c5] font-bold text-[#141412]">
          SF
        </div>
        <div>
          <p className="m-0 text-sm font-bold text-[#e8decb]">本地工作区</p>
          <p className="m-0 text-xs text-[#908a82]">Provider 待检查</p>
        </div>
      </section>
    </aside>
  );
}
