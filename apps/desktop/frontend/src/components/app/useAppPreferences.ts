import { useCallback, useEffect, useState } from 'react';

import { getProviderPreset } from '../../lib/provider-config';
import { applyTheme } from '../../lib/theme';
import { loadAppSettings, saveAppSettings } from '../../lib/user-settings';

export function useAppPreferences() {
  const [settings, setSettings] = useState(() => loadAppSettings());

  useEffect(() => {
    saveAppSettings(settings);
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

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
    toggleTheme,
    toggleFontMode,
    modelLabel,
  };
}

export type AppPreferences = ReturnType<typeof useAppPreferences>;
