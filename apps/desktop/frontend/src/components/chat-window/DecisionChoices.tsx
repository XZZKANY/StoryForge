import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, PlainButton } from '../ui';

export type DecisionChoice = {
  label: string;
  hint?: string;
  tone?: 'default' | 'danger';
  /** 这一项自带输入框，一直摆在列表里，选到就能直接打字（「拒绝，并告诉 AI 怎么改」）。 */
  needsText?: {
    placeholder: string;
    submitLabel: string;
    inputTestid?: string;
    submitTestid?: string;
  };
  /** 返回 false（或兑现为 false）表示没办成：先写一句话再发的选项会留着那句话。 */
  onSelect: (text?: string) => void | boolean | Promise<void | boolean>;
  testid?: string;
};

/**
 * 需要作者拍板的一步：像 Claude Code 那样在对话底部就地给一组编号选项，一次只问一件事，
 * 选完下一件再在同一位置出现。↑↓ 移动、回车确定、数字键直选（焦点在选项上时）。
 * 要写一句话的选项把输入框直接摆在列表里，选到就能打字，不再跳到下一个界面。
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
  const [text, setText] = useState('');
  // 普通选项存按钮，要写字的选项存它的输入框：移到哪一项，焦点就落在能操作的那个元素上。
  const optionRefs = useRef<Array<HTMLElement | null>>([]);
  const sending = useRef(false);

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

  const move = (index: number) => {
    const next = (index + choices.length) % choices.length;
    setActive(next);
    optionRefs.current[next]?.focus();
  };

  const choose = (index: number) => {
    const choice = choices[index];
    if (!choice) return;
    if (choice.needsText) {
      move(index);
      return;
    }
    choice.onSelect();
  };

  const submitText = (choice: DecisionChoice) => {
    const direction = text.trim();
    // 输入框一直在：空着回车不算选了它，免得误把这版否掉。
    if (!direction || sending.current) return;
    const done = (sent: unknown) => {
      // 没办成：作者写的那句话留在输入框里，可以直接再发。
      if (sent !== false) setText('');
    };
    const result = choice.onSelect(direction);
    if (!(result instanceof Promise)) return done(result);
    sending.current = true;
    void result
      .catch(() => false)
      .then((sent) => {
        sending.current = false;
        done(sent);
      });
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(active - 1);
    } else if (event.target instanceof HTMLInputElement) {
      // 在输入框里：数字和字母都是在写话，交给输入框自己。
      return;
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

  const activeChoice = choices[active];
  return (
    <div className="flex flex-col gap-1.5" data-testid={testid}>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground" data-testid="run-action-status">
          {title}
        </p>
        {detail && <p className="text-xs text-muted">{detail}</p>}
      </div>
      <div role="group" aria-label={title} className="flex flex-col" onKeyDown={onListKeyDown}>
        {choices.map((choice, index) => {
          const isActive = index === active;
          const rowClass = `rounded-md px-2 py-1 text-left text-sm transition-colors ${
            isActive ? 'bg-background' : ''
          } ${choice.tone === 'danger' ? 'text-error' : 'text-foreground'}`;
          const marker = (
            <>
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
            </>
          );
          const needsText = choice.needsText;
          if (needsText) {
            return (
              <div
                key={choice.label}
                className={`flex w-full flex-col gap-1 ${rowClass}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => move(index)}
                data-testid={choice.testid}
                data-active={isActive ? 'true' : 'false'}
              >
                <div className="flex items-baseline gap-2">{marker}</div>
                <div className="flex items-center gap-2 pl-8">
                  <input
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    tabIndex={isActive ? 0 : -1}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onFocus={() => setActive(index)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        submitText(choice);
                      }
                    }}
                    placeholder={needsText.placeholder}
                    aria-label={choice.label}
                    className="sf-input min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted"
                    data-testid={needsText.inputTestid}
                  />
                  <Button
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      submitText(choice);
                    }}
                    disabled={!text.trim()}
                    size="xs"
                    data-testid={needsText.submitTestid}
                  >
                    {needsText.submitLabel}
                  </Button>
                </div>
              </div>
            );
          }
          return (
            <PlainButton
              key={choice.label}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              tabIndex={isActive ? 0 : -1}
              onFocus={() => setActive(index)}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
              className={`flex w-full items-baseline gap-2 focus-visible:outline-none ${rowClass}`}
              data-testid={choice.testid}
              data-active={isActive ? 'true' : 'false'}
            >
              {marker}
            </PlainButton>
          );
        })}
      </div>
      <p className="px-2 text-3xs text-subtle" aria-hidden="true">
        {activeChoice?.needsText
          ? '直接输入 · 回车发出 · ↑↓ 换选项'
          : `↑↓ 选择 · 回车确定 · 1–${choices.length} 直接选`}
      </p>
    </div>
  );
}
