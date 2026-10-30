/** 本机插件库变了（装上 / 移除）：窗口内广播，技能目录与插件选用跟着重读。 */
export const PLUGINS_CHANGED_EVENT = 'storyforge:plugins-changed';

export function emitPluginsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT));
}
