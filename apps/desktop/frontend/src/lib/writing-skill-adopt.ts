import { resolveProjectRelativePath } from './project-context';
import { TauriFileSystem } from './tauri-fs';

/** 拆书产出的写法 skill（引擎每次拆书整份覆盖）；作者点「放进 写法/」才落进作品。 */
export const BREAKDOWN_SKILLS_PATH = '.storyforge/analysis/writing-skills.json';
export const WRITING_SKILL_DIR = '写法';

export type AdoptableSkill = { name: string; relativePath: string; content: string };
export type AdoptResult = { created: AdoptableSkill[]; skipped: AdoptableSkill[] };

/** 形状不对的条目丢掉；文件名只认一层、`.md` 结尾、不以点开头，不能借它写到别处。 */
export function adoptableSkills(raw: string): AdoptableSkill[] {
  const parsed: unknown = JSON.parse(raw);
  const list =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { skills?: unknown }).skills)
      ? ((parsed as { skills: unknown[] }).skills as unknown[])
      : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { name, file_name: fileName, content } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof content !== 'string' || typeof fileName !== 'string')
      return [];
    if (!/^[^\\/]+\.md$/u.test(fileName) || fileName.startsWith('.')) return [];
    return [{ name, relativePath: `${WRITING_SKILL_DIR}/${fileName}`, content }];
  });
}

/** 一份份新建；同名已有就跳过，不盖掉作者改过的写法。 */
export async function adoptWritingSkills(
  projectPath: string,
  skills: readonly AdoptableSkill[],
): Promise<AdoptResult> {
  const directory = resolveProjectRelativePath(projectPath, WRITING_SKILL_DIR);
  if (!directory) throw new Error('写法目录不在作品里。');
  await TauriFileSystem.createDir(projectPath, directory);
  const result: AdoptResult = { created: [], skipped: [] };
  for (const skill of skills) {
    const target = resolveProjectRelativePath(projectPath, skill.relativePath);
    if (!target || (await TauriFileSystem.projectPathExists(projectPath, target))) {
      result.skipped.push(skill);
      continue;
    }
    await TauriFileSystem.writeFileIfUnchanged(projectPath, target, skill.content, {
      kind: 'missing',
    });
    result.created.push(skill);
  }
  return result;
}
