/**
 * App 壳层共享的纯函数、常量与类型。
 * 从 App.tsx 抽出，供 App 及其子组件单向引用。
 */

export const RECENT_PROJECTS_KEY = 'recent-projects';
export const PROJECT_ASSISTANT_SESSIONS_KEY = 'project-assistant-sessions';

export function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function normalizeMarkdownFileName(input: string): string {
  const raw = input.trim();
  if (!raw || /^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) return '';
  const trimmed = raw.replace(/^[/\\]+/, '');
  if (!trimmed) return '';
  const withExtension = /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  const segments = withExtension.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return withExtension;
}

export function loadProjectAssistantSessions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PROJECT_ASSISTANT_SESSIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'number' && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function saveProjectAssistantSessions(sessions: Record<string, number>) {
  localStorage.setItem(PROJECT_ASSISTANT_SESSIONS_KEY, JSON.stringify(sessions));
}
