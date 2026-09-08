import { useEffect, useRef, useState } from 'react';

import type { ChapterBrief } from './types';

export function ChapterBriefCard({
  brief,
  onConfirm,
  onCancel,
  busy = false,
}: {
  brief: ChapterBrief;
  onConfirm: (brief: ChapterBrief) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState(brief);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const card = cardRef.current;
    goalRef.current?.focus({ preventScroll: true });
    return () => {
      if (
        previousFocus?.isConnected &&
        (document.activeElement === document.body || card?.contains(document.activeElement))
      ) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  const update = (key: keyof ChapterBrief, value: string | number) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <section
      ref={cardRef}
      className="rounded-lg border border-agent/40 bg-panel px-3 py-3"
      data-testid="chapter-brief-card"
      role="region"
      aria-labelledby="chapter-brief-title"
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!busy) onCancel();
        }
      }}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="chapter-brief-title" className="text-xs font-semibold text-foreground">
            Chapter Brief
          </h3>
          <div className="mt-1 truncate text-xs text-subtle">
            {draft.targetPath} · revision {draft.revision}
          </div>
        </div>
        <span className="rounded-md border border-agent/40 px-1.5 py-0.5 text-3xs text-agent">
          <span className="sr-only">状态：</span>
          待确认
        </span>
      </div>
      <label className="block text-xs text-subtle">
        本章目标
        <textarea
          ref={goalRef}
          className="mt-1 min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-agent disabled:cursor-wait disabled:opacity-50"
          style={{
            boxShadow: 'var(--shadow-inset)',
            transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow =
              'var(--shadow-inset), 0 0 0 3px rgb(var(--agent) / 0.1)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
          }}
          value={draft.goal}
          onChange={(event) => update('goal', event.target.value)}
          disabled={busy}
          aria-label="本章目标"
          data-testid="chapter-brief-goal"
        />
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs text-subtle">
          最少字数
          <input
            className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:cursor-wait disabled:opacity-50"
            style={{
              boxShadow: 'var(--shadow-inset)',
              transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow =
                'var(--shadow-inset), 0 0 0 3px rgb(var(--agent) / 0.1)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
            }}
            type="number"
            min={1}
            value={draft.targetCharsMin}
            onChange={(event) => update('targetCharsMin', Number(event.target.value))}
            disabled={busy}
            aria-label="最少字数"
          />
        </label>
        <label className="text-xs text-subtle">
          最多字数
          <input
            className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:cursor-wait disabled:opacity-50"
            style={{
              boxShadow: 'var(--shadow-inset)',
              transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow =
                'var(--shadow-inset), 0 0 0 3px rgb(var(--agent) / 0.1)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
            }}
            type="number"
            min={1}
            value={draft.targetCharsMax}
            onChange={(event) => update('targetCharsMax', Number(event.target.value))}
            disabled={busy}
            aria-label="最多字数"
          />
        </label>
      </div>
      <BriefList
        label="必达节拍"
        values={draft.requiredBeats}
        onChange={(values) => setDraft({ ...draft, requiredBeats: values })}
        disabled={busy}
      />
      <BriefList
        label="禁写事项"
        values={draft.forbiddenItems}
        onChange={(values) => setDraft({ ...draft, forbiddenItems: values })}
        disabled={busy}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="h-8 rounded-md border border-border px-3 text-xs text-muted hover:bg-elevated disabled:cursor-wait disabled:opacity-50"
          onClick={onCancel}
          disabled={busy}
          data-testid="chapter-brief-cancel"
        >
          取消
        </button>
        <button
          type="button"
          className="h-8 rounded-md bg-agent px-3 text-xs text-agent-foreground hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
          onClick={() => onConfirm(draft)}
          disabled={busy}
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
  disabled = false,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <label className="mt-2 block text-xs text-subtle">
      {label}
      <input
        className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:cursor-wait disabled:opacity-50"
        value={values.join('；')}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(/[;；]/)
              .map((value) => value.trim())
              .filter(Boolean),
          )
        }
        aria-label={label}
        disabled={disabled}
      />
    </label>
  );
}
