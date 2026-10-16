import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export type DecisionChoice = {
  label: string;
  hint?: string;
  tone?: 'default' | 'danger';
  /** 选了以后先写一句话再发（「拒绝，并告诉 AI 怎么改」）。 */
  needsText?: {
    placeholder: string;
    submitLabel: string;
    inputTestid?: string;
    submitTestid?: string;
  };
  onSelect: (text?: string) => void;
  testid?: string;
};

/**
 * 需要作者拍板的一步：像 Claude Code 那样在对话底部就地给一组编号选项，一次只问一件事，
 * 选完下一件再在同一位置出现。↑↓ 移动、回车确定、数字键直选（焦点在选项上时）。
 * 不弹居中窗口、不盖住编辑器里要看的对比。
 */
export function DecisionChoices({
  title,
  detail,
  choices,
  onTypeAhead,
  testid = 'decision-choices',
}: {
  title: string;
  detail?: string;
  choices: readonly DecisionChoice[];
  /** 选项有焦点时按了普通字符：作者其实想打字，把焦点还给输入框。 */
  onTypeAhead?: () => void;
  testid?: string;
}) {
  const [active, setActive] = useState(0);
  const [writing, setWriting] = useState<number | null>(null);
  const [text, setText] = useState('');
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 作者刚在对话里发完话、输入框是空的，才把焦点交给选项；正在编辑器或输入框里写字时不抢。
  useEffect(() => {
    const focused = document.activeElement;
    const composer = focused?.closest('[data-testid="composer-surface"]');
    const composerEmpty =
      !(focused instanceof HTMLTextAreaElement) || focused.value.trim().length === 0;
    if (focused === document.body || focused === null || (composer && composerEmpty)) {
      optionRefs.current[0]?.focus();
    }
  }, []);

  const choose = (index: number) => {
    const choice = choices[index];
    if (!choice) return;
    if (choice.needsText) {
      setActive(index);
      setWriting(index);
      setText('');
      return;
    }
    choice.onSelect();
  };

  const move = (index: number) => {
    const next = (index + choices.length) % choices.length;
    setActive(next);
    optionRefs.current[next]?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(active - 1);
    } else if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < choices.length) {
        event.preventDefault();
        choose(index);
      }
    } else if (event.key.length === 1 && event.key !== ' ' && onTypeAhead) {
      // 不 preventDefault：焦点先挪回输入框，这个字随后落进输入框。
      onTypeAhead();
    }
  };

  const writingChoice = writing === null ? null : choices[writing];
  const submitText = () => {
    if (!writingChoice) return;
    writingChoice.onSelect(text.trim());
    setWriting(null);
    setText('');
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid={testid}>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground" data-testid="run-action-status">
          {title}
        </p>
        {detail && <p className="text-xs text-muted">{detail}</p>}
      </div>
      {writingChoice?.needsText ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                submitText();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setWriting(null);
                optionRefs.current[writing ?? 0]?.focus();
              }
            }}
            placeholder={writingChoice.needsText.placeholder}
            aria-label={writingChoice.label}
            className="sf-input min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground placeholder:text-muted"
            data-testid={writingChoice.needsText.inputTestid}
          />
          <button
            type="button"
            onClick={submitText}
            className="h-7 flex-shrink-0 rounded-md border border-border px-2.5 text-xs text-foreground transition-colors hover:bg-elevated"
            data-testid={writingChoice.needsText.submitTestid}
          >
            {writingChoice.needsText.submitLabel}
          </button>
        </div>
      ) : (
        <div role="group" aria-label={title} className="flex flex-col" onKeyDown={onListKeyDown}>
          {choices.map((choice, index) => {
            const isActive = index === active;
            return (
              <button
                key={choice.label}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                tabIndex={isActive ? 0 : -1}
                onFocus={() => setActive(index)}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors focus-visible:outline-none ${
                  isActive ? 'bg-elevated' : ''
                } ${choice.tone === 'danger' ? 'text-error' : 'text-foreground'}`}
                data-testid={choice.testid}
                data-active={isActive ? 'true' : 'false'}
              >
                <span
                  aria-hidden="true"
                  className={`w-3 flex-shrink-0 text-agent ${isActive ? '' : 'invisible'}`}
                >
                  ❯
                </span>
                <span className="flex-shrink-0 tabular-nums text-subtle">{index + 1}.</span>
                <span className="min-w-0">{choice.label}</span>
                {choice.hint && (
                  <span className="min-w-0 truncate text-xs text-subtle">{choice.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <p className="px-2 text-3xs text-subtle" aria-hidden="true">
        {writingChoice
          ? '回车发出 · Esc 回到选项'
          : `↑↓ 选择 · 回车确定 · 1–${choices.length} 直接选`}
      </p>
    </div>
  );
}
