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

/** 写不进本机存储（配额满、不可写）返回 false：列表是按存储重读的，没写进去就等于没藏。 */
export function writeHiddenSessions(projectPath: string, ids: ReadonlySet<number>): boolean {
  try {
    localStorage.setItem(keyFor(projectPath), JSON.stringify([...ids]));
    return true;
  } catch {
    return false;
  }
}
