import { createContext, useContext } from 'react';

/** 设置页搜索词：每一行据此决定是否隐藏自己；整张卡片空了由 index.css 的 :empty 规则收起。 */
export const SettingsSearchContext = createContext('');

export function useSettingsRowVisible(title: string, description: string): boolean {
  const query = useContext(SettingsSearchContext).trim().toLowerCase();
  return !query || `${title} ${description}`.toLowerCase().includes(query);
}
