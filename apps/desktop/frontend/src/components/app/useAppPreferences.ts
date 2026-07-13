import { useCallback, useEffect, useRef, useState } from 'react';

import { saveDesktopLlmConfig } from '../../lib/desktop-llm-config';
import { applyProviderPreset, getProviderPreset } from '../../lib/provider-config';
import { applyTheme } from '../../lib/theme';
import { loadAppSettings, saveAppSettings, type ProviderKind } from '../../lib/user-settings';
import type { AppDialogApi } from './AppDialog';

export function useAppPreferences(appDialog: AppDialogApi) {
  const [settings, setSettings] = useState(() => loadAppSettings());
  const quickModelRequestRef = useRef(0);
  const quickProviderRequestRef = useRef(0);

  useEffect(() => {
    saveAppSettings(settings);
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  const handleQuickModelChange = useCallback(
    async (model: string) => {
      const trimmed = model.trim();
      const previousProvider = settings.provider;
      const requestId = ++quickModelRequestRef.current;
      setSettings((prev) => ({ ...prev, provider: { ...prev.provider, model: trimmed } }));
      try {
        // 后端实时读取 llm-provider.json，写入即生效，无需重启。
        await saveDesktopLlmConfig({
          provider: settings.provider.kind,
          baseUrl: settings.provider.baseUrl,
          model: trimmed,
        });
      } catch (error) {
        if (quickModelRequestRef.current !== requestId) return;
        setSettings((current) =>
          current.provider.kind === previousProvider.kind &&
          current.provider.baseUrl === previousProvider.baseUrl &&
          current.provider.model === trimmed
            ? { ...current, provider: previousProvider }
            : current,
        );
        await appDialog.alert({
          title: '模型切换失败',
          message: `设置未保存，已恢复原模型。\n${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [appDialog, settings.provider],
  );

  const handleQuickProviderChange = useCallback(
    async (kind: ProviderKind) => {
      const previousProvider = settings.provider;
      const nextProvider = applyProviderPreset(settings.provider, kind, { preserveModel: true });
      const requestId = ++quickProviderRequestRef.current;
      setSettings((prev) => ({ ...prev, provider: nextProvider }));
      try {
        await saveDesktopLlmConfig({
          provider: nextProvider.kind,
          baseUrl: nextProvider.baseUrl,
          model: nextProvider.model,
        });
      } catch (error) {
        if (quickProviderRequestRef.current !== requestId) return;
        setSettings((current) =>
          current.provider.kind === nextProvider.kind &&
          current.provider.baseUrl === nextProvider.baseUrl &&
          current.provider.model === nextProvider.model
            ? { ...current, provider: previousProvider }
            : current,
        );
        await appDialog.alert({
          title: '服务商切换失败',
          message: `设置未保存，已恢复原服务商。\n${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [appDialog, settings.provider],
  );

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }));
  }, []);

  // Q9 双轨字体：格子（CJK 2:1 等宽，中英对齐）↔ 散文（比例字体，长文舒适）。
  const toggleFontMode = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      editorFontMode: prev.editorFontMode === 'prose' ? 'grid' : 'prose',
    }));
  }, []);

  const modelLabel =
    settings.provider.model.trim() || getProviderPreset(settings.provider.kind).label;

  return {
    settings,
    setSettings,
    handleQuickModelChange,
    handleQuickProviderChange,
    toggleTheme,
    toggleFontMode,
    modelLabel,
  };
}

export type AppPreferences = ReturnType<typeof useAppPreferences>;
