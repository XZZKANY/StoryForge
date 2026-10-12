import { ProjectReadError, type ProjectReader } from '../readPort';
import type { GenerationSourceCapture } from './generationSources';
import { pythonFixed, pythonFloatSum } from './math';
import { iterManuscriptFiles } from './previousChapter';
import { ProjectTreeError } from './projectTree';
import { pythonStrip } from './pythonText';

// ---- 文风指纹：检查器与生成器共用的一套数学 ----

export const STYLE_DRIFT_PHRASES = [
  '作者直接解释',
  '设定说明',
  '旁白解释',
  '直接说明设定',
  '作者在这里解释',
];
export const STYLE_FINGERPRINT_DRIFT_PHRASES = [
  ...STYLE_DRIFT_PHRASES,
  '这说明',
  '意味着',
  '读者立刻明白',
  '宏大轮盘',
];
export const STYLE_RESTRAINT_MARKERS = ['克制', '沉默', '低声', '按住', '没有解释', '只把'];

export type StyleFingerprint = {
  average_sentence_length: number;
  exposition_density: number;
  restraint_density: number;
  dialogue_ratio: number;
  sentence_count: number;
};

/** Python round(x, n)：对实际二进制值做半偶舍入。 */
const pythonRound = (value: number, digits: number) => Number(pythonFixed(value, digits));
const length = (text: string) => Array.from(text).length;
const countOf = (text: string, part: string) => text.split(part).length - 1;

export function splitSentences(content: string): string[] {
  const separators = '。！？!?\n\r';
  const sentences: string[] = [];
  let current = '';
  for (const char of content) {
    if (!separators.includes(char)) {
      current += char;
      continue;
    }
    const sentence = pythonStrip(current);
    if (sentence) sentences.push(sentence);
    current = '';
  }
  const tail = pythonStrip(current);
  if (tail) sentences.push(tail);
  if (!pythonStrip(content)) return [];
  return sentences.length ? sentences : [pythonStrip(content)];
}

export function markerCount(content: string, markers: readonly string[]): number {
  return markers.reduce((sum, marker) => sum + countOf(content, marker), 0);
}

/** 可解释的轻量文风特征，不依赖外部 NLP。 */
export function styleFingerprint(content: string): StyleFingerprint {
  const sentences = splitSentences(content);
  const count = sentences.length;
  const totalChars = sentences.reduce((sum, sentence) => sum + length(sentence), 0) || 1;
  const denominator = Math.max(count, 1);
  return {
    average_sentence_length: pythonRound(totalChars / denominator, 3),
    exposition_density: pythonRound(
      markerCount(content, STYLE_FINGERPRINT_DRIFT_PHRASES) / denominator,
      3,
    ),
    restraint_density: pythonRound(markerCount(content, STYLE_RESTRAINT_MARKERS) / denominator, 3),
    dialogue_ratio: pythonRound(
      (countOf(content, '「') + countOf(content, '」')) / Math.max(length(content), 1),
      3,
    ),
    sentence_count: count,
  };
}

// ---- 文风基线：从本地正文量出、带置信区间的对齐目标 ----

/** 只取最近若干个正文文件：近作比首章更能代表「现在的作者」。 */
export const RECENT_FILES = 10;
export const MIN_CHUNK_CHARS = 400;
export const MIN_CHUNKS = 3;
export const MAX_FILE_BYTES = 200_000;
/** 历史命名：这是解码规范化后的字符数上限，不是字节。 */
export const MAX_TOTAL_CHARS = 800_000;
/** 95% 置信区间半宽超过容差的维度不说出口：样本说不准的事，就不说。 */
export const AVG_SENTENCE_LENGTH_TOLERANCE = 2.0;
export const DIALOGUE_RATIO_TOLERANCE = 0.01;
// t 分布 97.5% 分位（双侧 95%），df=1..20；更大的 df 用 1.96。
const T_CRITICAL = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
];

export type StyleTarget = { value: number; half_width: number };
export type StyleBaseline = {
  file_count: number;
  sentence_count: number;
  average_sentence_length: StyleTarget | null;
  dialogue_ratio: StyleTarget | null;
};

function meanWithCi(values: readonly number[]): StyleTarget | null {
  const count = values.length;
  if (count < MIN_CHUNKS) return null;
  const mean = pythonFloatSum(values) / count;
  const variance = pythonFloatSum(values.map((value) => (value - mean) ** 2)) / (count - 1);
  const standardError = Math.sqrt(variance) / Math.sqrt(count);
  const critical = T_CRITICAL[count - 2] ?? 1.96;
  return { value: mean, half_width: critical * standardError };
}

async function readChunk(
  reader: ProjectReader,
  root: string,
  path: string,
  capture?: GenerationSourceCapture,
): Promise<string | null> {
  let raw: Uint8Array;
  try {
    raw = (await reader.readProjectBytes(root, path, MAX_FILE_BYTES - 1)).bytes;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    await capture?.observe('style_sample', path, { omissionReason: 'unreadable_source' });
    return null;
  }
  if (raw.subarray(0, 1024).includes(0)) {
    await capture?.observe('style_sample', path, {
      raw,
      complete: false,
      omissionReason: 'binary_source',
    });
    return null;
  }
  const text = pythonStrip(
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw).replace(/\r\n?/g, '\n'),
  );
  const short = length(text) < MIN_CHUNK_CHARS;
  await capture?.observe('style_sample', path, {
    raw,
    text,
    complete: raw.length < MAX_FILE_BYTES,
    omissionReason: short ? 'short_source' : null,
  });
  return short ? null : text;
}

/**
 * 扫本地正文算文风基线；语料不足或全维度不够准时返回 null（调用方据此不注入）。
 * 每次重扫不缓存；读不到项目一律 null——这是加分项，绝不能挡住生成。
 */
export async function buildStyleBaseline(
  reader: ProjectReader,
  root: string | null,
  options: { platform: 'windows' | 'posix'; capture?: GenerationSourceCapture },
): Promise<StyleBaseline | null> {
  const { platform, capture } = options;
  if (typeof root !== 'string' || !pythonStrip(root)) return null;
  let candidates: string[];
  try {
    await reader.resolveProjectPath(root, '.');
    if ((await reader.inspectProjectPath(root, '.')).targetKind !== 'directory') return null;
    // 同一份文件经别名出现多次只算一次（以解析后的目标认身份）。
    const unique = new Map<string, string>();
    // 大纲与人物设定不进语料。
    for (const path of await iterManuscriptFiles(reader, root, platform)) {
      const target = (await reader.resolveProjectPath(root, path)).resolvedRelativePath;
      await reader.inspectProjectPath(root, target);
      if (!unique.has(target)) unique.set(target, target);
    }
    candidates = [...unique.values()].slice(-RECENT_FILES);
  } catch (error) {
    if (error instanceof ProjectReadError || error instanceof ProjectTreeError) return null;
    throw error;
  }
  const chunks: string[] = [];
  let totalChars = 0;
  for (const candidate of candidates) {
    let path: string;
    try {
      path = (await reader.resolveProjectPath(root, candidate)).resolvedRelativePath;
    } catch (error) {
      if (!(error instanceof ProjectReadError)) throw error;
      continue;
    }
    const text = await readChunk(reader, root, path, capture);
    if (text === null) continue;
    totalChars += length(text);
    if (totalChars > MAX_TOTAL_CHARS) {
      capture?.omit('style_sample', path, 'aggregate_character_budget');
      break;
    }
    chunks.push(text);
  }
  if (chunks.length < MIN_CHUNKS) return null;
  const fingerprints = chunks.map(styleFingerprint);
  const sentenceCount = chunks.reduce((sum, chunk) => sum + splitSentences(chunk).length, 0);
  let averageSentenceLength = meanWithCi(fingerprints.map((item) => item.average_sentence_length));
  if (
    averageSentenceLength !== null &&
    averageSentenceLength.half_width > AVG_SENTENCE_LENGTH_TOLERANCE
  )
    averageSentenceLength = null;
  let dialogueRatio = meanWithCi(fingerprints.map((item) => item.dialogue_ratio));
  if (dialogueRatio !== null && dialogueRatio.half_width > DIALOGUE_RATIO_TOLERANCE)
    dialogueRatio = null;
  // 测得 0 不等于「不写对白」：只数「」，用“”的手稿会稳定测出 0，照喂就是命令生成器别写对白。
  if (dialogueRatio !== null && dialogueRatio.value <= 0) dialogueRatio = null;
  if (averageSentenceLength === null && dialogueRatio === null) return null;
  return {
    file_count: chunks.length,
    sentence_count: sentenceCount,
    average_sentence_length: averageSentenceLength,
    dialogue_ratio: dialogueRatio,
  };
}

/** 对齐目标而非硬规则：与作者显式要求冲突时以作者为准（注入顺序保证）。 */
export function styleBaselineClause(baseline: StyleBaseline): string {
  const parts: string[] = [];
  if (baseline.average_sentence_length !== null)
    parts.push(
      `目标句长：平均约 ${pythonFixed(baseline.average_sentence_length.value, 0)} 字/句，` +
        '贴合你已写章节的节奏，避免明显变长或变碎',
    );
  if (baseline.dialogue_ratio !== null)
    parts.push(
      `目标对白密度：与已写章节相当（参考标记占比 ${pythonFixed(baseline.dialogue_ratio.value, 2)}），` +
        '不要突然大段独白或全是旁白',
    );
  return (
    '文风基线（量自作者已写的正文，是对齐目标不是硬规则，与作者显式要求冲突时以作者为准；' +
    `样本：${baseline.file_count} 个正文文件、${baseline.sentence_count} 句）：` +
    parts.join('；') +
    '。样本不足以确定的维度已略去，不要就此臆测。'
  );
}

/** 把文风基线接到 system prompt 末尾；量不出来就原样返回。 */
export async function appendStyleBaselineToSystemPrompt(
  reader: ProjectReader,
  systemPrompt: string,
  root: string | null,
  options: { platform: 'windows' | 'posix'; capture?: GenerationSourceCapture },
): Promise<string> {
  const baseline = await buildStyleBaseline(reader, root, options);
  if (baseline === null) {
    options.capture?.project('style_baseline', null, {
      sourcePurpose: 'style_sample',
      omissionReason: 'insufficient_style_evidence',
      transformation: 'style_statistics_v1',
    });
    return systemPrompt;
  }
  const clause = styleBaselineClause(baseline);
  options.capture?.project('style_baseline', clause, {
    sourcePurpose: 'style_sample',
    transformation: 'style_statistics_v1',
  });
  return systemPrompt + '\n\n' + clause;
}
