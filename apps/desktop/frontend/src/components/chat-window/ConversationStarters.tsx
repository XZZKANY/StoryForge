const STARTERS = [
  { label: '审稿', prompt: '请审阅当前章节，指出最值得改进的问题，并说明理由。' },
  { label: '修订', prompt: '请为当前章节提出修订建议，保留原有叙事风格，修改前让我确认。' },
  { label: '起草', prompt: '我想起草下一段故事，请先和我确认情节目标、视角与篇幅。' },
  {
    label: '一致性检查',
    prompt: '请检查当前章节与已有设定、人物和时间线的一致性，列出冲突及依据。',
  },
];

export function ConversationStarters({
  onSelect,
  disabled,
}: {
  onSelect?: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-4">
      <p className="text-xs text-subtle">选择一项填入输入框，补充需求后发送</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {STARTERS.map(({ label, prompt }) => (
          <button
            key={label}
            type="button"
            disabled={disabled || !onSelect}
            onClick={() => onSelect?.(prompt)}
            aria-label={`填入${label}提示`}
            className="interactive-press min-h-9 rounded-lg border border-border-strong bg-elevated px-3 py-2 text-xs text-foreground transition-colors hover:border-agent hover:bg-agent/10 focus-visible:outline focus-visible:outline-agent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-strong disabled:hover:bg-elevated"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
