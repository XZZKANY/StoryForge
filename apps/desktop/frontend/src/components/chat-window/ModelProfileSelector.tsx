import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activateLlmProfile,
  listLlmProfiles,
  subscribeLlmProfiles,
  type LlmProfiles,
} from '../../lib/desktop-llm-config';
import { profileTitle } from '../../lib/provider-config';
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

/** 切的是全局「当前那套」，等同在设置里点配置卡；下一次调用生效。 */
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
  const options: ComposerMenuOption<string>[] = profiles.length
    ? profiles.map((profile) => ({
        value: profile.id,
        label: profileTitle(profile),
        hint: profile.model.trim() || '未选模型',
      }))
    : onOpenSettings
      ? [{ value: OPEN_SETTINGS, label: '去设置里添加' }]
      : [];

  const select = async (id: string): Promise<boolean> => {
    if (id === OPEN_SETTINGS) {
      onOpenSettings?.();
      return true;
    }
    if (id === list?.activeProfileId) return true;
    setError('');
    try {
      const next = await activateLlmProfile(id);
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
  ) : profiles.length || onOpenSettings ? null : (
    '还没有模型配置，在设置里添加后可在这里切换。'
  );

  return (
    <ComposerMenuSelect
      options={options}
      selected={active?.id ?? null}
      onSelect={select}
      triggerText={active ? profileTitle(active) : '未配置模型'}
      triggerTitle={
        active ? `${profileTitle(active)} · ${active.model.trim() || '未选模型'}` : '未配置模型'
      }
      ariaLabel="当前模型配置"
      menuLabel="选择模型配置"
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
