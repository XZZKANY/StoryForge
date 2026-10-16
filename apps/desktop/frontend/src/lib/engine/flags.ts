/**
 * 引擎库打开时把旧版（Python）的库只读导进来一次（P4-3；作者拍板只在切到新引擎时做一次，导完不再读旧库）。
 * 发行版总是打开；开发档要显式把 `engine.legacyImport` 设为 `on`。
 */
export function legacyImportOnOpen(): boolean {
  if (!import.meta.env.DEV) return true;
  try {
    return localStorage.getItem('engine.legacyImport') === 'on';
  } catch {
    return false;
  }
}
