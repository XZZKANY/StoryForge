'use client';

import type { Diagnostic } from '../../../../../packages/shared/src/diagnostic';
import { useMemo } from 'react';

import { createCommandRegistry } from '../commands/registry';
import { registerBuiltinCommands } from '../commands/registerBuiltinCommands';
import { ProblemsPanel } from '../panels/ProblemsPanel';
import { BookRunEventsPanel, type BookRunEventSnapshot } from '../views/BookRunEventsPanel';
import type { BookRunPanelRun } from '../views/BookRunPanel';
import { ArtifactViewer, type ArtifactViewerPreview } from '../views/ArtifactViewer';

export type BottomPanelProps = {
  readonly activePanel: string;
  readonly artifactPreview?: ArtifactViewerPreview;
  readonly bookRun?: BookRunPanelRun;
  readonly bookRunEvents?: readonly BookRunEventSnapshot[];
  readonly diagnostics?: readonly Diagnostic[];
  readonly onSelectPanel?: (panel: string) => void;
  readonly panelHrefs?: Readonly<Record<string, string>>;
};

export function BottomPanel({
  activePanel,
  artifactPreview,
  bookRun,
  bookRunEvents = [],
  diagnostics = [],
  onSelectPanel,
  panelHrefs = {},
}: BottomPanelProps) {
  const commands = useMemo(() => registerBuiltinCommands(createCommandRegistry()), []);

  return (
    <section
      aria-label="Bottom Panel"
      className="border-t border-stone-800 bg-stone-900 p-3 text-stone-100"
    >
      <div className="mb-2 flex gap-2 text-xs">
        {['problems', 'diff', 'runs', 'artifacts', 'evaluation'].map((panel) => (
          <a
            key={panel}
            role="button"
            aria-pressed={activePanel === panel}
            href={panelHrefs[panel] ?? '#'}
            onClick={(event) => {
              event.preventDefault();
              onSelectPanel?.(panel);
            }}
            className="rounded bg-stone-800 px-2 py-1 aria-pressed:bg-sky-700"
          >
            {panel}
          </a>
        ))}
      </div>
      {activePanel === 'problems' ? (
        <ProblemsPanel diagnostics={diagnostics} />
      ) : activePanel === 'runs' ? (
        <BookRunEventsPanel
          run={bookRun}
          events={bookRunEvents}
          onExecuteCommand={(commandId, args) => commands.execute(commandId, args)}
        />
      ) : activePanel === 'artifacts' ? (
        <ArtifactViewer preview={artifactPreview} />
      ) : (
        <p className="text-sm">当前底部面板：{activePanel}</p>
      )}
    </section>
  );
}
