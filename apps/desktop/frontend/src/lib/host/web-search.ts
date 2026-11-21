import { invoke } from '@tauri-apps/api/core';

type WebSearchCommand =
  | 'web_search_get_config'
  | 'web_search_save_config'
  | 'web_search_execute'
  | 'web_read_execute';

/** 所有搜索配置与出网操作由 Rust 宿主执行，界面不直接访问服务端。 */
export const invokeWebSearch = (
  command: WebSearchCommand,
  args?: Record<string, unknown>,
): Promise<unknown> => invoke(command, args);
