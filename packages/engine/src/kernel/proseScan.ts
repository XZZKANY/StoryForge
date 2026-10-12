import type { ProjectReader } from '../readPort';
import { FsToolError, readBoundedText, resolveProjectRoot, resolveScopedPath } from './fsTools';
import { checkParagraphPatterns, type StaticProseIssue } from './paragraphPatterns';
import { DIALOGUE_PATTERN } from './punctuation';
import { PYTHON_WHITESPACE, pythonStrip } from './pythonText';

const MAX_FILE_BYTES = 512_000;
const CONTENT_CHAR_BUDGET = 24_000;

const CLICHE_PHRASES = ['不禁', '五味杂陈', '心中一震', '情不自禁', '无法言喻', '莫名', '深深地'];
const EMOTION_WORDS = ['愤怒', '害怕', '恐惧', '悲伤', '痛苦', '开心', '绝望', '紧张', '难过'];
const TELLING_PATTERNS = [
  /[一-鿿]{1,8}(很|非常|十分|特别|有些|感到|觉得)(愤怒|害怕|恐惧|悲伤|痛苦|开心|绝望|紧张|难过)/u,
  /不知道该怎么办/u,
];
const EXPLANATION_MARKERS = ['因为', '所以', '这意味着', '事实上', '换句话说', '他知道', '她知道'];
const NEGATION_MARKERS = ['从未', '没有', '不会', '再也不', '不再', '并未'];
const ACTION_MARKERS = [
  '走',
  '推',
  '拉',
  '抬',
  '按',
  '握',
  '转',
  '停',
  '藏',
  '递',
  '看',
  '问',
  '说',
  '答',
];
const WHITESPACE_RUN = new RegExp(`${PYTHON_WHITESPACE}+`, 'gu');
const SENTENCE_SPLIT = /[。！？!?\n]+/u;
const KEY_TERM_SPLIT = new RegExp(`[，。、“”/${PYTHON_WHITESPACE.slice(1, -1)}]+`, 'u');

const points = (text: string) => Array.from(text);
const length = (text: string) => points(text).length;
const slice = (text: string, start: number, end?: number) =>
  points(text).slice(start, end).join('');
const countOf = (text: string, part: string) => text.split(part).length - 1;

function issue(
  dimension: string,
  severity: string,
  snippet: string,
  message: string,
  suggestion: string,
  revisionStrategy = 'line_edit',
): StaticProseIssue {
  return { dimension, severity, snippet, message, suggestion, revision_strategy: revisionStrategy };
}

/** 角色禁止表现；连续性事实可以是文本或带 statement 的对象。 */
export type ProseConstraints = {
  characterConstraints?: readonly { forbidden_traits?: readonly string[] | null }[];
  continuityFacts?: readonly (string | { statement?: string | null })[];
  requiredFacts?: readonly string[];
  sceneBeats?: readonly string[];
  endingHook?: string;
};

function checkCliches(prose: string): StaticProseIssue[] {
  const hits = CLICHE_PHRASES.filter((phrase) => prose.includes(phrase));
  if (!hits.length) return [];
  return [
    issue(
      '套话',
      hits.length >= 2 ? '中' : '低',
      hits.join('、'),
      '出现高频陈词套话，削弱画面和人物独特性。',
      '替换为具体动作、感官细节或角色专属表达。',
    ),
  ];
}

function checkTelling(prose: string): StaticProseIssue[] {
  const issues: StaticProseIssue[] = [];
  for (const pattern of TELLING_PATTERNS) {
    const match = pattern.exec(prose);
    if (match) {
      issues.push(
        issue(
          '说明腔',
          '中',
          match[0],
          '直接说明情绪或困境，缺少动作与触觉承载。',
          '用身体反应、动作选择或对白压力呈现情绪。',
        ),
      );
      break;
    }
  }
  const emotionHits = EMOTION_WORDS.filter((word) => prose.includes(word));
  if (emotionHits.length >= 2) {
    issues.push(
      issue(
        '情绪直述',
        '中',
        emotionHits.slice(0, 4).join('、'),
        '抽象情绪词密集出现，读者只能被告知而非看见。',
        '保留情绪方向，但改成动作、环境反馈和对白潜台词。',
      ),
    );
  }
  return issues;
}

function checkExposition(prose: string): StaticProseIssue[] {
  const hits = EXPLANATION_MARKERS.filter((marker) => countOf(prose, marker) >= 2);
  if (!hits.length) return [];
  return [
    issue(
      '解释性旁白',
      '低',
      hits.join('、'),
      '解释性连接词偏多，容易形成作者代讲。',
      '让信息通过冲突行动、对白和场景物件自然暴露。',
      'scene_patch',
    ),
  ];
}

function checkDialogueDensity(prose: string): StaticProseIssue[] {
  const visible = length(prose.replace(WHITESPACE_RUN, ''));
  if (visible < 40) return [];
  let quoted = 0;
  for (const match of prose.matchAll(DIALOGUE_PATTERN)) quoted += length(match[0]);
  const ratio = quoted / Math.max(visible, 1);
  if (ratio < 0.08 && visible >= 80)
    return [
      issue(
        '对白密度',
        '低',
        slice(prose, 0, 32),
        '对白不足，信息可能被旁白单向交代。',
        '加入有明确目的的对白，让角色在压力中交换信息。',
        'scene_patch',
      ),
    ];
  if (ratio > 0.82)
    return [
      issue(
        '对白密度',
        '低',
        slice(prose, 0, 32),
        '叙述不足，场景缺少动作、环境和节奏落点。',
        '在对白间补入动作反应和感官锚点。',
        'scene_patch',
      ),
    ];
  return [];
}

function checkSentenceLength(prose: string): StaticProseIssue[] {
  const sentences = prose.split(SENTENCE_SPLIT).filter((item) => pythonStrip(item));
  if (!sentences.length) return [];
  const longSentence = sentences.find((item) => length(item) > 90) ?? '';
  if (longSentence)
    return [
      issue(
        '句长',
        '低',
        slice(longSentence, 0, 36),
        '单句过长，动作和信息层次容易糊在一起。',
        '按动作、感知和转折拆分句子。',
      ),
    ];
  if (
    sentences.length >= 6 &&
    sentences.filter((item) => length(item) <= 8).length / sentences.length > 0.75
  )
    return [
      issue(
        '句长',
        '低',
        sentences.slice(0, 4).join('。'),
        '短句连续堆叠，节奏机械。',
        '合并部分静态短句，并加入动作推进。',
        'scene_patch',
      ),
    ];
  return [];
}

function checkRepetition(prose: string): StaticProseIssue[] {
  const chars = points(prose);
  const counts = new Map<string, number>();
  for (let index = 0; index < Math.max(chars.length - 3, 0); index++) {
    const chunk = chars.slice(index, index + 4).join('');
    counts.set(chunk, (counts.get(chunk) ?? 0) + 1);
  }
  const repeated = [...counts].find(
    ([chunk, count]) => count >= 3 && new Set(points(chunk)).size > 1,
  );
  if (!repeated) return [];
  return [
    issue(
      '重复表达',
      '低',
      repeated[0],
      '短窗口表达重复，可能显得机械或注水。',
      '保留必要信息，改写重复句式和词组。',
    ),
  ];
}

function checkCharacterConsistency(
  prose: string,
  constraints: NonNullable<ProseConstraints['characterConstraints']>,
): StaticProseIssue[] {
  const issues: StaticProseIssue[] = [];
  for (const entry of constraints) {
    const forbidden = entry.forbidden_traits;
    if (!Array.isArray(forbidden)) continue;
    const hits = forbidden
      .map((item) => pythonStrip(item))
      .filter((item) => item && prose.includes(item));
    if (hits.length)
      issues.push(
        issue(
          '角色一致性',
          '严重',
          hits.join('、'),
          '正文命中角色禁止表现，存在 OOC 风险。',
          '回到角色约束，重写违背人设的动作和对白。',
          'regenerate',
        ),
      );
  }
  return issues;
}

function keyTerms(text: string): string[] {
  const terms = text.split(KEY_TERM_SPLIT).filter((part) => length(part) >= 2);
  if (terms.length) return terms;
  return text ? [text] : [];
}

function factText(item: string | { statement?: string | null }): string {
  return pythonStrip(typeof item === 'string' ? item : item.statement || '');
}

function checkContinuity(
  prose: string,
  continuityFacts: NonNullable<ProseConstraints['continuityFacts']>,
  requiredFacts: readonly string[],
): StaticProseIssue[] {
  for (const fact of [...continuityFacts, ...requiredFacts].map(factText)) {
    if (!fact) continue;
    const terms = keyTerms(fact);
    const negated =
      NEGATION_MARKERS.some((marker) => prose.includes(marker)) &&
      terms.some((term) => prose.includes(term));
    const missingRequired =
      requiredFacts.includes(fact) && !terms.slice(0, 2).some((term) => prose.includes(term));
    if (negated || missingRequired)
      return [
        issue(
          '连续性',
          negated ? '严重' : '高',
          fact,
          '正文与连续性事实或必含事实不一致。',
          '保留既定事实，删除矛盾表述后重写相关段落。',
          negated ? 'regenerate' : 'scene_patch',
        ),
      ];
  }
  return [];
}

function checkProgression(
  prose: string,
  sceneBeats: readonly string[],
  endingHook: string,
): StaticProseIssue[] {
  const issues: StaticProseIssue[] = [];
  if (sceneBeats.length) {
    const matched = sceneBeats.filter((beat) =>
      keyTerms(beat).some((term) => prose.includes(term)),
    ).length;
    if (matched === 0)
      issues.push(
        issue(
          '推进',
          '中',
          sceneBeats.slice(0, 3).join(' / '),
          '正文未体现计划中的动作 beat，场景可能停滞。',
          '补入至少一个会改变局势的动作或转折。',
          'scene_patch',
        ),
      );
  }
  const actionCount = ACTION_MARKERS.reduce((sum, marker) => sum + countOf(prose, marker), 0);
  if (length(prose) >= 45 && actionCount <= 2)
    issues.push(
      issue(
        '节奏',
        '中',
        slice(prose, 0, 36),
        '静态描述偏多，缺少行动 beat。',
        '加入目标、阻碍和段末变化，推动下一段。',
        'scene_patch',
      ),
    );
  const tail = slice(prose, -40);
  if (endingHook && !keyTerms(endingHook).some((term) => tail.includes(term)))
    issues.push(
      issue(
        '节奏',
        '低',
        endingHook,
        '结尾未兑现计划钩子，段落收束力不足。',
        '把钩子放入末段，并让它改变下一步行动。',
        'scene_patch',
      ),
    );
  return issues;
}

/** 可重复的小说坏味道检查，不依赖模型或外部 NLP。 */
export function checkProseStaticQuality(
  text: string,
  constraints: ProseConstraints = {},
): StaticProseIssue[] {
  const prose = pythonStrip(text);
  if (!prose)
    return [
      issue(
        '正文完整性',
        '严重',
        '（空）',
        '正文为空，无法进入质量评审。',
        '重新生成本场景正文。',
        'regenerate',
      ),
    ];
  const issues = [
    ...checkCliches(prose),
    ...checkTelling(prose),
    ...checkExposition(prose),
    ...checkDialogueDensity(prose),
    ...checkSentenceLength(prose),
    ...checkRepetition(prose),
    ...checkCharacterConsistency(prose, constraints.characterConstraints ?? []),
    ...checkContinuity(prose, constraints.continuityFacts ?? [], constraints.requiredFacts ?? []),
    ...checkProgression(prose, constraints.sceneBeats ?? [], constraints.endingHook ?? ''),
    ...checkParagraphPatterns(prose),
  ];
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = JSON.stringify([item.dimension, item.severity, item.snippet]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function counter(values: readonly string[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return output;
}

/** 项目内单个稿件的确定性文笔气味扫描；空文件显式报错，不伪造「无问题」。 */
export async function proseStaticScan(reader: ProjectReader, root: string, path: string) {
  await resolveProjectRoot(reader, root);
  const target = await resolveScopedPath(reader, root, path);
  if ((await reader.inspectProjectPath(root, target)).targetKind !== 'file')
    throw new FsToolError(`不是文件：${path}`);
  const rawContent = (await readBoundedText(reader, root, target, MAX_FILE_BYTES)).content;
  if (!pythonStrip(rawContent)) throw new FsToolError(`文件没有可检查的内容：${path}`);
  const content = slice(rawContent, 0, CONTENT_CHAR_BUDGET);
  const issues = checkProseStaticQuality(content);
  return {
    path: target,
    content_chars: length(content),
    content_truncated: length(rawContent) > CONTENT_CHAR_BUDGET,
    issue_count: issues.length,
    issues,
    dimension_counts: counter(issues.map((item) => item.dimension)),
    severity_counts: counter(issues.map((item) => item.severity)),
    note:
      '文笔气味是确定性观察信号（无 LLM）：是否采纳由你结合上下文判断，' +
      '别照单全收；修改仍需走待确认补丁流程。',
  };
}
