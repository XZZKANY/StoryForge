import {
  authorEditPolicyFailures,
  authorEditPolicyPrompt,
  authorEditPolicySummary,
  buildAuthorEditPolicy,
  type AuthorEditPolicy,
} from '../../kernel/authorEditPolicy';
import { dumpJson, InputDomainError, isJsonObject, JsonFloat, parseJson } from '../../kernel/json';
import {
  applyDeterministicPolish,
  POLISH_GATE_VERSION,
  POLISH_RULE_VERSION,
  polishableParts,
  rebuildPolishableMarkdown,
  selectPolishCandidate,
  splitPolishableMarkdown,
  type PolishCandidate,
  type PolishDecision,
  type PolishFacts,
} from '../../kernel/polishing';
import { PYTHON_WHITESPACE, pythonStrip } from '../../kernel/pythonText';
import { envValue, type LlmSource } from '../../llm/config';
import { ChatMessage, ProviderError, type ChatRequest, type TokenUsage } from '../../llm/contracts';
import type { LlmProvider } from '../../llm/openaiCompatible';
import { LlmError } from '../../llm/payload';

type Obj = { [key: string]: unknown };

/** 专用润色模型槽位不完整，且作者没有授权本次借用主模型。 */
export class PolishLlmNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolishLlmNotConfiguredError';
  }
}

export class InvalidPolishModelResponseError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPolishModelResponseError';
  }
}

export type PolishSlot = 'main' | 'polish';

/**
 * 两个模型槽：主模型与专用润色槽（只有身份四项，键名已映射成 STORYFORGE_LLM_*）。
 * provider 按槽出网（生产里 Rust 按槽换真 key），并绑定本次 run 的运行控制与模型观察。
 */
export type PolishModels = {
  readonly main: LlmSource;
  readonly dedicated: LlmSource;
  provider(slot: PolishSlot, source: LlmSource): LlmProvider;
};

export type ResolvedPolishLlm = {
  readonly resolutionSource: 'dedicated' | 'explicit_main_model_override';
  readonly provider: string;
  readonly model: string;
  readonly source: LlmSource;
  readonly slot: PolishSlot;
};

const REQUIRED_SLOT_KEYS = [
  'STORYFORGE_LLM_PROVIDER',
  'STORYFORGE_LLM_BASE_URL',
  'STORYFORGE_LLM_MODEL',
  'STORYFORGE_LLM_API_KEY',
];

function requiredSlotIdentity(source: LlmSource, label: string): [string, string] {
  const missing = REQUIRED_SLOT_KEYS.filter((name) => !envValue(source, name));
  if (missing.length)
    throw new PolishLlmNotConfiguredError(`${label}配置不完整：缺少 ${missing.join(', ')}。`);
  return [
    envValue(source, 'STORYFORGE_LLM_PROVIDER').toLowerCase(),
    envValue(source, 'STORYFORGE_LLM_MODEL'),
  ];
}

/** 解析专用润色槽；缺失时只允许作者显式借用本次主模型（llm_env.resolve_polish_llm）。 */
export function resolvePolishLlm(models: PolishModels, useMainModel: boolean): ResolvedPolishLlm {
  if (useMainModel) {
    const [provider, model] = requiredSlotIdentity(models.main, '主模型');
    return {
      resolutionSource: 'explicit_main_model_override',
      provider,
      model,
      source: models.main,
      slot: 'main',
    };
  }
  let identity: [string, string];
  try {
    identity = requiredSlotIdentity(models.dedicated, '专用润色模型');
  } catch (error) {
    if (!(error instanceof PolishLlmNotConfiguredError)) throw error;
    throw new PolishLlmNotConfiguredError(
      '尚未配置专用润色模型；请先在设置中配置，或明确选择本次使用主模型。',
    );
  }
  const [provider, model] = identity;
  return {
    resolutionSource: 'dedicated',
    provider,
    model,
    source: models.dedicated,
    slot: 'polish',
  };
}

export type ControlledPolishResult = {
  readonly decision: PolishDecision;
  readonly provider: string | null;
  readonly model: string | null;
  readonly resolutionSource: string | null;
  readonly onlineFailure: string | null;
  readonly onlineAttempted: boolean;
  readonly usage: Obj;
  readonly editPolicySummary: Obj;
};

/** 证据与轨迹里的润色摘要（ControlledPolishResult.trace_summary）。 */
export function polishTraceSummary(result: ControlledPolishResult): Obj {
  const { decision } = result;
  const evaluations = Object.entries(decision.evaluations);
  return {
    status: decision.status,
    selected_source: decision.selected_source,
    degraded: decision.degraded,
    provider: result.provider,
    model: result.model,
    resolution_source: result.resolutionSource,
    online_attempted: result.onlineAttempted,
    online_failure: result.onlineFailure,
    rule_version: POLISH_RULE_VERSION,
    gate_version: POLISH_GATE_VERSION,
    gate_reasons: Object.fromEntries(
      evaluations.map(([source, item]) => [source, [...item.reasons]]),
    ),
    gate_advisories: Object.fromEntries(
      evaluations.map(([source, item]) => [source, [...item.advisories]]),
    ),
    edit_policy: { ...result.editPolicySummary },
    usage: { ...result.usage },
  };
}

type PolishOptions = PolishFacts & {
  styleInstruction?: string;
  useMainModel?: boolean;
  onlineEnabled?: boolean;
  editPolicy?: AuthorEditPolicy | null;
  models: PolishModels;
};

/** 本地确定性候选 + 可选在线候选，经相对原文质量门禁选一个（polishing_service.run_controlled_polish）。 */
export async function runControlledPolish(
  original: string,
  options: PolishOptions,
): Promise<ControlledPolishResult> {
  const styleInstruction = options.styleInstruction ?? '';
  const onlineEnabled = options.onlineEnabled ?? true;
  const facts: PolishFacts = {
    protectedEntities: options.protectedEntities ?? [],
    characterConstraints: options.characterConstraints ?? [],
    continuityFacts: options.continuityFacts ?? [],
    requiredFacts: options.requiredFacts ?? [],
  };
  const policy =
    options.editPolicy ?? buildAuthorEditPolicy(original, { instruction: styleInstruction });
  const failures = authorEditPolicyFailures(original, original, policy);
  if (failures.length) throw new RangeError('编辑政策不适用于当前正文：' + failures.join(', '));
  const local: PolishCandidate = {
    source: 'local',
    text: applyDeterministicPolish(original, policy),
  };
  let online: PolishCandidate | null = null;
  let onlineFailure: string | null = null;
  let usage: Obj = {};
  let resolved: ResolvedPolishLlm | null = null;
  if (onlineEnabled) {
    try {
      resolved = resolvePolishLlm(options.models, options.useMainModel ?? false);
      const provider = options.models.provider(resolved.slot, resolved.source);
      const request = polishRequest(original, resolved.model, styleInstruction, facts, policy);
      const response = await provider.complete(request);
      online = {
        source: 'online',
        text: parsePolishedResponse(original, response.content, policy),
        responseTruncated: response.finishReason === 'length',
        responseFiltered: response.finishReason === 'content_filter',
      };
      usage = safeUsage(response.usage);
    } catch (error) {
      if (error instanceof PolishLlmNotConfiguredError)
        onlineFailure = 'polish_model_not_configured';
      else if (error instanceof InvalidPolishModelResponseError)
        onlineFailure = 'invalid_model_response';
      else if (error instanceof LlmError || error instanceof ProviderError)
        onlineFailure = 'provider_failed';
      else throw error;
    }
  }
  let decision = selectPolishCandidate(original, {
    ...facts,
    localCandidate: local,
    onlineCandidate: online,
    editPolicy: policy,
  });
  if (onlineEnabled && onlineFailure && decision.selected_source === 'local')
    decision = { ...decision, status: 'degraded', degraded: true };
  return {
    decision,
    provider: resolved ? resolved.provider : null,
    model: resolved ? resolved.model : null,
    resolutionSource: resolved ? resolved.resolutionSource : null,
    onlineFailure,
    onlineAttempted: onlineEnabled,
    usage,
    editPolicySummary: authorEditPolicySummary(policy),
  };
}

function polishRequest(
  original: string,
  model: string,
  styleInstruction: string,
  facts: PolishFacts,
  policy: AuthorEditPolicy,
): ChatRequest {
  const document = splitPolishableMarkdown(original, policy.protected_spans);
  const payload = {
    constraints: {
      protected_entities: [...(facts.protectedEntities ?? [])],
      character_constraints: [...(facts.characterConstraints ?? [])],
      continuity_facts: [...(facts.continuityFacts ?? [])],
      required_facts: [...(facts.requiredFacts ?? [])],
    },
    segments: polishableParts(document).map((text, index) => ({ index, text })),
  };
  const style = pythonStrip(styleInstruction);
  const system = [
    '你是中文通俗小说润色编辑。只改善表达，不改剧情事实、人物关系、因果、专名、叙事人称和段落顺序。',
    '默认保守润色：清理模板腔，改善句式、节奏、对白与自然度，保留作者原有文风。',
    '不得添加标题、frontmatter、代码围栏、解释、摘要或修改说明。',
    '输入是正文片段数组；按原 index 返回同样数量的 JSON 片段，不能合并、丢失或重排。',
    'constraints 是只读写作约束：不得改写专名，不得违反人物和连续性事实，也不得把未出现的约束强行补写进正文。',
    '只输出严格 JSON：{"segments":[{"index":0,"text":"..."}]}。',
    style ? `作者本次附加风格要求：${style}` : '作者本次没有附加风格要求。',
    authorEditPolicyPrompt(policy),
  ].join('\n');
  return {
    model,
    messages: [
      new ChatMessage('system', system),
      new ChatMessage('user', dumpJson(payload, { ensureAscii: false })),
    ],
    tools: [],
    temperature: 0.35,
    maxTokens: null,
    toolChoice: null,
    reasoningEffort: null,
  };
}

const JSON_FENCE = new RegExp(
  `^${PYTHON_WHITESPACE}*\`\`\`(?:json)?${PYTHON_WHITESPACE}*([\\s\\S]*?)${PYTHON_WHITESPACE}*\`\`\`${PYTHON_WHITESPACE}*$`,
  'iu',
);

/** Python 的 `item.get("index") != expected`：True == 1、2.0 == 2。 */
function sameIndex(value: unknown, expected: number): boolean {
  if (typeof value === 'boolean') return Number(value) === expected;
  if (value instanceof JsonFloat) return value.value === expected;
  return value === expected;
}

function parsePolishedResponse(
  original: string,
  content: string,
  policy: AuthorEditPolicy,
): string {
  let raw = pythonStrip(content);
  const fenced = JSON_FENCE.exec(raw);
  if (fenced !== null) raw = fenced[1];
  let payload: unknown;
  try {
    payload = parseJson(raw, 'polish');
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    throw new InvalidPolishModelResponseError('model response is not JSON');
  }
  const items = isJsonObject(payload as never) ? (payload as Obj).segments : undefined;
  if (!Array.isArray(items)) throw new InvalidPolishModelResponseError('segments are missing');
  const document = splitPolishableMarkdown(original, policy.protected_spans);
  const expected = polishableParts(document).length;
  const parts = items.map((item, index) => {
    if (!isJsonObject(item) || !sameIndex(item.index, index))
      throw new InvalidPolishModelResponseError('segment indexes changed');
    if (typeof item.text !== 'string')
      throw new InvalidPolishModelResponseError('segment text is missing');
    return item.text;
  });
  if (parts.length !== expected) throw new InvalidPolishModelResponseError('segment count changed');
  return rebuildPolishableMarkdown(document, parts);
}

function safeUsage(usage: TokenUsage): Obj {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    cached_input_tokens: usage.cachedInputTokens,
    source: usage.source,
  };
}

const ONLINE_FAILURE_TEXT: { [code: string]: string } = {
  polish_model_not_configured: '专用润色模型尚未配置',
  provider_failed: '润色模型这次调用失败',
  invalid_model_response: '润色模型返回的结果格式不对、没法用',
};

export function polishSummary(result: ControlledPolishResult): string {
  const { status } = result.decision;
  if (status === 'accepted') return '润色候选已通过相对原文质量门禁，已生成可审阅补丁。';
  if (status === 'degraded') return '在线候选不可用或未通过门禁，已生成明确标注的本地降级补丁。';
  if (status === 'noop') {
    // 在线没调通、本地规则又没改动时也是 noop：要让作者知道模型失败了，不能说成「候选一致」。
    const failure = ONLINE_FAILURE_TEXT[result.onlineFailure ?? ''];
    if (failure) return `${failure}，本地规则也没有产生改动；原文保持不变。`;
    return '润色候选与原文一致，没有生成空补丁。';
  }
  if (result.onlineFailure === 'polish_model_not_configured')
    return '专用润色模型尚未配置，且本地规则没有产生合格改动；原文保持不变。';
  return '在线与本地候选均未通过质量门禁，原文保持不变。';
}

/** 润色目标路径必须是项目内相对的 Markdown / TXT 正文，结构化与派生目录一律拒绝。 */
export function validatePolishablePath(path: string): string {
  const normalized = pythonStrip(path.replace(/\\/g, '/'));
  const parts = normalized.split('/').filter((part) => part !== '' && part !== '.');
  const absolute = normalized.startsWith('/');
  if (
    !normalized ||
    absolute ||
    parts.includes('..') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes('://')
  )
    throw new RangeError('润色目标必须是项目内相对路径。');
  const forbidden = new Set([
    '.storyforge',
    'evidence',
    'evidences',
    'artifacts',
    'exports',
    'cache',
    'logs',
  ]);
  if (parts.some((part) => forbidden.has(part.toLowerCase())))
    throw new RangeError('结构化状态、证据和派生文件不能进入润色流程。');
  const name = parts.length ? parts[parts.length - 1] : '';
  const dot = name.lastIndexOf('.');
  const suffix = dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : '';
  if (!['.md', '.markdown', '.txt'].includes(suffix))
    throw new RangeError('润色仅支持 Markdown 或 TXT 小说正文。');
  return parts.join('/');
}
