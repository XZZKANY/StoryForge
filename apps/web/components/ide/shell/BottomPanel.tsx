'use client';

import { ProblemsPanel } from '../panels/ProblemsPanel';
import { BookRunPanel } from '../views/BookRunPanel';
import { ArtifactViewer } from '../views/ArtifactViewer';

export type BottomPanelProps = {
  readonly activePanel: string;
};

export function BottomPanel({ activePanel }: BottomPanelProps) {
  return (
    <section
      aria-label="Bottom Panel"
      className="border-t border-stone-800 bg-stone-900 p-3 text-stone-100"
    >
      <div className="mb-2 flex gap-2 text-xs">
        {['problems', 'diff', 'runs', 'artifacts', 'evaluation'].map((panel) => (
          <button key={panel} type="button" className="rounded bg-stone-800 px-2 py-1">
            {panel}
          </button>
        ))}
      </div>
      {activePanel === 'problems' ? (
        <ProblemsPanel diagnostics={[]} />
      ) : activePanel === 'runs' ? (
        <BookRunPanel />
      ) : activePanel === 'artifacts' ? (
        <ArtifactViewer />
      ) : (
        <p className="text-sm">当前底部面板：{activePanel}</p>
      )}
    </section>
  );
}
