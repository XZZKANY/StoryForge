import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import { AGENT_PERMISSION_PROFILE_OPTIONS } from '../../lib/agent-permission';

interface PermissionProfileSelectorProps {
  value: AgentPermissionProfile;
  onChange: (profile: AgentPermissionProfile) => void;
  disabled?: boolean;
  busy?: boolean;
}

export function PermissionProfileSelector({
  value,
  onChange,
  disabled = false,
  busy = false,
}: PermissionProfileSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const currentOption = AGENT_PERMISSION_PROFILE_OPTIONS.find((opt) => opt.value === value);

  const closeMenu = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const options = Array.from(
      listboxRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const selectedIndex = options.findIndex(
      (option) => option.getAttribute('aria-selected') === 'true',
    );
    options[selectedIndex >= 0 ? selectedIndex : 0]?.focus({ preventScroll: true });

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        const target = event.target instanceof Element ? event.target : null;
        const focusableOutside = target?.closest(
          'button,a,input,textarea,select,[contenteditable="true"],[role="button"],[tabindex]:not([tabindex="-1"])',
        );
        closeMenu(!focusableOutside);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeMenu, isOpen]);

  function handleSelect(profile: AgentPermissionProfile) {
    onChange(profile);
    // Keep the composer toolbar in the tab sequence after the option unmounts.
    closeMenu();
  }

  const effectiveDisabled = disabled || busy;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !effectiveDisabled && setIsOpen(!isOpen)}
        onKeyDown={(event) => {
          if (effectiveDisabled || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
        disabled={effectiveDisabled}
        title={
          busy
            ? '本轮正在按启动时的权限档位执行'
            : 'Agent 对本项目的权限（按项目记住，只影响下一次发送）'
        }
        aria-label="Agent 对本项目的权限档位"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listboxId : undefined}
        className="flex h-[22px] min-w-[88px] items-center gap-1 rounded-sm border border-border bg-background px-2 text-2xs text-muted outline-none transition-colors hover:border-accent focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="permission-profile-selector"
      >
        <span className="flex-1 text-left">{currentOption?.label ?? value}</span>
        <ChevronDown
          size={12}
          strokeWidth={1.7}
          className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label="选择权限档位"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            const options = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
            );
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            let nextIndex: number | null = null;
            if (event.key === 'ArrowDown') nextIndex = (index + 1) % options.length;
            if (event.key === 'ArrowUp') nextIndex = (index <= 0 ? options.length : index) - 1;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = options.length - 1;
            if (nextIndex !== null && options.length > 0) {
              event.preventDefault();
              options[nextIndex]?.focus();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              closeMenu();
              return;
            }
            if (event.key === 'Tab') {
              // Return to the trigger before the native Tab navigation continues.
              // Without this, removing the focused option leaves focus on document.body.
              closeMenu();
            }
          }}
          className="absolute bottom-full left-0 z-50 mb-1 w-[280px] rounded-md border border-border bg-surface shadow-lg"
        >
          {AGENT_PERMISSION_PROFILE_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => handleSelect(option.value)}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-elevated ${
                  isSelected ? 'bg-elevated' : ''
                }`}
                data-testid={`permission-option-${option.value}`}
              >
                <span
                  className={`text-xs font-medium ${isSelected ? 'text-accent' : 'text-foreground'}`}
                >
                  {option.label}
                </span>
                <span className="text-2xs leading-snug text-subtle">{option.hint}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
