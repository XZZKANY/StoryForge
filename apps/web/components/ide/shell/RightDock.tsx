'use client';

import { AgentSidebar } from '../agent/AgentSidebar';

export function RightDock() {
  return (
    <aside
      aria-label="Right Dock"
      className="border-l border-stone-800 bg-stone-900 p-4 text-sm text-stone-200"
    >
      <h2 className="font-semibold">Right Dock</h2>
      <div className="mt-3">
        <AgentSidebar />
      </div>
    </aside>
  );
}
