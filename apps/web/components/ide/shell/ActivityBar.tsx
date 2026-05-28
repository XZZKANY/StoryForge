'use client';

export type ActivityBarProps = {
  readonly activePanel: string;
  readonly onSelectPanel?: (panel: string) => void;
};

const activities = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'search', label: '搜索' },
  { id: 'memory', label: 'Story Memory' },
  { id: 'runs', label: '运行' },
  { id: 'problems', label: 'Problems' },
];

export function ActivityBar({ activePanel, onSelectPanel }: ActivityBarProps) {
  return (
    <nav
      aria-label="Activity Bar"
      className="flex flex-col gap-2 border-r border-stone-800 bg-stone-950 p-2 text-xs text-stone-200"
    >
      {activities.map((activity) => (
        <button
          key={activity.id}
          type="button"
          aria-pressed={activePanel === activity.id}
          onClick={() => onSelectPanel?.(activity.id)}
          className="rounded px-2 py-2 hover:bg-stone-800 aria-pressed:bg-sky-700"
        >
          {activity.label}
        </button>
      ))}
    </nav>
  );
}
