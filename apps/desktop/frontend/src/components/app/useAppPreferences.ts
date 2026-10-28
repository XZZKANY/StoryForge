import { useCallback, useEffect, useState } from 'react';

import { resolveThemeMode } from '../../lib/appearance';
import { applyAppearance } from '../../lib/theme';
import { loadAppSettings, saveAppSettings } from '../../lib/user-settings';
import { PROSE_MEASURE_ORDER, type ProseMeasure } from '../editor/options';
import { useSystemPrefersDark } from './useSystemPrefersDark';

function nextProseMeasure(current: ProseMeasure): ProseMeasure {
  const index = PROSE_MEASURE_ORDER.indexOf(current);
  return PROSE_MEASURE_ORDER[(index + 1) % PROSE_MEASURE_ORDER.length];
}

export function useAppPreferences() {
  const [settings, setSettings] = useState(() => loadAppSettings());
  const prefersDark = useSystemPrefersDark();
  const resolvedTheme = resolveThemeMode(settings.theme, prefersDark);

  useEffect(() => {
    saveAppSettings(settings);
  }, [settings]);

  const { theme, palette, accent, customColors, uiFont } = settings;
  useEffect(() => {
    applyAppearance({ theme, palette, accent, customColors, uiFont }, resolvedTheme);
  }, [theme, palette, accent, customColors, uiFont, resolvedTheme]);

  // 菜单里的「切换到浅色 / 深色」按眼前看到的切；跟随系统时切完就固定成那一档。
  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: resolveThemeMode(prev.theme, prefersDark) === 'dark' ? 'light' : 'dark',
    }));
  }, [prefersDark]);

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

  // 侧栏 / 对话栏宽度存成占窗口宽的比例（null = 默认比例），窗口变了三栏一起跟着变。
  // 侧栏全左栏共享一份：切视图只换内容，右边界不动。
  const setSidePanelRatio = useCallback((ratio: number | null) => {
    setSettings((prev) => ({ ...prev, sidePanelRatio: ratio }));
  }, []);
  const setAssistantPanelRatio = useCallback((ratio: number | null) => {
    setSettings((prev) => ({ ...prev, assistantPanelRatio: ratio }));
  }, []);

  return {
    settings,
    setSettings,
    resolvedTheme,
    toggleTheme,
    toggleFontMode,
    cycleProseMeasure,
    setSidePanelRatio,
    setAssistantPanelRatio,
  };
}

export type AppPreferences = ReturnType<typeof useAppPreferences>;
