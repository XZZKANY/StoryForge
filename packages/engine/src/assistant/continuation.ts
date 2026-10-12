import { craftPromptClause, sceneDisciplineClause } from '../kernel/craft';
import { PYTHON_WHITESPACE, pythonStrip } from '../kernel/pythonText';
import type { AssistantContextBundle } from '../kernel/writingContext';

/**
 * 光标处续写的纯函数层：上文取窗、prompt 组装、生成后确定性后处理。
 * 操舵指令贴近尾部；显式禁止收尾；防重复靠 prompt + 确定性后处理而不是采样惩罚。
 */

// 上文取窗上限：够模型接住语感与当前场景，又不至于把整章塞进每一次续写。
export const TAIL_MAX_CHARS = 3000;
export const SUFFIX_MAX_CHARS = 3000;
// 一段的目标区间；作者选定「一段」为默认粒度。
export const DEFAULT_TARGET_CHARS = 300;

export const CONTINUE_SYSTEM_PROMPT =
  '你是 StoryForge 的中文长篇小说作者，正在作者本人的稿件上接着往下写。' +
  '你写出的文字会直接插进作者的正文里，因此必须与上文保持同一叙事人称、同一语感、' +
  '同一场景时空，读起来像同一个人一口气写下来的。' +
  craftPromptClause() +
  sceneDisciplineClause() +
  '只输出续写的正文本身，不要输出解释、标题、前后缀或代码块标记。';

const SENTENCE_ENDINGS = '。！？…”』」》!?';
const LEADING_WS = new RegExp(`^${PYTHON_WHITESPACE}+`, 'u');
const TRAILING_WS = new RegExp(`${PYTHON_WHITESPACE}+$`, 'u');
const normalizedLines = (content: string) => content.replace(/\r\n?/g, '\n').split('\n');
const stripNewlines = (text: string) => text.replace(/^\n+|\n+$/g, '');
const clampLine = (line: number, count: number) => Math.max(0, Math.min(Math.trunc(line), count));

/**
 * 取光标行（含）之前的正文尾巴，按段落边界截断到 maxChars 以内。cursorLine 1-based；
 * 越界一律夹到合法区间——前端行号可能与正文差一次未保存的编辑，宁可少取一行也不打断作者。
 */
export function manuscriptTail(
  content: string,
  cursorLine: number,
  maxChars = TAIL_MAX_CHARS,
): string {
  if (!content) return '';
  const lines = normalizedLines(content);
  const head = Array.from(lines.slice(0, clampLine(cursorLine, lines.length)).join('\n'));
  if (head.length <= maxChars) return stripNewlines(head.join(''));
  let window = head.slice(-maxChars);
  // 从段落边界起头，避免上文以半句开始误导模型的语感判断。
  const boundary = window.findIndex((char, i) => char === '\n' && window[i + 1] === '\n');
  if (boundary !== -1 && boundary < Math.floor(maxChars / 2)) window = window.slice(boundary + 2);
  return stripNewlines(window.join(''));
}

/** 实际插入行之后的只读后文；与插入函数共用行号和换行归一化口径。 */
export function manuscriptSuffix(content: string, cursorLine: number): string {
  const lines = normalizedLines(content);
  return stripNewlines(lines.slice(clampLine(cursorLine, lines.length)).join('\n'));
}

/** 定位 / 项目材料 → 上章尾 → 上文 / 只读后文 → canon → 本次要求（最末，近因最强）。 */
export function buildContinuePrompt(options: {
  tail: string;
  filePath: string;
  suffix?: string;
  contextBundle?: AssistantContextBundle | null;
  instruction?: string | null;
  sceneConstraints?: string | null;
  previousChapter?: readonly [string, string] | null;
  targetChars?: number;
}): string {
  const { tail, filePath, suffix = '', contextBundle, instruction, sceneConstraints } = options;
  const previousChapter = options.previousChapter ?? null;
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
  const blocks = [`文件：${filePath}`];
  if (contextBundle && contextBundle.files.length)
    blocks.push(
      '项目上下文（作者选定的材料与准入后的知识）：\n' +
        contextBundle.files
          .map((item) => `### ${item.relative_path}\n<<<CONTEXT\n${item.excerpt}\nCONTEXT>>>`)
          .join('\n\n'),
    );
  if (previousChapter !== null) {
    const [previousPath, previousTail] = previousChapter;
    blocks.push(
      `上一章（${previousPath}）的结尾：\n<<<PREVIOUS\n` + previousTail + '\nPREVIOUS>>>',
    );
  }
  if (tail)
    blocks.push('以下是这份稿件到光标为止的上文：\n<<<MANUSCRIPT\n' + tail + '\nMANUSCRIPT>>>');
  else if (previousChapter !== null)
    // 本章还空但有上一章时绝不能说「你要写的是开头」——模型会另起炉灶重开一个场。
    blocks.push('本章还是空的：你要写的是本章开头，接的是上面那段上一章结尾。');
  else blocks.push('这份稿件当前还是空的，你要写的是开头。');
  if (suffix) {
    const suffixPoints = Array.from(suffix);
    const window = suffixPoints.slice(0, SUFFIX_MAX_CHARS).join('');
    const notice =
      suffixPoints.length > SUFFIX_MAX_CHARS
        ? '\n[后文超过上下文窗口，仅展示紧邻插入点的开头。]'
        : '';
    blocks.push(
      '插入点之后已经存在的后文（只读，保持原文不动）：\n' +
        `<<<SUFFIX\n${window}\nSUFFIX>>>${notice}\n` +
        '只生成连接上文与这段后文的新正文，不要复述或重写后文，也不要把后文已发生的事提前再写一遍。',
    );
  }
  if (sceneConstraints) blocks.push(sceneConstraints);
  const requirements = [
    '从上文的最后一个字接着往下写，不要重复、不要重述、不要总结上文已有的内容。',
    `这一次只写约 ${targetChars} 个中文字符（一个自然段到一个小节拍），不要写完整章。`,
    '这是进行中的作品：不要收尾，不要写总结性结语，也不要刻意甩悬念钩子式的收束句。',
    '不要另起标题或分隔线，直接写正文。',
  ];
  if (instruction) requirements.push(`作者对这一段的额外要求：${instruction}`);
  blocks.push('【本次续写要求】\n' + requirements.map((item) => `- ${item}`).join('\n'));
  return blocks.join('\n\n');
}

/** 掐掉模型在续写开头重抄的那截上文；minOverlap 挡住「他」「于是」这类短串的误伤。 */
export function stripRepeatedPrefix(tail: string, generated: string, minOverlap = 8): string {
  if (!tail || !generated) return generated;
  const normalizedTail = Array.from(tail.replace(TRAILING_WS, ''));
  const generatedPoints = Array.from(generated);
  const limit = Math.min(normalizedTail.length, generatedPoints.length, 400);
  for (let size = limit; size >= minOverlap; size--) {
    const prefix = normalizedTail.slice(-size);
    if (prefix.every((char, i) => generatedPoints[i] === char))
      return generatedPoints.slice(size).join('').replace(LEADING_WS, '');
  }
  return generated;
}

/** 把被 token 上限截断的半句裁到最后一个完整句末；砍掉超过一半时放弃裁剪。 */
export function trimToSentenceEnd(text: string, minKeepRatio = 0.5): string {
  const stripped = Array.from(text.replace(TRAILING_WS, ''));
  if (!stripped.length) return '';
  if (SENTENCE_ENDINGS.includes(stripped[stripped.length - 1])) return stripped.join('');
  const cut = Math.max(...Array.from(SENTENCE_ENDINGS).map((char) => stripped.lastIndexOf(char)));
  if (cut < 0 || cut + 1 < stripped.length * minKeepRatio) return stripped.join('');
  return stripped.slice(0, cut + 1).join('');
}

/** 生成后的确定性收口：先掐重复开头，再裁到完整句末。 */
export function finalizeContinuation(tail: string, generated: string): string {
  return trimToSentenceEnd(stripRepeatedPrefix(tail, pythonStrip(generated)));
}

/**
 * 从光标行推导落点：往上跳过连续空行，让新段紧贴上一段。与前端 resolveContinueAnchorLine 同语义。
 * 返回 1-based：在此行之后插入；0 = 文件顶部。
 */
export function resolveAnchorLine(content: string, cursorLine: number): number {
  const lines = normalizedLines(content);
  let anchor = clampLine(cursorLine, lines.length);
  while (anchor > 0 && !pythonStrip(lines[anchor - 1])) anchor -= 1;
  return anchor;
}

/** 在 anchorLine 之后插入续写段，前后各留一个空行；空续写由上游按失败处理。 */
export function insertAtAnchor(content: string, anchorLine: number, text: string): string {
  const lines = normalizedLines(content);
  const anchor = clampLine(anchorLine, lines.length);
  const head = lines.slice(0, anchor);
  const tail = lines.slice(anchor);
  const block = stripNewlines(text);
  const merged = head.length ? [...head, '', block] : [block];
  // 落点后原本就有正文时补一个空行，避免新段与下文黏成一段。
  if (tail.some((line) => pythonStrip(line))) merged.push('');
  return [...merged, ...tail].join('\n');
}
