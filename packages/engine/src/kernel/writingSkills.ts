import { compareChapterPaths } from '@storyforge/project-core';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { FsToolError, readBoundedText, resolveProjectRoot } from './fsTools';
import { scanProjectFiles, ProjectTreeError } from './projectTree';
import { pythonStrip } from './pythonText';
import { redactSensitiveText, type SecretContext } from './redaction';
import { sha256Hex } from './sha256';

/** 写法 skill 放在这个目录：一个写法一份 Markdown，开头写清名字和什么时候用。 */
export const WRITING_SKILL_DIR = '写法';
/** 章纲里列出的 skill 上限；再多就只列前面这些（按路径序）。 */
export const WRITING_SKILL_INDEX_MAX = 20;
/** 一章最多带几份 skill 进起草：多了提示词太长、规矩互相打架。 */
export const WRITING_SKILL_PICK_MAX = 3;
/** 单份 skill 带进起草的上限。 */
export const WRITING_SKILL_MAX_CHARS = 1500;
const WHEN_MAX_CHARS = 80;

export type WritingSkill = {
  readonly path: string;
  readonly name: string;
  readonly when: string;
  readonly body: string;
  readonly sha256: string;
};

const optional = (error: unknown) =>
  error instanceof ProjectReadError ||
  error instanceof ProjectTreeError ||
  error instanceof FsToolError;

const cut = (text: string, limit: number) => {
  const points = Array.from(text);
  return points.length > limit ? `${points.slice(0, limit).join('')}……` : text;
};

/** 开头的 `---` 块里认「名字 / name」「什么时候用 / when / description」，冒号全半角都行。 */
export function parseWritingSkill(path: string, content: string): Omit<WritingSkill, 'sha256'> {
  const text = content.replace(/\r\n?/g, '\n');
  const fallbackName = path
    .split('/')
    .slice(-1)[0]
    .replace(/\.(md|markdown)$/i, '');
  const header = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const fields: { [key: string]: string } = {};
  for (const line of header ? header[1].split('\n') : []) {
    const match = /^\s*([^:：]+)[:：]\s*(.*)$/.exec(line);
    if (match) fields[pythonStrip(match[1]).toLowerCase()] = pythonStrip(match[2]);
  }
  const body = pythonStrip(header ? text.slice(header[0].length) : text);
  const firstLine = body.split('\n').find((line) => pythonStrip(line)) ?? '';
  const name = fields['名字'] || fields.name || fallbackName;
  const when =
    fields['什么时候用'] ||
    fields.when ||
    fields.description ||
    pythonStrip(firstLine.replace(/^#+\s*/, ''));
  return { path, name: cut(name, 40), when: cut(when, WHEN_MAX_CHARS), body };
}

/**
 * 作品根下 `dir`（默认 `写法/`）里的全部 skill（按路径序，最多 {@link WRITING_SKILL_INDEX_MAX} 份）；
 * 读不到就当没有。
 */
export async function loadWritingSkills(
  reader: ProjectReader,
  root: string,
  secrets: SecretContext,
  dir: string = WRITING_SKILL_DIR,
): Promise<WritingSkill[]> {
  try {
    await resolveProjectRoot(reader, root);
    // 目录也过同一个判定，只能按目录名筛，扩展名在结果上再筛。
    const paths = (
      await scanProjectFiles(reader, root, {
        visible: (path) => {
          const parts = path.split('/');
          return parts[0] === dir && !parts.some((part) => part.startsWith('.'));
        },
      })
    )
      .filter((path) => /\.(md|markdown)$/i.test(path))
      .sort(compareChapterPaths);
    const skills: WritingSkill[] = [];
    for (const path of paths) {
      if (skills.length >= WRITING_SKILL_INDEX_MAX) break;
      let content: string;
      try {
        content = (await readBoundedText(reader, root, path)).content;
      } catch (error) {
        if (optional(error)) continue;
        throw error;
      }
      const redacted = redactSensitiveText(content, secrets);
      const skill = parseWritingSkill(path, redacted);
      if (!skill.body) continue;
      skills.push({ ...skill, sha256: sha256Hex(redacted) });
    }
    return skills;
  } catch (error) {
    if (optional(error)) return [];
    throw error;
  }
}

/** 作品自己的写法没有 plugin（或为 null）；插件写法带插件名。 */
type MaybePluginStyle = WritingSkill & { readonly plugin?: { readonly id: string } | null };

const styleLabel = (skill: MaybePluginStyle) =>
  skill.plugin ? `${skill.name}（插件「${skill.plugin.id}」）` : skill.name;

/** 章纲提示词里的 skill 目录：只给名字和什么时候用；插件写法在名字后标插件名。 */
export function writingSkillIndex(skills: readonly MaybePluginStyle[]): string {
  return skills.map((skill) => `- ${styleLabel(skill)}：${skill.when}`).join('\n');
}

/**
 * 模型挑的名字：只认目录里有的，去重，最多 {@link WRITING_SKILL_PICK_MAX} 个。
 * 插件写法在目录里带着插件名，模型照抄「名字（插件「id」）」也认成那个名字。
 */
export function pickWritingSkills(raw: unknown, skills: readonly MaybePluginStyle[]): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(skills.map((skill) => skill.name));
  const labels = new Map(
    skills.filter((skill) => skill.plugin).map((skill) => [styleLabel(skill), skill.name]),
  );
  const picked: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const stripped = pythonStrip(item);
    const name = known.has(stripped) ? stripped : (labels.get(stripped) ?? stripped);
    if (!known.has(name) || picked.includes(name)) continue;
    picked.push(name);
    if (picked.length >= WRITING_SKILL_PICK_MAX) break;
  }
  return picked;
}

/**
 * 起草指令后面附的写法要点：只带章纲挑中的几份。挑中的有插件写法时开头说「作者选用的」——
 * 插件写法是作者启用的插件带来的，不是作者审过的。
 */
export function writingSkillsBlock(
  skills: readonly MaybePluginStyle[],
  names: readonly string[],
): string | null {
  const chosen = names
    .map((name) => skills.find((skill) => skill.name === name))
    .filter((skill): skill is MaybePluginStyle => skill !== undefined);
  if (!chosen.length) return null;
  const vetting = chosen.some((skill) => skill.plugin) ? '作者选用的' : '作者审过的';
  return (
    `写法要点（${vetting}写法 skill，这一章照着写；例句只示意，不要照抄）：\n` +
    chosen
      .map((skill) => `### ${styleLabel(skill)}\n${cut(skill.body, WRITING_SKILL_MAX_CHARS)}`)
      .join('\n\n')
  );
}
