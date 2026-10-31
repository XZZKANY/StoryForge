import { Shield } from 'lucide-react';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import {
  AGENT_PERMISSION_PROFILE_OPTIONS,
  visiblePermissionProfile,
} from '../../lib/agent-permission';
import { ComposerMenuSelect } from './ComposerMenuSelect';

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
  const shown = visiblePermissionProfile(value);
  const currentOption = AGENT_PERMISSION_PROFILE_OPTIONS.find((option) => option.value === shown);
  return (
    <ComposerMenuSelect<AgentPermissionProfile>
      options={AGENT_PERMISSION_PROFILE_OPTIONS}
      selected={shown}
      onSelect={(profile) => {
        onChange(profile);
      }}
      triggerIcon={
        <Shield
          size={14}
          strokeWidth={1.7}
          className="flex-shrink-0 [@container(max-width:26rem)]:hidden"
          aria-hidden="true"
        />
      }
      triggerText={currentOption?.label ?? value}
      triggerTitle="AI 对本作品的权限（按作品记住，只影响下一次发送）"
      ariaLabel="AI 对本作品的权限档位"
      menuLabel="选择权限档位"
      testId="permission-profile-selector"
      className="flex-shrink-0"
      disabled={disabled}
      busy={busy}
      busyTitle="本轮正在按启动时的权限档位执行"
      fitToComposer={fitToComposer}
    />
  );
}
