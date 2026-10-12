import {
  authorEditPolicyFailures,
  authorEditPolicyPrompt,
  buildAuthorEditPolicy,
  type AuthorEditPolicy,
} from '../kernel/authorEditPolicy';
import { craftPromptClause, sceneDisciplineGuardClause } from '../kernel/craft';
import {
  DEFAULT_POLISH_GATE_CONFIG,
  evaluatePolishCandidate,
  type PolishGateConfig,
  type PolishGateResult,
} from '../kernel/polishing';
import { restoreIncidentalPunctuation } from '../kernel/punctuation';

/** 修订能力：只消费已准备的值；生成 I/O 由调用方显式注入。不读项目文件、不写会话或原稿。 */

export type RevisionContextFile = { relative_path: string; kind: string; excerpt: string };

export type RevisionInput = {
  filePath: string;
  content: string;
  instruction: string;
  systemPrompt: string;
  projectName?: string | null;
  contextFiles?: readonly RevisionContextFile[];
  sceneConstraints?: string | null;
  qualityGate?: 'polish' | null;
  editPolicy?: AuthorEditPolicy | null;
};

/** 已绑定模型配置的完整正文生成器；生产用流式聚合传输。 */
export type RevisionGenerator = (prompts: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ [key: string]: unknown }>;

export type RevisionResult = {
  after: string;
  telemetry: { [key: string]: unknown };
  qualityGate: PolishGateResult | null;
};

/** 只暴露拒绝依据，不把失败候选交给调用方当作可用正文。 */
export class RevisionQualityRejected extends Error {
  constructor(readonly gate: PolishGateResult) {
    super('润色候选未通过质量门禁：' + gate.reasons.join(', '));
    this.name = 'RevisionQualityRejected';
  }
}

export const REVISION_SYSTEM_PROMPT =
  '你是 StoryForge 的中文长篇创作编辑。' +
  '用户会给你一份正在编辑的文件全文与一条修订指令。' +
  '请严格按指令修订，保持原有结构、人物与设定的连贯性。' +
  '默认只改动指令直接涉及的部分，未点名的段落、句子与标题尽量逐字保留，不要无谓改写或扩大改动范围。' +
  craftPromptClause() +
  '创作准则约束的是你这次落笔改写的那些句子；它不构成扩大改动范围的理由，' +
  '未点名段落即便不合准则也保持原样，由作者另行提出。' +
  sceneDisciplineGuardClause() +
  '只输出修订后的完整正文，不要输出解释、前后缀或代码块标记。';

export function buildRevisionPrompt(request: RevisionInput): string {
  const projectLine = request.projectName ? `项目：${request.projectName}\n` : '';
  const files = request.contextFiles ?? [];
  const contextBlock = files.length
    ? '\n项目上下文摘录：这些文件来自同一小说项目，请用于保持大纲、人物、设定与正文连贯；' +
      '如果摘录与当前文件冲突，优先保留明确的当前文件事实，并在修订中避免扩大矛盾。\n' +
      files
        .map((item) =>
          [
            `### ${item.relative_path}`,
            `- 类型：${item.kind}`,
            '<<<CONTEXT',
            item.excerpt,
            'CONTEXT>>>',
          ].join('\n'),
        )
        .join('\n\n') +
      '\n'
    : '';
  const constraintBlock = request.sceneConstraints ? `\n${request.sceneConstraints}\n` : '';
  const policy =
    request.editPolicy ??
    buildAuthorEditPolicy(request.content, { instruction: request.instruction });
  return (
    projectLine +
    `文件：${request.filePath}\n` +
    `修订指令：${request.instruction}\n\n` +
    contextBlock +
    constraintBlock +
    `\n${authorEditPolicyPrompt(policy)}\n` +
    // 不说「全文」：行间 Ctrl+K 对长章节只送锚点附近的窗口。
    '以下是待修订的正文，请按指令修订后整体返回，只返回你收到的这段：\n' +
    '<<<FILE\n' +
    `${request.content}\n` +
    'FILE>>>'
  );
}

const TELEMETRY_KEYS = [
  'prompt_tokens',
  'completion_tokens',
  'token_usage',
  'cost_cny_estimated',
  'cost_breakdown',
  'token_usage_source',
  'latency_ms',
  'reasoning_leak_stripped',
];

// 指令授权扩写时解除整窗字数上界：行间修订只送锚点附近窗口，局部扩写会让整窗比例远超 1.15。
const EXPANSION_KEYWORDS = ['扩写', '加长', '展开', '补充', '丰富', '细化'];
const ANCHOR_BLOCK = /<<<ANCHOR(?![\p{L}\p{N}_])[\s\S]*?ANCHOR>>>/gu;
const ANCHOR_OPEN = '<<<ANCHOR';
// 否定语境不构成授权；标记须紧贴关键词，避免「别怕，展开写」误判。
const NEGATION_PREFIXES = [
  '不要',
  '不',
  '别',
  '不用',
  '不必',
  '先别',
  '暂不',
  '先不',
  '无需',
  '无须',
  '切忌',
  '禁止',
  '不准',
  '不许',
  '切勿',
  '避免',
];
const NEGATION_GAP_MAX = 8;
const BARE_NEGATION_MODIFIERS = /^(?:再)?(?:需要)?(?:再|继续|进一步)*$/u;
// 单字「别」在「特别 / 分别 / 个别……」这类构词里不算否定。
const NEGATION_LEFT_GUARD = new Set('特分个级差性辨区识类');
export const EXPANSION_POLISH_GATE_CONFIG: PolishGateConfig = {
  ...DEFAULT_POLISH_GATE_CONFIG,
  max_char_ratio: Number.POSITIVE_INFINITY,
};

function stripAnchorBlocks(instruction: string): string {
  const text = instruction.replace(ANCHOR_BLOCK, '');
  // 前端把整串截到 4000，末尾 ANCHOR>>> 可能被截掉：见开标记即剥到结尾。
  const open = text.indexOf(ANCHOR_OPEN);
  return open === -1 ? text : text.slice(0, open);
}

/** Python str.find / rfind 的码点版本（索引与长度都按码点）。 */
function find(text: readonly string[], part: readonly string[], from = 0): number {
  for (let i = Math.max(from, 0); i + part.length <= text.length; i++)
    if (part.every((char, j) => text[i + j] === char)) return i;
  return -1;
}
function rfind(
  text: readonly string[],
  part: readonly string[],
  start: number,
  end: number,
): number {
  for (let i = Math.min(end, text.length) - part.length; i >= Math.max(start, 0); i--)
    if (part.every((char, j) => text[i + j] === char)) return i;
  return -1;
}

function negationReachesKeyword(
  text: readonly string[],
  index: number,
  negation: readonly string[],
  keywordStart: number,
): boolean {
  const gap = text.slice(index + negation.length, keywordStart);
  if (gap.length > NEGATION_GAP_MAX) return false;
  if (negation.join('') === '不') return BARE_NEGATION_MODIFIERS.test(gap.join(''));
  if (!gap.every((char) => char >= '一' && char <= '鿿')) return false;
  return !(negation.join('') === '别' && index >= 1 && NEGATION_LEFT_GUARD.has(text[index - 1]));
}

function negatesExpansion(text: readonly string[], start: number): boolean {
  for (const prefix of NEGATION_PREFIXES) {
    const negation = Array.from(prefix);
    const searchFrom = Math.max(0, start - NEGATION_GAP_MAX - negation.length);
    let index = rfind(text, negation, searchFrom, start);
    while (index !== -1) {
      if (negationReachesKeyword(text, index, negation, start)) return true;
      index = rfind(text, negation, searchFrom, index);
    }
  }
  return false;
}

export function instructionAuthorizesExpansion(instruction: string): boolean {
  const text = Array.from(stripAnchorBlocks(instruction));
  for (const word of EXPANSION_KEYWORDS) {
    const keyword = Array.from(word);
    let start = find(text, keyword);
    while (start !== -1) {
      if (!negatesExpansion(text, start)) return true;
      start = find(text, keyword, start + keyword.length);
    }
  }
  return false;
}

/** 一次生成 → 标点还原 → 可选门禁；模型错误原样抛给编排层。 */
export async function reviseText(
  request: RevisionInput,
  generate: RevisionGenerator,
): Promise<RevisionResult> {
  const policy =
    request.editPolicy ??
    buildAuthorEditPolicy(request.content, { instruction: request.instruction });
  let failures = authorEditPolicyFailures(request.content, request.content, policy);
  if (failures.length) throw new RevisionQualityRejected(rejected(failures, policy));
  const prompt = buildRevisionPrompt({ ...request, editPolicy: policy });
  const generated = await generate({ systemPrompt: request.systemPrompt, userPrompt: prompt });
  const after = restoreIncidentalPunctuation(request.content, String(generated.content), policy);
  failures = authorEditPolicyFailures(request.content, after, policy);
  if (failures.length) throw new RevisionQualityRejected(rejected(failures, policy));
  // 扩写放宽只在明确请求 polish 档时生效；逐字保留要求在所有修订入口都有效。
  let gate: PolishGateResult | null = null;
  if (request.qualityGate === 'polish') {
    gate = evaluatePolishCandidate(request.content, after, {
      config: instructionAuthorizesExpansion(request.instruction)
        ? EXPANSION_POLISH_GATE_CONFIG
        : null,
      editPolicy: policy,
    });
    if (!gate.passed) throw new RevisionQualityRejected(gate);
  }
  // 不带出原生响应体、头、续接或 provider 配置；保留缺失 / null / 0 的区别。
  const telemetry = Object.fromEntries(
    TELEMETRY_KEYS.filter((key) => key in generated).map((key) => [key, generated[key]]),
  );
  return { after, telemetry, qualityGate: gate };
}

function rejected(reasons: string[], policy: AuthorEditPolicy): PolishGateResult {
  return {
    passed: false,
    reasons,
    metrics: {},
    gate_version: policy.version,
    advisories: [],
  };
}
