/**
 * 会话「从列表移除」：只把会话从本项目的会话列表里藏起来，记录仍在本机引擎库里（运行证据不删）。
 * 跟着项目存本机 localStorage，与按项目的 Agent 档位同一种做法。
 */
const keyFor = (projectPath: string) => `storyforge:hidden-sessions:${projectPath}`;

export function readHiddenSessions(projectPath: string | null | undefined): Set<number> {
  if (!projectPath) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(projectPath)) ?? '[]') as unknown;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [],
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenSessions(projectPath: string, ids: ReadonlySet<number>): void {
  try {
    localStorage.setItem(keyFor(projectPath), JSON.stringify([...ids]));
  } catch {
    // 存不进去只影响下次启动是否还藏着，不影响这一次。
  }
}
