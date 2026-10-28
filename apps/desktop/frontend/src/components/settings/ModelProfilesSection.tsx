import { useContext, useRef, useState } from 'react';
import { Button, Field, FloatingSurface, Select } from '../ui';
import { Check, MoreHorizontal, Plus } from '../icons/shell-icons';
import {
  describeProviderHealth,
  getProviderPreset,
  profileTitle,
  providerKindOr,
} from '../../lib/provider-config';
import type { LlmProfile } from '../../lib/desktop-llm-config';
import { SettingsSearchContext } from './search-context';
import { ModelProfileEditor } from './ModelProfileEditor';
import type { ModelProfilesState, ProfileHealth } from './useModelProfiles';

type Confirm = (options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}) => Promise<boolean>;

// 设置搜索按这些词命中整个模型服务分组。
const SEARCH_TEXT =
  '模型服务 服务商 服务地址 API Key 密钥 获取模型 新建 编辑 删除 切换 当前模型 整章润色 润色模型 高级 配置';

function hostOf(baseUrl: string) {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

/** 设置页「模型服务」：一排配置卡（点卡片即切换）+ 新建 / 编辑表单 + 高级里的润色选择。 */
export function ModelProfilesSection({
  model,
  confirm,
}: {
  model: ModelProfilesState;
  confirm: Confirm;
}) {
  const query = useContext(SettingsSearchContext).trim().toLowerCase();
  if (query && !SEARCH_TEXT.toLowerCase().includes(query)) return null;
  const profiles = model.list?.profiles ?? [];
  const activeId = model.list?.activeProfileId ?? null;
  // 草稿改了一半又去点别的卡片 / 新建：先确认再丢。
  const leaveDraft = async () =>
    !model.draftDirty ||
    confirm({
      title: '放弃正在编辑的配置？',
      message: '刚才填的还没保存，换去编辑别的就会丢掉；已经保存的配置不受影响。',
      confirmLabel: '放弃',
      cancelLabel: '继续编辑',
      tone: 'danger',
    });
  const edit = async (profile: LlmProfile) => {
    if (await leaveDraft()) model.startEdit(profile);
  };
  const remove = async (profile: LlmProfile) => {
    const confirmed = await confirm({
      title: '删除这套模型配置？',
      message: `将删除「${profileTitle(profile)}」和它存的 Key；正在用的那套不受影响。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      tone: 'danger',
    });
    if (confirmed) await model.remove(profile);
  };
  const clearKey = async (profile: LlmProfile) => {
    const confirmed = await confirm({
      title: '移除这套的 Key？',
      message: `将删除本机为「${profileTitle(profile)}」存的 Key，服务商、地址和模型会保留；之后用这套前要重新填 Key。`,
      confirmLabel: '移除 Key',
      cancelLabel: '取消',
      tone: 'danger',
    });
    if (confirmed) await model.clearKey(profile);
  };

  return (
    <div data-testid="model-profiles">
      <p className="px-4 pt-3 text-xs leading-relaxed text-muted">
        可以存好几套模型，点卡片就切换，下一次调用就用新的那套，不用重启。打勾的是正在用的。
      </p>
      {model.loadState === 'error' && (
        <div role="alert" className="mx-4 mt-3 text-sm" data-testid="provider-config-error">
          <p className="break-words text-error">配置读取失败：{model.loadError}</p>
          <Button
            size="sm"
            className="mt-2"
            disabled={model.busy !== null}
            onClick={() => void model.reload()}
            data-testid="provider-config-retry"
          >
            重试读取
          </Button>
        </div>
      )}
      {model.loadState === 'loading' && (
        <p role="status" className="px-4 pt-3 text-xs text-muted">
          正在读取本机模型配置…
        </p>
      )}
      <div className="flex flex-wrap gap-2 px-4 py-3" data-testid="model-profile-cards">
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            active={profile.id === activeId}
            onlyOne={profiles.length <= 1}
            health={model.health[profile.id]}
            disabled={model.busy !== null}
            onActivate={() => void model.activate(profile.id)}
            onEdit={() => void edit(profile)}
            onDelete={() => void remove(profile)}
            onClearKey={() => void clearKey(profile)}
          />
        ))}
        <button
          type="button"
          onClick={() =>
            void leaveDraft().then((leave) => {
              if (leave) model.startNew();
            })
          }
          disabled={model.busy !== null}
          className="flex min-h-[64px] w-[140px] items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong text-sm text-muted transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-60"
          data-testid="model-profile-new"
        >
          <Plus size={14} strokeWidth={1.7} aria-hidden="true" />
          新建一套
        </button>
      </div>
      {profiles.length === 0 && model.loadState === 'idle' && !model.draft && (
        <p className="px-4 pb-3 text-xs text-subtle">
          还没有模型配置。点「新建一套」：选服务商、贴 Key、选模型，三步就好。
        </p>
      )}
      {model.notice && (
        <p
          role={model.notice.tone === 'error' ? 'alert' : 'status'}
          className={`px-4 pb-3 text-xs ${model.notice.tone === 'error' ? 'text-error' : 'text-success'}`}
          data-testid="model-profiles-notice"
        >
          {model.notice.text}
        </p>
      )}
      {model.draft && <ModelProfileEditor draft={model.draft} model={model} />}
      {profiles.length > 0 && <PolishChoice model={model} open={Boolean(query)} />}
    </div>
  );
}

function ProfileCard({
  profile,
  active,
  onlyOne,
  health,
  disabled,
  onActivate,
  onEdit,
  onDelete,
  onClearKey,
}: {
  profile: LlmProfile;
  active: boolean;
  onlyOne: boolean;
  health: ProfileHealth | undefined;
  disabled: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClearKey: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const title = profileTitle(profile);
  const kind = providerKindOr(profile.provider, 'openai-compatible');
  const subtitle = profile.name.trim()
    ? `${getProviderPreset(kind).label} · ${profile.model || '未选模型'}`
    : hostOf(profile.baseUrl);
  const display = health && health !== 'loading' ? describeProviderHealth(health) : null;
  const tone =
    display?.tone === 'ok'
      ? 'text-success'
      : display?.tone === 'warn'
        ? 'text-warning'
        : display?.tone === 'error'
          ? 'text-error'
          : 'text-subtle';
  const status =
    health === 'loading'
      ? { text: '测试中…', tone: 'text-subtle' }
      : display
        ? { text: display.label, tone }
        : !profile.hasApiKey && kind !== 'ollama'
          ? { text: '还没存 Key', tone: 'text-warning' }
          : null;
  const run = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };
  return (
    <div
      className={`relative w-[200px] rounded-lg border bg-background transition-colors ${
        active ? 'border-accent' : 'border-border hover:border-border-strong'
      }`}
      data-testid="model-profile-card"
      data-profile-id={profile.id}
    >
      <button
        type="button"
        onClick={active ? undefined : onActivate}
        disabled={disabled}
        aria-current={active ? 'true' : undefined}
        aria-label={`${active ? '正在用' : '切换到'}：${title}${status ? `（${status.text}）` : ''}`}
        className="flex w-full min-w-0 flex-col items-start rounded-lg py-2.5 pl-3 pr-8 text-left"
        data-testid="model-profile-select"
      >
        <span className="flex w-full min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
          {active && (
            <Check
              size={14}
              strokeWidth={2}
              className="flex-shrink-0 text-accent"
              aria-hidden="true"
            />
          )}
          <span className="truncate">{title}</span>
        </span>
        <span className="mt-0.5 w-full truncate text-xs text-muted">{subtitle}</span>
        {status && (
          <span
            className={`mt-1 w-full truncate text-2xs ${status.tone}`}
            title={status.text}
            data-testid="model-profile-status"
          >
            {status.text}
          </span>
        )}
      </button>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`「${title}」的更多操作`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled}
        onClick={() => setMenuOpen((open) => !open)}
        className="absolute right-1 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-foreground"
        data-testid="model-profile-menu"
      >
        <MoreHorizontal size={15} strokeWidth={1.7} aria-hidden="true" />
      </button>
      {menuOpen && (
        <FloatingSurface
          role="menu"
          aria-label={`「${title}」的操作`}
          triggerRef={triggerRef}
          align="end"
          onDismiss={() => setMenuOpen(false)}
          className="w-48 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown"
          data-testid="model-profile-menu-list"
        >
          <MenuRow label="编辑" onClick={run(onEdit)} />
          {profile.hasApiKey && <MenuRow label="移除 Key" onClick={run(onClearKey)} />}
          <MenuRow
            label={active ? '删除（正在用，先切到别的）' : onlyOne ? '删除（至少留一套）' : '删除'}
            disabled={active || onlyOne}
            onClick={run(onDelete)}
          />
        </FloatingSurface>
      )}
    </div>
  );
}

function MenuRow({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      disabled={disabled}
      className="flex w-full items-center rounded-sm px-2.5 py-1.5 text-left text-xs text-muted hover:bg-elevated hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function PolishChoice({ model, open }: { model: ModelProfilesState; open: boolean }) {
  const profiles = model.list?.profiles ?? [];
  return (
    <details
      className="border-t border-border px-4 py-3"
      open={open}
      data-testid="model-profiles-advanced"
    >
      <summary className="cursor-pointer rounded-sm py-1 text-xs text-muted hover:text-foreground">
        高级
      </summary>
      <Field
        layout="horizontal"
        className="mt-3"
        label="整章润色用"
        description="默认跟着上面打勾的那套走。想让润色固定用某一套（比如更会改文字的模型），在这里选；删掉那套后自动回到跟随当前模型。"
      >
        {(control) => (
          <Select
            {...control}
            value={model.list?.polishProfileId ?? ''}
            onChange={(event) => void model.setPolish(event.target.value || null)}
            disabled={model.busy !== null}
            controlSize="sm"
            className="w-[220px]"
            data-testid="model-polish-profile"
          >
            <option value="">跟随当前模型（默认）</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profileTitle(profile)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </details>
  );
}
