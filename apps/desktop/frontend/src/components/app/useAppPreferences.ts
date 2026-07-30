import { useCallback, useEffect, useState } from 'react';

import { getProviderPreset } from '../../lib/provider-config';
import { applyTheme } from '../../lib/theme';
import { loadAppSettings, saveAppSettings } from '../../lib/user-settings';
import { PROSE_MEASURE_ORDER, type ProseMeasure } from '../editor/options';

function nextProseMeasure(current: ProseMeasure): ProseMeasure {
  const index = PROSE_MEASURE_ORDER.indexOf(current);
  return PROSE_MEASURE_ORDER[(index + 1) % PROSE_MEASURE_ORDER.length];
}

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

  // Q9 双轨字体：格子（CJK 2:1 等宽，中英对齐）↔ 书稿（衬线比例字体，长文像书）。
  const toggleFontMode = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      editorFontMode: prev.editorFontMode === 'prose' ? 'grid' : 'prose',
    }));
  }, []);

  // 行宽要边写边试才知道合不合眼，别每次都开设置弹窗。
  const cycleProseMeasure = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      editorProseMeasure: nextProseMeasure(prev.editorProseMeasure),
    }));
  }, []);

  // 侧面板宽度按视图各记一份：作品要宽、资源管理器要窄，一个全局宽度两边都别扭。
  const setSidePanelWidth = useCallback((view: string, width: number) => {
    setSettings((prev) => ({
      ...prev,
      sidePanelWidths: { ...prev.sidePanelWidths, [view]: width },
    }));
  }, []);

  const modelLabel =
    settings.provider.model.trim() || getProviderPreset(settings.provider.kind).label;

  return {
    settings,
    setSettings,
    toggleTheme,
    toggleFontMode,
    cycleProseMeasure,
    setSidePanelWidth,
    modelLabel,
  };
}

export type AppPreferences = ReturnType<typeof useAppPreferences>;
