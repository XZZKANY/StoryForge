import { compareChapterPaths, isUntouchedProjectGuide } from '@storyforge/project-core';
import { normalizeNewlines, ProjectReadError, type ProjectReader } from '../readPort';
import { isChapterOutlineCandidate } from './chapterOutline';
import { FsToolError } from './fsTools';
import type { GenerationSourceCapture } from './generationSources';
import { focusOutline, outlineFocusNote } from './outlineFocus';
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
/** 章纲那一步带的全书总纲（只取大纲目录，不含各章细纲）的总额度。 */
export const BOOK_OUTLINE_MAX_CHARS = SETTING_FILE_MAX_CHARS;

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

type Cut = {
  readonly path: string;
  readonly chars: number;
  readonly room: number;
  /** 按章挑了小节（见 outlineFocus）；false 是只取了开头。 */
  readonly focused: boolean;
  readonly outline: boolean;
};

type Gathered = {
  readonly sections: { readonly path: string; readonly body: string }[];
  readonly used: number;
  readonly truncated: string[];
  readonly omitted: string[];
  readonly cuts: Cut[];
};

/** 按类目顺序读资料全文，每份、总量、份数都有上限；放不下的大纲按本章挑小节，其余照旧取开头。 */
async function gather(
  reader: ProjectReader,
  root: string,
  options: {
    secrets: SecretContext;
    types: readonly string[];
    fileMaxChars: number;
    totalMaxChars: number;
    ordinal: number | null;
  },
): Promise<Gathered | null> {
  let candidates: Awaited<ReturnType<typeof projectKnowledgeCandidates>>;
  try {
    candidates = await projectKnowledgeCandidates(reader, root);
  } catch (error) {
    if (optional(error)) return null;
    throw error;
  }
  const ordered = candidates
    .filter(
      (item) =>
        options.types.includes(item.source_type) &&
        TEXT_SUFFIXES.has(suffixOf(item.path)) &&
        !isChapterOutlineCandidate(item),
    )
    .sort(
      (a, b) =>
        SOURCE_ORDER.indexOf(a.source_type) - SOURCE_ORDER.indexOf(b.source_type) ||
        compareChapterPaths(a.path, b.path),
    );
  const sections: { path: string; body: string }[] = [];
  const truncated: string[] = [];
  const omitted: string[] = [];
  const cuts: Cut[] = [];
  let used = 0;
  for (const item of ordered) {
    const room = Math.min(options.fileMaxChars, options.totalMaxChars - used);
    if (sections.length >= SETTING_MAX_FILES || room < SETTING_MIN_ROOM) {
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
    const focused =
      cut && item.source_type === 'outline' ? focusOutline(text, options.ordinal, room) : null;
    const body = !cut
      ? text
      : focused !== null
        ? `${outlineFocusNote(points.length, options.ordinal)}\n${focused}`
        : `${points.slice(0, room).join('')}\n……（这份共 ${points.length} 字，这里只放了开头 ${room} 字）`;
    if (cut) {
      truncated.push(item.path);
      cuts.push({
        path: item.path,
        chars: points.length,
        room,
        focused: focused !== null,
        outline: item.source_type === 'outline',
      });
    }
    used += Math.min(points.length, room);
    sections.push({ path: item.path, body });
  }
  return sections.length ? { sections, used, truncated, omitted, cuts } : null;
}

/**
 * 大纲 / 人物 / 设定 / 时间线 / 伏笔目录里的资料全文（每份、总量、份数都有上限）；各章细纲不在内（见 chapterOutline）。
 * 项目摘录只给每份开头 1200 字，设定文件后半的内容起草时一章都看不到。
 * ordinal 是在写的章号：总纲一份放不下时按它挑相关小节（见 outlineFocus），没有章号就按原顺序放并保留标题。
 * 读不到是「少一块加分上下文」，不挡起草：没有可用资料时返回 null。
 */
export async function collectSettingSources(
  reader: ProjectReader,
  root: string,
  options: { secrets: SecretContext; capture?: GenerationSourceCapture; ordinal?: number | null },
): Promise<SettingSources | null> {
  const gathered = await gather(reader, root, {
    secrets: options.secrets,
    types: SOURCE_ORDER,
    fileMaxChars: SETTING_FILE_MAX_CHARS,
    totalMaxChars: SETTING_TOTAL_MAX_CHARS,
    ordinal: options.ordinal ?? null,
  });
  if (gathered === null) return null;
  const { used, truncated, omitted } = gathered;
  const paths = gathered.sections.map((section) => section.path);
  const sections = gathered.sections.map(
    (section) => `### ${section.path}\n<<<SETTING\n${section.body}\nSETTING>>>`,
  );
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

/**
 * 章纲那一步的全书总纲：大纲目录里的资料（不含各章细纲），按本章挑过，不看作者有没有固定参考。
 * 章纲只靠对话带的摘录时，不固定就一个字总纲都没有，固定了也只有开头 1200 字，排不出本章在全书里该走到哪一步。
 */
export async function collectBookOutline(
  reader: ProjectReader,
  root: string,
  options: { secrets: SecretContext; ordinal: number | null },
): Promise<string | null> {
  const gathered = await gather(reader, root, {
    secrets: options.secrets,
    types: ['outline'],
    fileMaxChars: BOOK_OUTLINE_MAX_CHARS,
    totalMaxChars: BOOK_OUTLINE_MAX_CHARS,
    ordinal: options.ordinal,
  });
  if (gathered === null) return null;
  const { omitted } = gathered;
  const more = omitted.length > OMITTED_NAMED ? ' 等' : '';
  const tail = omitted.length
    ? `\n（另有 ${omitted.length} 份大纲没放进来：${omitted.slice(0, OMITTED_NAMED).join('、')}${more}）`
    : '';
  return (
    gathered.sections.map((section) => `【${section.path}】\n${section.body}`).join('\n\n') + tail
  );
}

const namedList = (paths: readonly string[]) =>
  paths
    .slice(0, OMITTED_NAMED)
    .map((path) => `「${path}」`)
    .join('') + (paths.length > OMITTED_NAMED ? ' 等' : '');

function cutWarning(cut: Cut): string {
  const head = `「${cut.path}」共 ${cut.chars} 字，每章只放得下 ${cut.room} 字：`;
  if (cut.focused) return `${head}写每一章时按章号先挑相关的小节，放不下的小节只留标题。`;
  return (
    `${head}只带开头 ${cut.room} 字，后面的内容 AI 写章时看不到。` +
    (cut.outline
      ? '大纲没有「## 第N章」这样的 Markdown 标题时只能取开头；加上标题就能按章挑相关小节。'
      : '')
  );
}

/**
 * 开跑前告诉作者：哪些立项资料 AI 写章时看不全（起草与章纲按同样的规矩取，截不截与在写第几章无关）。
 * 只读文件、不调模型、不记证据；没有要提醒的返回空数组。
 */
export async function settingSourcesWarnings(
  reader: ProjectReader,
  root: string,
  options: { secrets: SecretContext },
): Promise<string[]> {
  const draft = await gather(reader, root, {
    secrets: options.secrets,
    types: SOURCE_ORDER,
    fileMaxChars: SETTING_FILE_MAX_CHARS,
    totalMaxChars: SETTING_TOTAL_MAX_CHARS,
    ordinal: null,
  });
  if (draft === null) return [];
  const warnings = draft.cuts.map(cutWarning);
  if (draft.omitted.length)
    warnings.push(
      `另有 ${draft.omitted.length} 份立项资料放不进去（每章最多带 ${SETTING_MAX_FILES} 份、` +
        `合计 ${SETTING_TOTAL_MAX_CHARS} 字），AI 写章时一字不带：${namedList(draft.omitted)}。`,
    );
  const outline = await gather(reader, root, {
    secrets: options.secrets,
    types: ['outline'],
    fileMaxChars: BOOK_OUTLINE_MAX_CHARS,
    totalMaxChars: BOOK_OUTLINE_MAX_CHARS,
    ordinal: null,
  });
  if (outline !== null) {
    const reported = new Set([...draft.truncated, ...draft.omitted]);
    const short = [...outline.cuts.map((cut) => cut.path), ...outline.omitted].filter(
      (path) => !reported.has(path),
    );
    if (short.length)
      warnings.push(
        `排章纲时大纲合计只带 ${BOOK_OUTLINE_MAX_CHARS} 字，这几份带不全或不带（起草时照上面的规矩带）：` +
          `${namedList(short)}。`,
      );
  }
  return warnings;
}
