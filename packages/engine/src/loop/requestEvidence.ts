import { dumpJson, JsonFloat, type JsonObject } from '../kernel/json';
import {
  isSensitiveKey,
  REDACTED,
  redactSensitiveText,
  type SecretContext,
} from '../kernel/redaction';
import { sha256Hex } from '../kernel/sha256';
import { providerFamily, type LlmSource } from '../llm/config';
import type { ChatRequest, TokenUsage } from '../llm/contracts';
import type { ModelAttempt, ModelObserver } from '../llm/observation';
import { withSecrets } from '../llm/payload';
import { hostInfo, urlsplit } from '../llm/protocol';
import type { RunStore } from '../store/runs';
import { AgentOrchestrationError } from './runPayloads';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const REQUEST_EVIDENCE_KIND = 'model_request_evidence';
export const REQUEST_EVIDENCE_VERSION = 1;
export const MAX_REQUEST_SNAPSHOT_BYTES = 2_000_000;
const MAX_TRANSPORT_PROGRESS = 128;
const NATIVE_STATE_KEYS = new Set([
  'continuation',
  'provider_continuation',
  'native_state',
  'thinking_blocks',
  'function_call_signatures',
  'thought_signature',
  'thoughtSignature',
]);
const PROGRESS_PHASES = new Set(['request_started', 'retry_wait', 'retry_started']);
const PROGRESS_KEYS = new Set(['phase', 'request_number', 'timeout_seconds', 'delay_seconds']);

/** 本地模型请求证据没能确认：结果需要核对，不交付、不重放。 */
export class RequestEvidenceError extends AgentOrchestrationError {
  constructor(message: string) {
    super(message);
    this.name = 'RequestEvidenceError';
  }
}

const encoded = (value: unknown) =>
  dumpJson(value, { sortKeys: true, ensureAscii: false, separators: [',', ':'] });
const digest = (value: unknown) => sha256Hex(encoded(value));
const utf8Length = (text: string) => new TextEncoder().encode(text).length;
const cpLen = (text: string) => Array.from(text).length;

/** 只认配置源里的凭据字段（Python 的 *_API_KEY / *_AUTH_TOKEN）。 */
const credentialValues = (source: LlmSource) =>
  Object.entries(source)
    .filter(([key]) => key.endsWith('_API_KEY') || key.endsWith('_AUTH_TOKEN'))
    .map(([, value]) => value);

/** 常规脱敏之后，再把凭据原文在键与值里逐字替换掉。 */
function safeEvidence(
  value: unknown,
  secrets: readonly (string | null | undefined)[],
  base: SecretContext,
): unknown {
  const context = withSecrets(base, secrets);
  const scrub = (text: string) => {
    let output = text;
    for (const secret of secrets) if (secret) output = output.split(secret).join(REDACTED);
    return output;
  };
  // 与 redactSensitive 同一套规则，只是把 JsonFloat 当叶子（请求里的 temperature 要保留浮点形态）。
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (item instanceof JsonFloat) return item;
    if (isObj(item)) {
      const output: Obj = {};
      for (const [key, child] of Object.entries(item))
        output[scrub(key)] = isSensitiveKey(key) ? REDACTED : walk(child);
      return output;
    }
    if (typeof item === 'string') return scrub(redactSensitiveText(item, context));
    return item;
  };
  return walk(value);
}

function withoutNativeState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNativeState);
  if (isObj(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        NATIVE_STATE_KEYS.has(key)
          ? { omitted: 'native_state_not_persisted' }
          : withoutNativeState(child),
      ]),
    );
  return value;
}

/** 只留协议、主机与端口；路径、查询与凭据都不进证据。 */
export function routeOrigin(source: LlmSource): string | null {
  try {
    const raw = source.STORYFORGE_LLM_BASE_URL || source.STORYFORGE_LLM_API_BASE_URL || '';
    const url = urlsplit(String(raw));
    const [rawHost, rawPort] = hostInfo(url.netloc);
    const hostname = rawHost.toLowerCase();
    if ((url.scheme !== 'https' && url.scheme !== 'http') || !hostname) return null;
    let port = 0;
    if (rawPort !== null) {
      if (!/^[0-9]+$/.test(rawPort)) return null;
      port = Number(rawPort);
      if (port > 65535) return null;
    }
    const host = hostname.includes(':') ? `[${hostname}]` : hostname;
    return `${url.scheme}://${host}${port ? `:${port}` : ''}`;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** 规范化后的请求快照：只存输入，不碰 provider 自己的续接状态。 */
export function requestSnapshot(request: ChatRequest, source: LlmSource, base: SecretContext): Obj {
  const omissions: Obj[] = [];
  const messages = request.messages.map((message, index) => {
    const item: Obj = { role: message.role, content: message.content };
    if (message.toolCalls.length)
      item.tool_calls = message.toolCalls.map((call) => call.toOpenai());
    if (message.toolCallId !== null) item.tool_call_id = message.toolCallId;
    if (message.name !== null) item.name = message.name;
    if (message.continuation !== null)
      omissions.push({
        location: `messages[${index}].continuation`,
        reason: 'native_continuation_not_persisted',
      });
    if (Object.keys(message.metadata).length)
      omissions.push({
        location: `messages[${index}].metadata`,
        reason: 'untrusted_provider_metadata_not_persisted',
      });
    return item;
  });
  const raw = request.metadata ?? {};
  const metadata = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) =>
        (key === 'operation' || key === 'prompt_version') &&
        (typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))),
    ),
  );
  if (Object.keys(metadata).length !== Object.keys(raw).length)
    omissions.push({ location: 'metadata', reason: 'untrusted_provider_metadata_not_persisted' });
  const normalized = {
    model: request.model,
    messages,
    tools: request.tools.map((tool) => tool.toOpenai()),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    tool_choice: request.toolChoice,
    reasoning_effort: request.reasoningEffort,
    metadata,
  };
  const secrets = credentialValues(source).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  const safe = safeEvidence(normalized, secrets, base) as Obj;
  const redacted = encoded(safe) !== encoded(normalized);
  if (redacted) omissions.push({ location: 'request', reason: 'secret_redacted' });
  if (utf8Length(encoded(safe)) > MAX_REQUEST_SNAPSHOT_BYTES)
    throw new AgentOrchestrationError('模型请求证据超出本地快照预算，未派发请求。');
  const safeMessages = safe.messages as Obj[];
  return {
    request: safe,
    request_digest: digest(safe),
    redacted,
    omissions,
    prompt_version: digest(safeMessages.filter((item) => item.role === 'system')),
    tool_schema_version: digest(safe.tools),
    sources: safeMessages.map((item, index) => ({
      kind: 'compiled_message',
      index,
      role: item.role,
      sha256: digest(item),
      content_chars: cpLen(typeof item.content === 'string' ? item.content : ''),
    })),
    reconstruction: {
      normalized_request:
        !redacted && !omissions.some((item) => String(item.location).includes('metadata')),
      native_wire_replay: false,
      requires_reconciliation: omissions.length > 0,
    },
  };
}

/** 一次派发对应一行证据 artifact：每次更新都整行覆盖，写不上就失败关闭。 */
class StoredAttempt implements ModelAttempt {
  private settled = false;
  private pending: Promise<void> = Promise.resolve();
  private progressFailure: RequestEvidenceError | null = null;

  constructor(
    private readonly store: RunStore,
    private readonly artifactId: number,
    private payload: Obj,
  ) {}

  private async write(payload: Obj): Promise<void> {
    try {
      await this.store.updateArtifact(this.artifactId, payload);
    } catch {
      throw new RequestEvidenceError('模型请求证据提交失败，结果需要核对。');
    }
    this.payload = payload;
  }

  async finish(
    status: string,
    fields: { usage: TokenUsage; finishReason?: string | null; errorCode?: string | null },
  ): Promise<void> {
    if (this.settled) return;
    // 进度写入排在前面；它失败了，这次派发的证据就不完整，结算一并失败。
    await this.pending;
    if (this.progressFailure !== null) throw this.progressFailure;
    await this.write({
      ...this.payload,
      status,
      usage: fields.usage.toLegacy(),
      finish_reason: fields.finishReason ?? null,
      error_code: fields.errorCode ?? null,
    });
    this.settled = true;
  }

  progress(values: { readonly [key: string]: unknown }): void {
    if (!PROGRESS_PHASES.has(values.phase as string)) return;
    this.pending = this.pending
      .then(async () => {
        if (this.progressFailure !== null) return;
        const progress = Array.isArray(this.payload.transport_progress)
          ? [...this.payload.transport_progress]
          : [];
        if (progress.length >= MAX_TRANSPORT_PROGRESS)
          return this.write({
            ...this.payload,
            transport_progress_omitted: Number(this.payload.transport_progress_omitted ?? 0) + 1,
          });
        progress.push(
          Object.fromEntries(Object.entries(values).filter(([key]) => PROGRESS_KEYS.has(key))),
        );
        return this.write({ ...this.payload, transport_progress: progress });
      })
      .catch((error: RequestEvidenceError) => {
        this.progressFailure = error;
      });
  }
}

/** agent 运行里每次模型派发都先落一行本地证据（不导出、不用于重放）。 */
export class AgentRequestObserver implements ModelObserver {
  constructor(
    private readonly deps: {
      store: RunStore;
      runId: number;
      secrets: SecretContext;
      newAttemptId: () => string;
    },
  ) {}

  async begin(
    request: ChatRequest,
    fields: { source: LlmSource; streaming: boolean; operation: string; provenance: Obj },
  ): Promise<ModelAttempt> {
    const { store, secrets: base } = this.deps;
    const { source, provenance } = fields;
    const snapshot = requestSnapshot(request, source, base);
    const secrets = credentialValues(source);
    const safeProvenance = safeEvidence(withoutNativeState(provenance), secrets, base);
    if (utf8Length(encoded(safeProvenance)) > MAX_REQUEST_SNAPSHOT_BYTES)
      throw new AgentOrchestrationError('模型输入来源证据超出预算，未派发请求。');
    const run = await store.getRun(this.deps.runId);
    const payload: Obj = {
      schema_version: REQUEST_EVIDENCE_VERSION,
      run_id: run.public_id,
      assistant_session_id: run.assistant_session_id || (provenance.assistant_session_id ?? null),
      attempt_id: this.deps.newAttemptId(),
      step: fields.operation,
      run_step: run.current_step,
      status: 'prepared',
      streaming: fields.streaming,
      provider_family: providerFamily(String(source.STORYFORGE_LLM_PROVIDER || '')),
      provider_label: safeEvidence(source.STORYFORGE_LLM_PROVIDER ?? null, secrets, base),
      route_origin: safeEvidence(routeOrigin(source), secrets, base),
      transport_omissions: [
        'credentials_headers',
        'route_path_query_fragment',
        'provider_native_wire',
      ],
      ...snapshot,
      context_provenance: safeProvenance,
      transport_progress: [],
    };
    let artifactId: number;
    try {
      artifactId = (
        await store.insertArtifact({
          run_id: run.id,
          kind: REQUEST_EVIDENCE_KIND,
          payload: payload as JsonObject,
          requires_confirmation: false,
        })
      ).id;
    } catch {
      throw new RequestEvidenceError('模型请求证据提交失败，结果需要核对。');
    }
    return new StoredAttempt(store, artifactId, payload);
  }
}
