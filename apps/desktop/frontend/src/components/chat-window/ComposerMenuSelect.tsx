import { FloatingSurface } from '../ui';
import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type ComposerMenuOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  /** 相邻同组的选项归在一个小标题下。 */
  group?: string;
};

function sections<T extends string>(options: readonly ComposerMenuOption<T>[]) {
  const result: { group?: string; items: { option: ComposerMenuOption<T>; index: number }[] }[] =
    [];
  options.forEach((option, index) => {
    const last = result[result.length - 1];
    if (last && last.group === option.group) last.items.push({ option, index });
    else result.push({ group: option.group, items: [{ option, index }] });
  });
  return result;
}

interface ComposerMenuSelectProps<T extends string> {
  options: readonly ComposerMenuOption<T>[];
  /** 打勾的那项；null = 都不勾。 */
  selected: T | null;
  /** 返回 Promise 时菜单等它：true 才收起，false 留在原处显示出错原因。 */
  onSelect: (value: T) => void | Promise<boolean>;
  triggerText: ReactNode;
  /** 文字前的小图标；窄时要不要藏由图标自己的 class 决定。 */
  triggerIcon?: ReactNode;
  triggerTitle: string;
  ariaLabel: string;
  menuLabel: string;
  testId: string;
  disabled?: boolean;
  busy?: boolean;
  busyTitle?: string;
  fitToComposer?: boolean;
  /** 选项下面的灰字 / 出错原因。 */
  footer?: ReactNode;
  onOpen?: () => void;
  /** 外层；输入框底部挤的时候，不该被压的传 flex-shrink-0。 */
  className?: string;
  triggerClassName?: string;
}

/** 输入框底部的中性色下拉：权限、模型、思考等级三个共用这一套开合、键盘与无障碍行为。 */
export function ComposerMenuSelect<T extends string>({
  options,
  selected,
  onSelect,
  triggerText,
  triggerIcon,
  triggerTitle,
  ariaLabel,
  menuLabel,
  testId,
  disabled = false,
  busy = false,
  busyTitle,
  fitToComposer = false,
  footer,
  onOpen,
  className = '',
  triggerClassName = '',
}: ComposerMenuSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectionClaimedRef = useRef(false);
  const menuId = useId();
  const effectiveDisabled = disabled || busy;
  if (effectiveDisabled && isOpen) setIsOpen(false);
  const menuOpen = isOpen && !effectiveDisabled;

  useLayoutEffect(() => {
    if (menuOpen) optionRefs.current[focusedIndex]?.focus();
  }, [menuOpen, focusedIndex]);

  function openMenu() {
    if (effectiveDisabled) return;
    selectionClaimedRef.current = false;
    setFocusedIndex(
      Math.max(
        0,
        options.findIndex((option) => option.value === selected),
      ),
    );
    setIsOpen(true);
    onOpen?.();
  }

  function closeMenu(restoreFocus = false) {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function handleSelect(value: T) {
    if (effectiveDisabled || !menuOpen || selectionClaimedRef.current) return;
    selectionClaimedRef.current = true;
    const result = onSelect(value);
    if (!result) {
      closeMenu(true);
      return;
    }
    setPending(true);
    void result.then(
      (done) => {
        setPending(false);
        if (done) closeMenu(true);
        else selectionClaimedRef.current = false;
      },
      () => {
        setPending(false);
        selectionClaimedRef.current = false;
      },
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || effectiveDisabled) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!menuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        openMenu();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    const count = options.length;
    if (!count) return;
    const nextIndex =
      event.key === 'ArrowDown'
        ? (focusedIndex + 1) % count
        : event.key === 'ArrowUp'
          ? (focusedIndex + count - 1) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (nextIndex !== null) {
      event.preventDefault();
      event.stopPropagation();
      setFocusedIndex(nextIndex);
      return;
    }
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      optionRefs.current.includes(event.target as HTMLButtonElement)
    ) {
      event.preventDefault();
      event.stopPropagation();
      handleSelect(options[focusedIndex].value);
    }
  }

  return (
    <div
      className={`flex min-w-0 ${fitToComposer ? 'static' : 'relative'} ${className}`}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Element &&
          !event.currentTarget.contains(event.relatedTarget) &&
          event.relatedTarget.closest('[role="listbox"]')?.id !== menuId
        )
          closeMenu();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (menuOpen ? closeMenu() : openMenu())}
        disabled={effectiveDisabled}
        title={busy && busyTitle ? busyTitle : triggerTitle}
        aria-label={ariaLabel}
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-haspopup="listbox"
        className={`flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-xs [@container(max-width:26rem)]:px-1.5 text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent disabled:cursor-not-allowed disabled:opacity-50 ${triggerClassName}`}
        data-testid={testId}
      >
        {triggerIcon}
        <span className="min-w-0 truncate text-left">{triggerText}</span>
        <ChevronDown
          size={12}
          strokeWidth={1.7}
          className={`flex-shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {menuOpen && (
        <FloatingSurface
          triggerRef={triggerRef}
          side="top"
          fitToComposer={fitToComposer}
          onDismiss={(reason) => closeMenu(reason === 'escape')}
          id={menuId}
          role="listbox"
          aria-label={menuLabel}
          aria-busy={pending || undefined}
          className="w-[280px] animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-dropdown"
        >
          {sections(options).map((section, sectionIndex) => {
            const items = section.items.map(({ option, index }) => {
              const isSelected = option.value === selected;
              return (
                <button
                  key={option.value}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={pending || undefined}
                  tabIndex={index === focusedIndex ? 0 : -1}
                  onFocus={() => setFocusedIndex(index)}
                  onClick={() => handleSelect(option.value)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-agent ${isSelected ? 'bg-elevated/70' : ''}`}
                  data-testid={`${testId}-option-${option.value}`}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-xs ${isSelected ? 'font-medium text-foreground' : 'text-foreground'}`}
                    >
                      {option.label}
                    </span>
                    {option.hint && (
                      <span className="mt-0.5 block text-2xs leading-snug text-subtle">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  <span
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-foreground"
                    aria-hidden="true"
                  >
                    {isSelected && <Check size={14} strokeWidth={1.7} />}
                  </span>
                </button>
              );
            });
            return section.group ? (
              <div
                key={`group-${sectionIndex}`}
                role="group"
                aria-label={section.group}
                data-testid={`${testId}-group`}
              >
                <div
                  className="truncate px-2.5 pb-0.5 pt-1.5 text-3xs text-subtle"
                  aria-hidden="true"
                >
                  {section.group}
                </div>
                {items}
              </div>
            ) : sectionIndex > 0 ? (
              <div key={`group-${sectionIndex}`} className="mt-1 border-t border-border pt-1">
                {items}
              </div>
            ) : (
              <Fragment key={`group-${sectionIndex}`}>{items}</Fragment>
            );
          })}
          {footer && (
            <div className="px-2.5 pb-1 pt-1.5 text-2xs leading-snug text-subtle">{footer}</div>
          )}
        </FloatingSurface>
      )}
    </div>
  );
}
