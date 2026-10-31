import { useId, useState, type KeyboardEvent } from 'react';
import { Button, Field, Input, PlainButton } from '../ui';
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
    ? profileTitle({
        name: '',
        provider: draft.kind,
        model: draft.models.includes(draft.model) ? draft.model : (draft.models[0] ?? ''),
      })
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
              <PlainButton
                className="ml-2 rounded-sm text-accent hover:underline"
                onClick={() => model.updateDraft({ editAddress: true })}
                disabled={saving}
                data-testid="model-profile-edit-address"
              >
                改地址
              </PlainButton>
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
            <PlainButton
              key={option.value}
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
            </PlainButton>
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
  const [query, setQuery] = useState('');
  const fetched = model.fetched;
  const picked = draft.models;
  const typed = query.trim();
  const toggle = (name: string) =>
    model.updateDraft({
      models: picked.includes(name) ? picked.filter((item) => item !== name) : [...picked, name],
    });
  const add = () => {
    if (!typed || picked.includes(typed)) return;
    model.updateDraft({ models: [...picked, typed] });
    setQuery('');
  };
  const needle = typed.toLowerCase();
  const listed =
    fetched.state === 'ok'
      ? fetched.models.filter((name) => name.toLowerCase().includes(needle))
      : [];
  const status =
    fetched.state === 'loading'
      ? '正在获取…'
      : fetched.state === 'error'
        ? fetched.message
        : fetched.state === 'ok'
          ? fetched.models.length
            ? `${fetched.models.length} 个模型${fetched.partial ? '（只列出了一部分）' : ''}，点一下勾上，再点取消`
            : '这个服务没有列出模型，直接填模型名加进来就行'
          : null;
  return (
    <div className="space-y-2">
      <Field
        label="模型"
        description="点「获取模型」按上面的地址和 Key 拉一次列表，勾上要在对话里切换的那几个，不用先保存；列表里没有的，填上模型名点「加入」。"
      >
        {(control) => (
          <div className="flex items-center gap-2">
            <Input
              {...control}
              value={query}
              placeholder="搜索或填模型名，例如 kimi-k2"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
                event.preventDefault();
                add();
              }}
              disabled={disabled}
              controlSize="sm"
              className="min-w-0 flex-1"
              data-testid="model-profile-model"
            />
            <Button
              onClick={add}
              disabled={disabled || !typed || picked.includes(typed)}
              className="flex-shrink-0"
              data-testid="model-profile-add-model"
            >
              加入
            </Button>
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
      <div className="flex flex-wrap items-center gap-1.5" data-testid="model-profile-picked">
        <span className="text-xs text-subtle">
          {picked.length ? `已勾 ${picked.length} 个：` : '还没勾模型。'}
        </span>
        {picked.map((name) => (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-accent bg-accent py-0.5 pl-2 pr-1 text-xs text-accent-foreground"
            data-testid="model-profile-picked-model"
          >
            <span className="min-w-0 truncate" title={name}>
              {name}
            </span>
            <PlainButton
              onClick={() => toggle(name)}
              disabled={disabled}
              aria-label={`去掉 ${name}`}
              className="grid h-4 w-4 flex-shrink-0 place-items-center rounded-sm opacity-80 hover:opacity-100"
            >
              ×
            </PlainButton>
          </span>
        ))}
      </div>
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
          {listed.length === 0 && (
            <span className="text-xs text-subtle">没有名字里含「{typed}」的模型</span>
          )}
          {listed.map((name) => {
            const on = picked.includes(name);
            return (
              <PlainButton
                key={name}
                onClick={() => toggle(name)}
                disabled={disabled}
                aria-pressed={on}
                className={`max-w-full truncate rounded-md border px-2 py-1 text-xs transition-colors ${
                  on
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border text-muted hover:bg-elevated hover:text-foreground'
                }`}
                title={name}
              >
                {name}
              </PlainButton>
            );
          })}
        </div>
      )}
    </div>
  );
}
