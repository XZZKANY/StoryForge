import { useState } from 'react';

import type { ChapterBrief } from './types';

export function ChapterBriefCard({
  brief,
  onConfirm,
  onCancel,
}: {
  brief: ChapterBrief;
  onConfirm: (brief: ChapterBrief) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(brief);
  const update = (key: keyof ChapterBrief, value: string | number) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <section
      className="rounded-lg border border-agent/40 bg-panel px-3 py-3"
      data-testid="chapter-brief-card"
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-foreground">Chapter Brief</div>
          <div className="mt-1 truncate text-xs text-subtle">
            {draft.targetPath} · revision {draft.revision}
          </div>
        </div>
        <span className="rounded-md border border-agent/40 px-1.5 py-0.5 text-3xs text-agent">
          待确认
        </span>
      </div>
      <label className="block text-xs text-subtle">
        本章目标
        <textarea
          className="mt-1 min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-agent"
          value={draft.goal}
          onChange={(event) => update('goal', event.target.value)}
          data-testid="chapter-brief-goal"
        />
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs text-subtle">
          最少字数
          <input
            className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
            type="number"
            min={1}
            value={draft.targetCharsMin}
            onChange={(event) => update('targetCharsMin', Number(event.target.value))}
          />
        </label>
        <label className="text-xs text-subtle">
          最多字数
          <input
            className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
            type="number"
            min={1}
            value={draft.targetCharsMax}
            onChange={(event) => update('targetCharsMax', Number(event.target.value))}
          />
        </label>
      </div>
      <BriefList
        label="必达节拍"
        values={draft.requiredBeats}
        onChange={(values) => setDraft({ ...draft, requiredBeats: values })}
      />
      <BriefList
        label="禁写事项"
        values={draft.forbiddenItems}
        onChange={(values) => setDraft({ ...draft, forbiddenItems: values })}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="h-8 rounded-md border border-border px-3 text-xs text-muted hover:bg-elevated"
          onClick={onCancel}
          data-testid="chapter-brief-cancel"
        >
          取消
        </button>
        <button
          type="button"
          className="h-8 rounded-md bg-agent px-3 text-xs text-agent-foreground hover:opacity-90"
          onClick={() => onConfirm(draft)}
          data-testid="chapter-brief-confirm"
        >
          开始起草
        </button>
      </div>
    </section>
  );
}

function BriefList({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label className="mt-2 block text-xs text-subtle">
      {label}
      <input
        className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
        value={values.join('；')}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(/[;；]/)
              .map((value) => value.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}
