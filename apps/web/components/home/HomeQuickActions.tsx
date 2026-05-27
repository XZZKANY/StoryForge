import Link from 'next/link';

import { homeQuickActions } from './home-data';

export function HomeQuickActions() {
  return (
    <nav aria-label="创作快捷动作" className="mt-6">
      <ul className="!m-0 !flex !flex-wrap !justify-center !gap-2 !p-0">
        {homeQuickActions.map((action) => (
          <li key={action.label} className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
            <Link
              href={action.href}
              title={action.hint}
              className="inline-flex items-center rounded-full border border-stone-700 bg-stone-900/60 px-4 py-1.5 text-sm text-stone-200 hover:border-amber-700 hover:text-amber-300"
            >
              {action.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
