import { isUntouchedProjectGuide } from '@storyforge/project-core';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { FsToolError } from './fsTools';
import { iterManuscriptFiles } from './previousChapter';
import { projectKnowledgeCandidates, projectKnowledgeSourceType } from './projectKnowledge';
import { readProjectContextFile, suffixOf } from './projectKnowledgeFiles';
import { ProjectTreeError } from './projectTree';
import { pythonStrip } from './pythonText';

export type SetupKind = 'outline' | 'character' | 'setting';
export const SETUP_KINDS: readonly SetupKind[] = ['outline', 'character', 'setting'];
const LABELS: Record<SetupKind, string> = {
  outline: '总纲',
  character: '人物',
  setting: '世界规则',
};
const SUGGESTED_PATHS: Record<SetupKind, string> = {
  outline: '大纲/总纲.md',
  character: '人物/主要人物.md',
  setting: '设定/世界规则.md',
};
const TEXT_SUFFIXES = new Set(['.md', '.markdown', '.txt']);
/** 作者明说先不立项；这句说法由立项提醒教给作者。 */
export const SKIP_SETUP_PATTERN = /跳过立项|不用立项|不要立项|先不立项/;

const optional = (error: unknown) =>
  error instanceof ProjectReadError ||
  error instanceof ProjectTreeError ||
  error instanceof FsToolError;

/** 三类立项文件里还没有一份有内容的（按 SETUP_KINDS 的顺序）；目录说明和空文件不算。 */
async function missingSetupKinds(reader: ProjectReader, root: string): Promise<SetupKind[]> {
  const present = new Set<SetupKind>();
  for (const item of await projectKnowledgeCandidates(reader, root)) {
    const kind = item.source_type as SetupKind;
    if (!SETUP_KINDS.includes(kind) || present.has(kind)) continue;
    if (!TEXT_SUFFIXES.has(suffixOf(item.path))) continue;
    let content: string;
    try {
      content = (await readProjectContextFile(reader, root, item.path)).content;
    } catch (error) {
      if (optional(error)) continue;
      throw error;
    }
    if (!pythonStrip(content) || isUntouchedProjectGuide(item.path, content)) continue;
    present.add(kind);
  }
  return SETUP_KINDS.filter((kind) => !present.has(kind));
}

/**
 * 开写第一章前还缺的立项文件：一章正文都没有、又缺总纲 / 人物 / 世界规则时，按这个顺序返回缺的几类；
 * 否则 null。新建作品自带的目录说明和空文件不算。读不出来时不拦作者（返回 null）。
 */
export async function missingSetupBeforeFirstChapter(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<SetupKind[] | null> {
  try {
    if ((await iterManuscriptFiles(reader, root, platform)).length) return null;
    const missing = await missingSetupKinds(reader, root);
    return missing.length ? missing : null;
  } catch (error) {
    if (optional(error)) return null;
    throw error;
  }
}

export type ProjectSetupFacts = {
  /** 手稿里有没有任何一章（与开写前立项检查同一个判断）。 */
  hasManuscript: boolean;
  /** 不论有没有正文都照实给；立项检查只在还没有正文时才算数。 */
  missing: SetupKind[];
};

/** 有没有正文、立项文件缺哪几类：给界面的只读事实，判断与立项检查同一套。读不出来时返回 null。 */
export async function projectSetupFacts(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<ProjectSetupFacts | null> {
  try {
    const hasManuscript = (await iterManuscriptFiles(reader, root, platform)).length > 0;
    return { hasManuscript, missing: await missingSetupKinds(reader, root) };
  } catch (error) {
    if (optional(error)) return null;
    throw error;
  }
}

/** 作品内相对路径算哪一类立项文件（与立项检查同一套归类）；不算就是 null。 */
export function setupKindOfPath(path: string): SetupKind | null {
  const posix = path.replace(/\\/g, '/');
  if (!TEXT_SUFFIXES.has(suffixOf(posix))) return null;
  const kind = projectKnowledgeSourceType(posix) as SetupKind | null;
  return kind !== null && SETUP_KINDS.includes(kind) ? kind : null;
}

const labels = (missing: readonly SetupKind[]) => missing.map((kind) => LABELS[kind]).join('、');

/** 作品底座里的一段：普通对话里 agent 也知道立项还缺什么。 */
export function setupGapSection(missing: readonly SetupKind[]): string {
  return `[立项 · 确定性]\n· 还没有正文，也还缺${labels(missing)}文件；开写第一章前先起草，作者审过再写。`;
}

/** 作者要开写第一章、立项又不齐时，附在这一轮作者消息前的说明。 */
export function setupNote(missing: readonly SetupKind[]): string {
  const order = missing.map((kind) => SUGGESTED_PATHS[kind]).join(' → ');
  return (
    `[立项检查：这本书还没有正文，也还缺${labels(missing)}文件。这一轮先别写第一章：` +
    '先用一两句话提醒作者——开写前把谈定的方向存成文件，起草时才照得着；不想先立项，说「跳过立项，写第一章」就行。' +
    `然后用 file_create 起草缺的第一份（建议顺序：${order}），把对话里谈定的要点全部写进 instruction（起草模型看不到对话）；` +
    '作者还没定的名字、身份、家族、地名等，先填具体的建议值并在文中标「（建议，可改）」，不要留空等作者拍板。' +
    '一次只起草一份，回复里说明下一份是什么；作者接受后说「继续立项」就接着起草下一份。]'
  );
}
