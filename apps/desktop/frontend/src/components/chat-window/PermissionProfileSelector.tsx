import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronDown, Shield } from 'lucide-react';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import { AGENT_PERMISSION_PROFILE_OPTIONS } from '../../lib/agent-permission';

interface PermissionProfileSelectorProps {
  value: AgentPermissionProfile;
  onChange: (profile: AgentPermissionProfile) => void;
  disabled?: boolean;
  busy?: boolean;
  /** Use the relative Composer frame as the popup's containing block. */
  fitToComposer?: boolean;
}

export function PermissionProfileSelector({
  value,
  onChange,
  disabled = false,
  busy = false,
  fitToComposer = false,
}: PermissionProfileSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectionClaimedRef = useRef(false);
  const menuId = useId();
  const effectiveDisabled = disabled || busy;
  // Permission availability changing invalidates the open interaction. Do not revive an
  // old menu when busy clears, or defer closing until an effect after disabled is painted.
  if (effectiveDisabled && isOpen) setIsOpen(false);
  const menuOpen = isOpen && !effectiveDisabled;
  const currentOption = AGENT_PERMISSION_PROFILE_OPTIONS.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (menuOpen) optionRefs.current[focusedIndex]?.focus();
  }, [menuOpen, focusedIndex]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  function openMenu() {
    if (effectiveDisabled) return;
    selectionClaimedRef.current = false;
    setFocusedIndex(
      Math.max(
        0,
        AGENT_PERMISSION_PROFILE_OPTIONS.findIndex((option) => option.value === value),
      ),
    );
    setIsOpen(true);
  }

  function closeMenu(restoreFocus = false) {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function handleSelect(profile: AgentPermissionProfile) {
    if (effectiveDisabled || !menuOpen || selectionClaimedRef.current) return;
    selectionClaimedRef.current = true;
    closeMenu(true);
    onChange(profile);
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
    const count = AGENT_PERMISSION_PROFILE_OPTIONS.length;
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
    if ((event.key === 'Enter' || event.key === ' ') && event.target !== triggerRef.current) {
      event.preventDefault();
      event.stopPropagation();
      handleSelect(AGENT_PERMISSION_PROFILE_OPTIONS[focusedIndex].value);
    }
  }

  return (
    <div
      ref={containerRef}
      className={fitToComposer ? 'static' : 'relative'}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          closeMenu();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (menuOpen ? closeMenu() : openMenu())}
        disabled={effectiveDisabled}
        title={
          busy
            ? '本轮正在按启动时的权限档位执行'
            : 'Agent 对本项目的权限（按项目记住，只影响下一次发送）'
        }
        aria-label="Agent 对本项目的权限档位"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-haspopup="listbox"
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="permission-profile-selector"
      >
        <Shield size={14} strokeWidth={1.7} className="flex-shrink-0" aria-hidden="true" />
        <span className="text-left">{currentOption?.label ?? value}</span>
        <ChevronDown
          size={12}
          strokeWidth={1.7}
          className={`flex-shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {menuOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label="选择权限档位"
          className={`absolute bottom-full z-50 mb-2 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-dropdown ${fitToComposer ? 'inset-x-0' : 'left-0 w-[280px] max-w-[calc(100vw-2rem)]'}`}
        >
          {AGENT_PERMISSION_PROFILE_OPTIONS.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={index === focusedIndex ? 0 : -1}
                onFocus={() => setFocusedIndex(index)}
                onClick={() => handleSelect(option.value)}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-agent ${isSelected ? 'bg-elevated/70' : ''}`}
                data-testid={`permission-option-${option.value}`}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-xs font-medium ${isSelected ? 'text-agent' : 'text-foreground'}`}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-2xs leading-snug text-subtle">
                    {option.hint}
                  </span>
                </span>
                <span className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-agent" aria-hidden="true">
                  {isSelected && <Check size={14} strokeWidth={1.7} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
