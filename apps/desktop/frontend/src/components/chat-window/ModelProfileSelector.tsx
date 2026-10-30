import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activateLlmProfile,
  listLlmProfiles,
  subscribeLlmProfiles,
  type LlmProfiles,
} from '../../lib/desktop-llm-config';
import { providerTitle } from '../../lib/provider-config';
import { ComposerMenuSelect, type ComposerMenuOption } from './ComposerMenuSelect';

const OPEN_SETTINGS = '__open-settings__';

const reason = (error: unknown) =>
  error instanceof Error && error.message ? error.message : '本机模型配置操作失败';

interface ModelProfileSelectorProps {
  disabled?: boolean;
  busy?: boolean;
  fitToComposer?: boolean;
  /** 没有任何配置时菜单里的「去设置里添加」；不给就只显示提示文字。 */
  onOpenSettings?: () => void;
}

type Choice = { id: string; model: string };
const choiceKey = ({ id, model }: Choice) => `${id}/${model}`;

/** 按服务商分组列出各套勾过的模型；选一个 = 切到那套并换成这个模型（全局），下一次调用生效。 */
export function ModelProfileSelector({
  disabled = false,
  busy = false,
  fitToComposer = false,
  onOpenSettings,
}: ModelProfileSelectorProps) {
  const [list, setList] = useState<LlmProfiles | null>(null);
  const [error, setError] = useState('');
  const aliveRef = useRef(true);
  const readRef = useRef(0);

  const refresh = useCallback(() => {
    const request = ++readRef.current;
    void listLlmProfiles().then(
      (next) => {
        if (!aliveRef.current || readRef.current !== request) return;
        setList(next);
      },
      (failure: unknown) => {
        if (!aliveRef.current || readRef.current !== request) return;
        setError(`读不到模型配置：${reason(failure)}`);
      },
    );
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    const unsubscribe = subscribeLlmProfiles((next) => {
      readRef.current += 1;
      setList(next);
    });
    return () => {
      aliveRef.current = false;
      unsubscribe();
    };
  }, [refresh]);

  const profiles = list?.profiles ?? [];
  const active = profiles.find((profile) => profile.id === list?.activeProfileId) ?? null;
  const choices = new Map<string, Choice>();
  const options: ComposerMenuOption<string>[] = [];
  for (const profile of profiles) {
    for (const model of profile.models) {
      const choice = { id: profile.id, model };
      choices.set(choiceKey(choice), choice);
      options.push({ value: choiceKey(choice), label: model, group: providerTitle(profile) });
    }
  }
  if (onOpenSettings)
    options.push({ value: OPEN_SETTINGS, label: options.length ? '管理模型…' : '去设置里添加' });
  const current = active?.model.trim() ? choiceKey({ id: active.id, model: active.model }) : null;

  const select = async (value: string): Promise<boolean> => {
    if (value === OPEN_SETTINGS) {
      onOpenSettings?.();
      return true;
    }
    const choice = choices.get(value);
    if (!choice || value === current) return true;
    setError('');
    try {
      const next = await activateLlmProfile(choice.id, choice.model);
      if (aliveRef.current && next) setList(next);
      return true;
    } catch (failure) {
      if (aliveRef.current) setError(`切换失败：${reason(failure)}`);
      return false;
    }
  };

  const footer = error ? (
    <span role="alert" className="text-error">
      {error}
    </span>
  ) : choices.size || onOpenSettings ? null : (
    '还没有模型配置，在设置里添加后可在这里切换。'
  );

  return (
    <ComposerMenuSelect
      options={options}
      selected={current}
      onSelect={select}
      triggerText={active ? active.model.trim() || '未选模型' : '未配置模型'}
      triggerTitle={
        active ? `${providerTitle(active)} · ${active.model.trim() || '未选模型'}` : '未配置模型'
      }
      ariaLabel="当前模型"
      menuLabel="选择模型"
      testId="model-profile-selector"
      disabled={disabled}
      busy={busy}
      busyTitle="本轮正在用启动时的模型执行"
      fitToComposer={fitToComposer}
      footer={footer}
      onOpen={() => {
        setError('');
        refresh();
      }}
      triggerClassName="max-w-[10rem]"
    />
  );
}
