import { useEffect, useRef, useState } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);

  const currentOption = AGENT_PERMISSION_PROFILE_OPTIONS.find((opt) => opt.value === value);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  function handleSelect(profile: AgentPermissionProfile) {
    onChange(profile);
    setIsOpen(false);
  }

  const effectiveDisabled = disabled || busy;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !effectiveDisabled && setIsOpen(!isOpen)}
        disabled={effectiveDisabled}
        title={
          busy
            ? '本轮正在按启动时的权限档位执行'
            : 'Agent 对本项目的权限（按项目记住，只影响下一次发送）'
        }
        aria-label="Agent 对本项目的权限档位"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
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
          role="listbox"
          aria-label="选择权限档位"
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
