import type { CrossChapterFinding } from '../../lib/api/types';
import type { SemanticFile } from '../../lib/project/types';

export type ChapterRef = { name: string; relativePath: string; path: string };

export type ChapterSubmissionPlan =
  | { channel: 'cross-chapter'; refs: ChapterRef[] }
  | {
      channel: 'agent';
      intent: 'chapter.write' | undefined;
      targetFilePath: string | undefined;
      contextPaths: string[];
      /** 「写/起草下一章」：目标交连载计划回退，不锚定当前打开稿。 */
      planFallback: boolean;
    };

/**
 * 从用户消息里识别 ≥2 个章节引用(「第N章」/「@N」),映射到项目里的 draft 章节文件。
 * 返回去重、保序的章节文件列表;不足两个时由调用方决定是否走跨章流程。
 */
export function resolveChapterRefs(text: string, files: SemanticFile[]): ChapterRef[] {
  const numbers: number[] = [];
  const pattern = /第\s*(\d+)\s*章|@\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value) && !numbers.includes(value)) {
      numbers.push(value);
    }
  }

  const drafts = files.filter((file) => file.kind === 'draft');
  const refs: ChapterRef[] = [];
  const seen = new Set<string>();
  for (const value of numbers) {
    const file = drafts.find((candidate) => chapterFileMatchesNumber(candidate.name, value));
    if (file && !seen.has(file.path)) {
      seen.add(file.path);
      refs.push({
        name: chapterDisplayName(file),
        relativePath: file.relativePath,
        path: file.path,
      });
    }
  }
  return refs;
}

/** 与「AI 起草下一章」按钮同约定：新章目标 正文/第{ordinal:03d}章.md（见 lib/assistant-events.ts）。 */
export function chapterTargetPath(ordinal: number): string {
  return `正文/第${String(ordinal).padStart(3, '0')}章.md`;
}

// 既有稿编辑动词（单字前缀）：紧贴「写/起草/生成第N章」时说明是在改已有章，不是新章。
const EDIT_VERB_PREFIX = '改重续修润补扩缩誊删压精校调';
const NEW_CHAPTER_VERB = '写|起草|生成';
const CHAPTER_NUMBER = '[0-9一二三四五六七八九十百零〇两]+';
// 章号必须带「章」：裸「写第」「生成第」会把「写第一封信」「生成第二种策略」这类比较题误判成写章。
const WRITE_CHAPTER_MATCH = new RegExp(
  `(?<![${EDIT_VERB_PREFIX}])(${NEW_CHAPTER_VERB})\\s*第\\s*(${CHAPTER_NUMBER})\\s*章`,
);
const NEXT_CHAPTER_MATCH = new RegExp(`(?<![${EDIT_VERB_PREFIX}])(?:${NEW_CHAPTER_VERB})下一章`);
const ONE_CHAPTER_MATCH = new RegExp(`(?<![${EDIT_VERB_PREFIX}])(?:${NEW_CHAPTER_VERB})一章`);
// 否定式（不要写下一章 / 先别写第3章…）= 普通对话，不产生任何写章意图。
// 「别」只在句首/标点后才算否定，否则「分别写」「特别写」「识别生成」会被误判。
const NEGATED_WRITE = new RegExp(
  `(?:不要|不用|不必|先别|暂不|先不|(?:^|[，。！？；\\s])别)\\s*(?:${NEW_CHAPTER_VERB})`,
);

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 章号文本 → 序数：ASCII 数字直读，中文数字支持 一~九百九十九；读不出返回 null（不猜）。 */
export function chapterOrdinalFromText(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : null;
  }
  let total = 0;
  let digit: number | null = null;
  for (const char of value) {
    if (char === '零' || char === '〇') {
      digit = null;
      continue;
    }
    if (char === '百' || char === '十') {
      total += (digit ?? 1) * (char === '百' ? 100 : 10);
      digit = null;
      continue;
    }
    const parsed = CHINESE_DIGITS[char];
    // 连续数字（「二三」这类连写）不认，避免猜出错误章号。
    if (parsed === undefined || digit !== null) return null;
    digit = parsed;
  }
  const ordinal = total + (digit ?? 0);
  return ordinal > 0 ? ordinal : null;
}

/**
 * 「写/起草/生成第N章」的显式目标：已有草稿取真实相对路径，新章按命名约定推导。
 * 动词须锚定（负向后视排除「改写/重写/扩写/续写/修订/润色」等既有稿操作），章号须带「章」，
 * 否则「改写第3章」「写第一封信」会命中「写第…」子串，把 chapter.write 绑到既有稿或误判成写章。
 * 「写下一章/起草下一章」返回 planFallback，目标交后端按连载计划回退；章号读不出则不猜（不产生写章意图）。
 */
export function chapterWriteTarget(
  text: string,
  files: SemanticFile[],
):
  | { intent: 'chapter.write'; targetFilePath: string | undefined; planFallback: boolean }
  | undefined {
  if (NEGATED_WRITE.test(text)) return undefined;
  if (NEXT_CHAPTER_MATCH.test(text)) {
    return { intent: 'chapter.write', targetFilePath: undefined, planFallback: true };
  }
  if (ONE_CHAPTER_MATCH.test(text)) {
    return { intent: 'chapter.write', targetFilePath: undefined, planFallback: false };
  }
  const match = WRITE_CHAPTER_MATCH.exec(text);
  if (!match) return undefined;
  const ordinal = chapterOrdinalFromText(match[2]);
  if (ordinal === null) return undefined;
  const existing = resolveChapterRefs(`第${ordinal}章`, files)[0];
  return {
    intent: 'chapter.write',
    targetFilePath: existing ? existing.relativePath : chapterTargetPath(ordinal),
    planFallback: false,
  };
}

// 具名操作动词：裸「写/改/生成」会把「描写/写法/改动」等比较题误判成操作而抢走跨章检查；
// 写章形式复用上面的锚定判定，保证「写第一封信」这类不在此列。
const CHAPTER_OPERATION_PATTERN =
  /润色|润饰|扩写|缩写|誊写|续写|补写|精简|压缩|改写|重写|修改|修订|打磨|加工|起草/;

// 比较/提问信号：≥2 引用章时它说明作者在问「两章一致吗」，而不是要动某章——
// 「第1章和第2章的修改是否一致」里的「修改」是名词，不能因此把跨章检查降级成 agent。
const COMPARISON_PATTERN = /是否|吗|？|\?|对比|比较|区别|差异|一致|矛盾|有没有|如何|为什么|哪一?章/;
// 但「把/将/请…+ 编辑动词」是真在要求动手，此时比较信号让位。
const IMPERATIVE_EDIT_PATTERN = new RegExp(
  `(?:把|将|给|帮|请|麻烦|替我)[^。！？]{0,12}(?:${CHAPTER_OPERATION_PATTERN.source})`,
);

/**
 * T03：先绑定操作再选通道。明确写章意图（含计划回退）走 agent；≥2 引用章且是纯比较/提问
 * （无「把…润色」这类强动作信号）走跨章检查；其余带操作词的请求走 agent 并且引用章降为上下文。
 * T09：agent 路径带上显式写章目标；否定式不产生任何写章意图。
 */
export function planChapterSubmission(text: string, files: SemanticFile[]): ChapterSubmissionPlan {
  const refs = resolveChapterRefs(text, files);
  const write = chapterWriteTarget(text, files);
  const contextPaths = refs.length >= 2 ? refs.map((ref) => ref.relativePath) : [];
  if (write) {
    return {
      channel: 'agent',
      intent: write.intent,
      targetFilePath: write.targetFilePath,
      contextPaths,
      planFallback: write.planFallback,
    };
  }
  if (refs.length >= 2 && COMPARISON_PATTERN.test(text) && !IMPERATIVE_EDIT_PATTERN.test(text)) {
    return { channel: 'cross-chapter', refs };
  }
  const wantsChapterWrite =
    !NEGATED_WRITE.test(text) &&
    (WRITE_CHAPTER_MATCH.test(text) ||
      NEXT_CHAPTER_MATCH.test(text) ||
      ONE_CHAPTER_MATCH.test(text));
  if (wantsChapterWrite || CHAPTER_OPERATION_PATTERN.test(text)) {
    return {
      channel: 'agent',
      intent: undefined,
      targetFilePath: undefined,
      contextPaths,
      planFallback: false,
    };
  }
  if (refs.length >= 2) return { channel: 'cross-chapter', refs };
  return {
    channel: 'agent',
    intent: undefined,
    targetFilePath: undefined,
    contextPaths: [],
    planFallback: false,
  };
}

function chapterFileMatchesNumber(fileName: string, value: number): boolean {
  const digits = fileName.match(/\d+/g) ?? [];
  return digits.some((group) => Number.parseInt(group, 10) === value);
}

function chapterDisplayName(file: SemanticFile): string {
  return file.name.replace(/\.(md|txt|markdown)$/i, '');
}

/** 把跨章冲突格式化成对话里可读的多行文本。 */
export function formatCrossChapterFindings(
  findings: CrossChapterFinding[],
  chapterNames: string[],
  model: string | null,
): string {
  const scope = chapterNames.join(' / ');
  const suffix = model ? ` · ${model}` : '';
  if (findings.length === 0) {
    return `跨章一致性检查(${scope})${suffix}\n未发现跨章硬冲突。`;
  }
  const lines = findings.map((finding) => {
    const chapters = (finding.chapters ?? []).join('↔') || '?';
    return `• [${finding.type}·${finding.severity}] ${chapters}：${finding.finding}\n  证据：${finding.evidence}`;
  });
  return `跨章一致性检查(${scope})${suffix} · 发现 ${findings.length} 条：\n${lines.join('\n')}`;
}
