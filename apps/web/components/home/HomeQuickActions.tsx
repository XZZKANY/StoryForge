import Link from 'next/link';

import { homeQuickActions } from './home-data';

export function HomeQuickActions() {
  return (
    <nav aria-label="创作快捷动作" className="mt-4">
      <ul className="!m-0 !flex !flex-wrap !justify-center !gap-2 !p-0">
        {homeQuickActions.map((action) => (
          <li key={action.label} className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
            <Link
              href={action.href}
              title={action.hint}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#3a3937] bg-[#343432] px-3 text-sm font-bold text-[#fffaf0] no-underline hover:border-[#d96f43] hover:text-[#f6d2bd]"
            >
              <span className="text-[15px] font-normal opacity-70" aria-hidden>
                {action.icon}
              </span>
              {action.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
