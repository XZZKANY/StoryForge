import Link from 'next/link';

import { homeNavItems, homeRecentEmpty } from './home-data';

export function HomeSidebar() {
  return (
    <aside
      aria-label="StoryForge 主导航"
      className="hidden md:flex md:flex-col md:gap-6 md:border-r md:border-stone-800 md:bg-stone-950/60 md:px-5 md:py-6"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-stone-500">StoryForge</p>
        <p className="mt-1 text-base font-semibold text-stone-100">创作工作台</p>
      </div>
      <nav aria-label="StoryForge 主导航">
        <ul className="!m-0 !grid !grid-cols-1 !gap-1 !p-0">
          {homeNavItems.map((item) => (
            <li
              key={`${item.label}-${item.href}`}
              className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
            >
              <Link
                href={item.href}
                className="block rounded-lg px-3 py-2 text-sm text-stone-200 hover:bg-stone-800/60"
              >
                <span className="block font-medium">{item.label}</span>
                <span className="mt-0.5 block text-xs text-stone-500">{item.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby="home-recent-title" className="mt-auto">
        <h2 id="home-recent-title" className="text-xs uppercase tracking-[0.2em] text-stone-500">
          最近记录
        </h2>
        <p className="mt-2 text-xs text-stone-500">{homeRecentEmpty}</p>
      </section>
    </aside>
  );
}
