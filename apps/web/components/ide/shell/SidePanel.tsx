'use client';

import { StoryMemoryExplorer } from '../views/StoryMemoryExplorer';

export type SidePanelProps = {
  readonly activePanel: string;
  readonly onOpenTab?: (tabId: string) => void;
};

const legacyEntries = [
  ['legacy:studio', 'Studio'],
  ['legacy:retrieval', 'Retrieval'],
  ['legacy:runs', 'Runs'],
  ['legacy:artifacts', 'Artifacts'],
  ['legacy:evaluations', 'Evaluations'],
] as const;

export function SidePanel({ activePanel, onOpenTab }: SidePanelProps) {
  return (
    <aside
      aria-label="Explorer"
      className="border-r border-stone-800 bg-stone-900 p-4 text-stone-100"
    >
      <div className="mb-3 text-xs uppercase tracking-wide text-stone-400">
        {activePanel === 'search'
          ? 'Search'
          : activePanel === 'memory'
            ? 'Story Memory'
            : 'Explorer'}
      </div>
      {activePanel === 'memory' ? (
        <StoryMemoryExplorer />
      ) : (
        <>
          <h2 className="mb-3 font-semibold">StoryForge 工作区</h2>
          <ul className="space-y-2 text-sm">
            {legacyEntries.map(([tabId, label]) => (
              <li key={tabId}>
                <button
                  type="button"
                  onClick={() => onOpenTab?.(tabId)}
                  className="w-full rounded px-2 py-1 text-left hover:bg-stone-800"
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
