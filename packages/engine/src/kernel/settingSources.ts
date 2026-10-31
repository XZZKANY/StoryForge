import { compareChapterPaths, isUntouchedProjectGuide } from '@storyforge/project-core';
import { normalizeNewlines, ProjectReadError, type ProjectReader } from '../readPort';
import { FsToolError } from './fsTools';
import type { GenerationSourceCapture } from './generationSources';
import { projectKnowledgeCandidates } from './projectKnowledge';
import { readProjectContextFile, suffixOf } from './projectKnowledgeFiles';
import { ProjectTreeError } from './projectTree';
import { pythonStrip } from './pythonText';
import { redactSensitiveText, type SecretContext } from './redaction';

/** 起草时整份带上的立项资料，按这个顺序排：先答「往哪去」，再「谁」「什么能做」。资料库不带。 */
const SOURCE_ORDER = ['outline', 'character', 'setting', 'timeline', 'foreshadowing'];
const TEXT_SUFFIXES = new Set(['.md', '.markdown', '.txt']);
export const SETTING_FILE_MAX_CHARS = 6000;
export const SETTING_TOTAL_MAX_CHARS = 12000;
export const SETTING_MAX_FILES = 12;
/** 剩下的额度不够放一段像样的开头时，整份记成没放进来，不塞半句。 */
const SETTING_MIN_ROOM = 500;
const OMITTED_NAMED = 8;

export type SettingSources = {
  /** 原样放进起草提示词的整段文字。 */
  readonly block: string;
  readonly paths: readonly string[];
  readonly truncated: readonly string[];
  readonly omitted: readonly string[];
};

const optional = (error: unknown) =>
  error instanceof ProjectReadError ||
  error instanceof ProjectTreeError ||
  error instanceof FsToolError;

/**
 * 大纲 / 人物 / 设定 / 时间线 / 伏笔目录里的资料全文（每份、总量、份数都有上限）。
 * 项目摘录只给每份开头 1200 字，设定文件后半的内容起草时一章都看不到。
 * 读不到是「少一块加分上下文」，不挡起草：没有可用资料时返回 null。
 */
export async function collectSettingSources(
  reader: ProjectReader,
  root: string,
  options: { secrets: SecretContext; capture?: GenerationSourceCapture },
): Promise<SettingSources | null> {
  let candidates: Awaited<ReturnType<typeof projectKnowledgeCandidates>>;
  try {
    candidates = await projectKnowledgeCandidates(reader, root);
  } catch (error) {
    if (optional(error)) return null;
    throw error;
  }
  const ordered = candidates
    .filter(
      (item) => SOURCE_ORDER.includes(item.source_type) && TEXT_SUFFIXES.has(suffixOf(item.path)),
    )
    .sort(
      (a, b) =>
        SOURCE_ORDER.indexOf(a.source_type) - SOURCE_ORDER.indexOf(b.source_type) ||
        compareChapterPaths(a.path, b.path),
    );
  const sections: string[] = [];
  const paths: string[] = [];
  const truncated: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const item of ordered) {
    const room = Math.min(SETTING_FILE_MAX_CHARS, SETTING_TOTAL_MAX_CHARS - used);
    if (paths.length >= SETTING_MAX_FILES || room < SETTING_MIN_ROOM) {
      omitted.push(item.path);
      continue;
    }
    let content: string;
    try {
      content = (await readProjectContextFile(reader, root, item.path)).content;
    } catch (error) {
      if (optional(error)) continue;
      throw error;
    }
    const text = pythonStrip(redactSensitiveText(normalizeNewlines(content), options.secrets));
    if (!text || isUntouchedProjectGuide(item.path, text)) continue;
    const points = Array.from(text);
    const cut = points.length > room;
    const body = cut
      ? `${points.slice(0, room).join('')}\n……（这份共 ${points.length} 字，这里只放了开头 ${room} 字）`
      : text;
    if (cut) truncated.push(item.path);
    used += Math.min(points.length, room);
    paths.push(item.path);
    sections.push(`### ${item.path}\n<<<SETTING\n${body}\nSETTING>>>`);
  }
  if (!paths.length) return null;
  const more = omitted.length > OMITTED_NAMED ? ' 等' : '';
  const tail = omitted.length
    ? `\n（另有 ${omitted.length} 份立项资料没放进来：${omitted.slice(0, OMITTED_NAMED).join('、')}${more}）`
    : '';
  const block =
    '立项资料（全文）：项目里的大纲、人物、设定等资料，起草须与之一致。\n' +
    sections.join('\n\n') +
    tail;
  await options.capture?.selectWithHashes(
    'setting_files',
    {
      file_count: paths.length,
      truncated_count: truncated.length,
      omitted_count: omitted.length,
      delivered_chars: used,
    },
    { orderedPaths: paths },
  );
  options.capture?.project('setting_files', block, {
    channel: 'user',
    truncated: truncated.length > 0 || omitted.length > 0,
    transformation: 'setting_files_full_v1',
  });
  return { block, paths, truncated, omitted };
}
