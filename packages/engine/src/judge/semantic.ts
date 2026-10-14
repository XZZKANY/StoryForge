import {
  dumpJson,
  InputDomainError,
  isJsonObject,
  JsonFloat,
  parseJson,
  pythonFloatRepr,
  pythonTruthy,
  type JsonValue,
} from '../kernel/json';
import { pythonSplitlines, pythonStrip } from '../kernel/pythonText';
import { envValue, type LlmSource } from '../llm/config';
import { RunInterrupted } from '../llm/control';
import { pythonStrRepr } from '../llm/pythonRepr';
import { RequestEvidenceError } from '../loop/requestEvidence';
import { JUDGE_FEW_SHOT, JUDGE_SYSTEM_PROMPT } from './prompts';

type Obj = { [key: string]: unknown };

/** 语义评审入参（judge.schemas.SemanticJudgeInput，不落 judge 实体）。 */
export type SemanticJudgeInput = {
  readonly content: string;
  readonly required_facts: readonly string[];
  readonly style_rules: readonly string[];
  readonly evidence_links: readonly Obj[];
};

export type DetectedIssue = {
  readonly category: string;
  readonly severity: string;
  readonly span_start: number;
  readonly span_end: number;
  readonly summary: string;
  readonly recommended_repair_mode: string;
  readonly expected_text: string;
  readonly replacement_text: string;
  readonly matched_text: string;
};

/** failed：远程调用本身出错；configured=false：没配 key、评审没跑。两者都不能当成「干净通过」。 */
export type SemanticJudgeOutcome = {
  readonly issues: DetectedIssue[];
  readonly failed: boolean;
  readonly configured: boolean;
};

/** 一次评审请求（生产绑定引擎的 callLlmMessages，并挂在 judge.semantic 操作下记证据）。 */
export type SemanticJudgeCall = (
  source: LlmSource,
  options: { messages: Obj[]; timeoutSeconds: number; maxAttempts: number },
) => Promise<Obj>;

/** Python repr()：评审提示里的事实 / 规则 / 证据链接按 Python 列表字面量写。 */
export function pythonRepr(value: unknown): string {
  if (value === undefined || value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return pythonStrRepr(value);
  if (typeof value === 'number') return String(value);
  if (value instanceof JsonFloat) return pythonFloatRepr(value.value);
  if (Array.isArray(value)) return `[${value.map(pythonRepr).join(', ')}]`;
  return `{${Object.entries(value as Obj)
    .map(([key, item]) => `${pythonStrRepr(key)}: ${pythonRepr(item)}`)
    .join(', ')}}`;
}

/** Python str()：字符串原样，其余同 repr。 */
const pythonStr = (value: unknown): string =>
  typeof value === 'string' ? value : pythonRepr(value);

const PY_TYPE_NAMES: [(value: unknown) => boolean, string][] = [
  [(value) => value === null || value === undefined, 'NoneType'],
  [Array.isArray, 'list'],
  [(value) => typeof value === 'object', 'dict'],
];

/** Python int()：只认 ASCII 数字（可带空白、符号与下划线分隔），浮点向零取整，布尔是 0 / 1。 */
export function pythonInt(value: unknown): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Math.trunc(value);
  if (value instanceof JsonFloat) return Math.trunc(value.value);
  if (typeof value === 'string') {
    const text = pythonStrip(value);
    if (/^[+-]?\d+(?:_\d+)*$/.test(text)) return Number(text.replace(/_/g, ''));
    throw new RangeError(`invalid literal for int() with base 10: ${pythonStrRepr(value)}`);
  }
  const name = PY_TYPE_NAMES.find(([test]) => test(value))?.[1] ?? 'object';
  throw new TypeError(
    `int() argument must be a string, a bytes-like object or a real number, not '${name}'`,
  );
}

const points = (text: string) => Array.from(text);

/** 从模型响应里取 JSON：纯 JSON、代码块包裹、夹在说明文字里的第一个数组。 */
function decodeSemanticJudgeContent(rawContent: string): unknown {
  const stripped = pythonStrip(rawContent);
  const tryParse = (text: string) => {
    try {
      return { ok: true as const, value: parseJson(text, 'judge') as unknown };
    } catch (error) {
      if (!(error instanceof InputDomainError)) throw error;
      return { ok: false as const };
    }
  };
  const direct = tryParse(stripped);
  if (direct.ok) return direct.value;
  const fenced = stripJsonMarkdownFence(stripped);
  if (fenced !== stripped) {
    const parsed = tryParse(fenced);
    if (parsed.ok) return parsed.value;
  }
  const fragment = firstJsonArrayFragment(stripped);
  if (fragment !== null) return parseJson(fragment, 'judge');
  return parseJson(stripped, 'judge');
}

function stripJsonMarkdownFence(content: string): string {
  const lines = pythonSplitlines(content);
  if (
    lines.length >= 2 &&
    ['```json', '```'].includes(pythonStrip(lines[0]).toLowerCase()) &&
    pythonStrip(lines[lines.length - 1]) === '```'
  )
    return pythonStrip(lines.slice(1, -1).join('\n'));
  return content;
}

/** 文本里的第一个 JSON 数组片段（认得字符串里的转义与括号）。 */
function firstJsonArrayFragment(content: string): string | null {
  const start = content.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index++) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return null;
}

/** 以 matched_text 反查正文真实偏移；多处命中取离模型自报位置最近的一处（码点下标）。 */
function locateMatchedSpan(
  content: string[],
  matchedText: string,
  hintStart: number,
): [number, number] | null {
  const needle = points(pythonStrip(matchedText));
  if (!needle.length) return null;
  let best: [number, number] | null = null;
  for (let index = 0; index + needle.length <= content.length; index++) {
    if (!needle.every((char, offset) => content[index + offset] === char)) continue;
    if (best === null || Math.abs(index - hintStart) < Math.abs(best[0] - hintStart))
      best = [index, index + needle.length];
  }
  return best;
}

/** 模型条目规整成内部问题，越界位置一律夹回正文范围。 */
function issueFromLlmItem(item: Obj, content: string): DetectedIssue {
  const chars = points(content);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(item, key);
  let spanStart = Math.max(
    0,
    Math.min(pythonInt(has('span_start') ? item.span_start : 0), chars.length),
  );
  let spanEnd = Math.max(
    spanStart,
    Math.min(pythonInt(has('span_end') ? item.span_end : spanStart), chars.length),
  );
  const truthy = (value: unknown) => pythonTruthy(value as JsonValue);
  const rawMatched = truthy(item.matched_text) ? pythonStr(item.matched_text) : '';
  const located = locateMatchedSpan(chars, rawMatched, spanStart);
  if (located !== null) [spanStart, spanEnd] = located;
  const category = has('category') ? pythonStr(item.category) : 'setting_conflict';
  const severity = has('severity') ? pythonStr(item.severity) : 'medium';
  const matchedText = rawMatched || chars.slice(spanStart, spanEnd).join('');
  const expectedText = has('expected_text') ? pythonStr(item.expected_text) : '';
  return {
    category,
    severity: ['low', 'medium', 'high'].includes(severity) ? severity : 'medium',
    span_start: spanStart,
    span_end: spanEnd,
    summary: truthy(item.summary) ? pythonStr(item.summary) : `模型发现 ${category}。`,
    recommended_repair_mode: 'replace_span',
    expected_text: expectedText,
    replacement_text: truthy(item.replacement_text)
      ? pythonStr(item.replacement_text)
      : expectedText,
    matched_text: matchedText,
  };
}

const truthyText = (value: unknown) => typeof value === 'string' && value !== '';

/**
 * 语义一致性评审（judge.semantic.semantic_judge_with_status）。
 * STORYFORGE_JUDGE_LLM_* 覆盖从配置源读（Python 读进程环境）；桌面配置源不带这些键，实际走主模型。
 */
export async function semanticJudgeWithStatus(
  payload: SemanticJudgeInput,
  options: {
    source: LlmSource;
    call: SemanticJudgeCall;
    characterVoiceConstraints?: readonly Obj[] | null;
  },
): Promise<SemanticJudgeOutcome> {
  const { source } = options;
  const judge = (name: string) => source[`STORYFORGE_JUDGE_LLM_${name}`];
  const pick = (name: string, fallback: string) => {
    const override = judge(name);
    return truthyText(override) ? (override as string) : fallback;
  };
  const apiKey = pick('API_KEY', envValue(source, 'STORYFORGE_LLM_API_KEY'));
  if (!apiKey) return { issues: [], failed: false, configured: false };
  const baseUrl =
    pick('BASE_URL', envValue(source, 'STORYFORGE_LLM_BASE_URL')) || 'https://api.openai.com/v1';
  const model = pick('MODEL', envValue(source, 'STORYFORGE_LLM_MODEL')) || 'gpt-4o-mini';
  const constraints = options.characterVoiceConstraints ?? null;
  const voiceSection =
    constraints && constraints.length
      ? `\n角色声音约束：${dumpJson(constraints, { ensureAscii: false })}`
      : '';
  const userPrompt =
    `${JUDGE_FEW_SHOT}\n\n` +
    `## 待评审正文\n${payload.content}\n` +
    `必含事实：${pythonRepr(payload.required_facts)}\n` +
    `风格规则：${pythonRepr(payload.style_rules)}\n` +
    `证据链接：${pythonRepr(payload.evidence_links)}` +
    voiceSection;
  const messages = [
    { role: 'system', content: JUDGE_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
  const reasoningEffort = pick(
    'REASONING_EFFORT',
    envValue(source, 'STORYFORGE_LLM_REASONING_EFFORT'),
  );
  const timeoutText =
    pick('TIMEOUT_SECONDS', envValue(source, 'STORYFORGE_LLM_TIMEOUT_SECONDS')) || '300';
  const trimmedBase = pythonStrip(baseUrl).replace(/\/+$/, '');
  const requestSource: { [key: string]: string | null | undefined } = {};
  for (const [key, value] of Object.entries(source))
    if (!key.startsWith('STORYFORGE_JUDGE_LLM_')) requestSource[key] = value;
  Object.assign(requestSource, {
    STORYFORGE_LLM_API_KEY: apiKey,
    STORYFORGE_LLM_BASE_URL: trimmedBase,
    STORYFORGE_LLM_AUTH_HEADER: 'bearer',
    // 这些端点历来用 OpenAI 线格式，与产字配置无关。
    STORYFORGE_LLM_PROVIDER: 'openai-compatible',
    STORYFORGE_LLM_MODEL: model,
    STORYFORGE_LLM_TEMPERATURE: '0',
    STORYFORGE_LLM_MAX_COMPLETION_TOKENS: '0',
    STORYFORGE_LLM_REASONING_EFFORT: reasoningEffort,
  });
  // 产字的价格不能给另一个评审模型 / 端点 / 账号定价。
  const pricingMatches =
    model === envValue(source, 'STORYFORGE_LLM_MODEL') &&
    trimmedBase === pythonStrip(envValue(source, 'STORYFORGE_LLM_BASE_URL')).replace(/\/+$/, '') &&
    apiKey === envValue(source, 'STORYFORGE_LLM_API_KEY');
  if (!pricingMatches)
    for (const key of Object.keys(requestSource))
      if (key.endsWith('_CNY_PER_M_TOKENS')) delete requestSource[key];
  const timeoutSeconds = Number(timeoutText);
  if (!Number.isFinite(timeoutSeconds) || !/\d/.test(timeoutText))
    throw new RangeError(`could not convert string to float: ${pythonStrRepr(timeoutText)}`);
  let decoded: unknown;
  try {
    const data = await options.call(requestSource, { messages, timeoutSeconds, maxAttempts: 1 });
    decoded = decodeSemanticJudgeContent(pythonStr(data.content));
  } catch (error) {
    if (error instanceof RunInterrupted || error instanceof RequestEvidenceError) throw error;
    return { issues: [], failed: true, configured: true };
  }
  if (!Array.isArray(decoded)) return { issues: [], failed: true, configured: true };
  const valid = decoded.filter(
    (item): item is Obj =>
      isJsonObject(item as never) && Object.prototype.hasOwnProperty.call(item, 'category'),
  );
  return {
    issues: valid.map((item) => issueFromLlmItem(item, payload.content)),
    failed: false,
    configured: true,
  };
}
