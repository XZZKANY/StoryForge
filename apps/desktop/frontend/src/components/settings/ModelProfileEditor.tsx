import { useId, type KeyboardEvent } from 'react';
import { Button, Field, Input } from '../ui';
import {
  getProviderPreset,
  PROVIDER_OPTIONS,
  profileTitle,
  type ProviderKind,
} from '../../lib/provider-config';
import type { ModelProfilesState, ProfileDraft } from './useModelProfiles';

type Props = {
  draft: ProfileDraft;
  model: ModelProfilesState;
};

/** 新建 / 编辑一套：选服务商 → 贴 Key → 获取模型点选 → 保存。 */
export function ModelProfileEditor({ draft, model }: Props) {
  const headingId = useId();
  const saving = model.busy === 'save';
  const preset = draft.kind ? getProviderPreset(draft.kind) : null;
  const autoTitle = draft.kind
    ? profileTitle({ name: '', provider: draft.kind, model: draft.model })
    : '';
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 border-t border-border px-4 py-4"
      data-testid="model-profile-editor"
    >
      <h3 id={headingId} className="text-sm font-medium text-foreground">
        {draft.id ? `编辑「${draft.name.trim() || autoTitle}」` : '新建一套模型配置'}
      </h3>
      <ProviderChips
        value={draft.kind}
        disabled={saving}
        onChange={(kind) => model.updateDraft({ kind })}
      />
      {draft.kind && preset && (
        <>
          {preset.baseUrl && !draft.editAddress ? (
            <p className="text-xs text-muted" data-testid="model-profile-address">
              地址：<span className="font-mono">{draft.baseUrl}</span>
              <button
                type="button"
                className="ml-2 rounded-sm text-accent hover:underline"
                onClick={() => model.updateDraft({ editAddress: true })}
                disabled={saving}
                data-testid="model-profile-edit-address"
              >
                改地址
              </button>
            </p>
          ) : (
            <Field
              label="服务地址"
              description="填服务商或中转给的接口地址，兼容服务通常以 /v1 结尾。"
            >
              {(control) => (
                <Input
                  {...control}
                  value={draft.baseUrl}
                  placeholder="例如 https://你的中转地址/v1"
                  onChange={(event) => model.updateDraft({ baseUrl: event.target.value })}
                  disabled={saving}
                  controlSize="sm"
                  data-testid="model-profile-base-url"
                />
              )}
            </Field>
          )}
          <Field
            label="API Key"
            description={
              draft.hasStoredKey
                ? '这套已经存了 Key，留空就沿用；贴新的会替换掉。'
                : '只存在本机、加密保存，保存后界面不再显示。'
            }
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                value={draft.apiKey}
                placeholder={
                  draft.hasStoredKey
                    ? '已存好，留空就沿用'
                    : draft.kind === 'ollama'
                      ? '本地 Ollama 一般不用填'
                      : '粘贴服务商给的 Key'
                }
                onChange={(event) => model.updateDraft({ apiKey: event.target.value })}
                disabled={saving}
                controlSize="sm"
                data-testid="model-profile-api-key"
              />
            )}
          </Field>
          <ModelPicker draft={draft} model={model} disabled={saving} />
          <Field label="名称（选填）" description="卡片上显示的名字，不填就用「服务商 · 模型」。">
            {(control) => (
              <Input
                {...control}
                value={draft.name}
                placeholder={autoTitle}
                onChange={(event) => model.updateDraft({ name: event.target.value })}
                disabled={saving}
                controlSize="sm"
                data-testid="model-profile-name"
              />
            )}
          </Field>
        </>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void model.saveDraft()}
          loading={saving}
          loadingLabel="保存中"
          disabled={model.busy !== null && !saving}
          data-testid="model-profile-save"
        >
          保存
        </Button>
        <Button
          variant="ghost"
          onClick={model.cancelEdit}
          disabled={saving}
          data-testid="model-profile-cancel"
        >
          取消
        </Button>
        {model.saveError && (
          <span
            role="alert"
            className="min-w-0 break-words text-xs text-error"
            data-testid="model-profile-save-error"
          >
            {model.saveError}
          </span>
        )}
      </div>
    </section>
  );
}

function ProviderChips({
  value,
  disabled,
  onChange,
}: {
  value: ProviderKind | null;
  disabled: boolean;
  onChange: (kind: ProviderKind) => void;
}) {
  const labelId = useId();
  const kinds = PROVIDER_OPTIONS.map((option) => option.value);
  const focusIndex = value ? kinds.indexOf(value) : 0;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const from = value ? kinds.indexOf(value) : -1;
    const next = kinds[(from + (forward ? 1 : -1) + kinds.length) % kinds.length];
    onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  };
  return (
    <div>
      <div id={labelId} className="mb-2 text-sm font-medium text-foreground">
        服务商
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1.5"
        onKeyDown={onKeyDown}
      >
        {PROVIDER_OPTIONS.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === focusIndex ? 0 : -1}
              disabled={disabled}
              data-value={option.value}
              data-testid={`model-profile-kind-${option.value}`}
              onClick={() => onChange(option.value)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                selected
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-border text-muted hover:bg-elevated hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelPicker({
  draft,
  model,
  disabled,
}: {
  draft: ProfileDraft;
  model: ModelProfilesState;
  disabled: boolean;
}) {
  const fetched = model.fetched;
  const status =
    fetched.state === 'loading'
      ? '正在获取…'
      : fetched.state === 'error'
        ? fetched.message
        : fetched.state === 'ok'
          ? fetched.models.length
            ? `${fetched.models.length} 个模型${fetched.partial ? '（只列出了一部分）' : ''}，点一下填入`
            : '这个服务没有列出模型，直接填模型名就行'
          : null;
  return (
    <div className="space-y-2">
      <Field
        label="模型"
        description="点「获取模型」按上面的地址和 Key 拉一次列表再点选，不用先保存；也可以直接填模型名。"
      >
        {(control) => (
          <div className="flex items-center gap-2">
            <Input
              {...control}
              value={draft.model}
              placeholder="例如 kimi-k2、claude-sonnet-4-5"
              onChange={(event) => model.updateDraft({ model: event.target.value })}
              disabled={disabled}
              controlSize="sm"
              className="min-w-0 flex-1"
              data-testid="model-profile-model"
            />
            <Button
              onClick={() => void model.fetchModels()}
              loading={fetched.state === 'loading'}
              loadingLabel="正在获取模型"
              disabled={disabled || !draft.baseUrl.trim()}
              className="flex-shrink-0"
              data-testid="model-profile-fetch"
            >
              获取模型
            </Button>
          </div>
        )}
      </Field>
      {status && (
        <p
          role={fetched.state === 'error' ? 'alert' : 'status'}
          className={`break-words text-xs ${fetched.state === 'error' ? 'text-error' : 'text-subtle'}`}
          data-testid="model-profile-fetch-status"
        >
          {status}
        </p>
      )}
      {fetched.state === 'ok' && fetched.models.length > 0 && (
        <div
          className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto"
          data-testid="model-profile-model-options"
        >
          {fetched.models.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => model.updateDraft({ model: name })}
              disabled={disabled}
              className={`max-w-full truncate rounded-md border px-2 py-1 text-xs transition-colors ${
                name === draft.model
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-border text-muted hover:bg-elevated hover:text-foreground'
              }`}
              title={name}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
