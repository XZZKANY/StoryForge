'use client';

export type ActivityBarProps = {
  readonly activePanel: string;
  readonly onSelectPanel?: (panel: string) => void;
  readonly panelHrefs?: Readonly<Record<string, string>>;
};

const activities = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'search', label: '搜索' },
  { id: 'memory', label: 'Story Memory' },
  { id: 'runs', label: '运行' },
  { id: 'problems', label: 'Problems' },
];

export function ActivityBar({ activePanel, onSelectPanel, panelHrefs = {} }: ActivityBarProps) {
  return (
    <nav
      aria-label="Activity Bar"
      className="flex flex-col gap-2 border-r border-stone-800 bg-stone-950 p-2 text-xs text-stone-200"
    >
      {activities.map((activity) => (
        <a
          key={activity.id}
          role="button"
          aria-pressed={activePanel === activity.id}
          href={panelHrefs[activity.id] ?? '#'}
          onClick={(event) => {
            event.preventDefault();
            onSelectPanel?.(activity.id);
          }}
          className="rounded px-2 py-2 hover:bg-stone-800 aria-pressed:bg-sky-700"
        >
          {activity.label}
        </a>
      ))}
    </nav>
  );
}
