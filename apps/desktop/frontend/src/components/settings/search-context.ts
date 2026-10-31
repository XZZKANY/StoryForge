import { createContext, useContext } from 'react';

/** 设置页搜索词：每一行据此决定是否隐藏自己；整张卡片空了由 index.css 的 :empty 规则收起。 */
export const SettingsSearchContext = createContext('');

/** 当前搜索词（去掉首尾空白、转小写）；没在搜是空串。 */
export function useSettingsQuery(): string {
  return useContext(SettingsSearchContext).trim().toLowerCase();
}

export function settingsTextMatches(query: string, text: string): boolean {
  return !query || text.toLowerCase().includes(query);
}

export function useSettingsRowVisible(title: string, description: string): boolean {
  return settingsTextMatches(useSettingsQuery(), `${title} ${description}`);
}
