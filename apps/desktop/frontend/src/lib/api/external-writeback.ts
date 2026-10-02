import { trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';
import { readAgentRunWithin } from './agent-delivery';
import { decodeWritebackIdentity } from '../writeback-receipt-types';
import type { ApiConfig } from './types';
import type {
  AgentCapabilities,
  ExternalWriteback,
  WritebackPrepare,
  WritebackReconcile,
} from './managed-agent-host';

const PREFIX = '/api/agent-runs';

export async function requestWriteback(
  config: ApiConfig,
  path: string,
  body?: unknown,
): Promise<unknown> {
  return readAgentRunWithin(async (signal) => {
    const response = await fetch(`${trimApiBaseUrl(config.baseUrl)}${PREFIX}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal,
      headers: {
        'content-type': 'application/json',
        'X-StoryForge-API-Key': config.apiKey,
        ...(config.managedHostGeneration
          ? { 'X-StoryForge-Host-Generation': config.managedHostGeneration }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(await readErrorDetail(response));
    return response.json() as Promise<unknown>;
  }, 15_000);
}

const request = requestWriteback;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('外部写回响应格式无效');
  return value as Record<string, unknown>;
}

/** One boundary decoder for every REST consumer; never infer approval from missing fields. */
export function decodeExternalWriteback(value: unknown): ExternalWriteback {
  const fields = record(value);
  const proposal = record(fields.proposal);
  const strings = [
    'run_id',
    'session_id',
    'wait_id',
    'project_path',
    'requested_path',
    'raw_before',
    'operation_key',
    'source',
    'run_status',
    'permission_profile',
  ];
  if (
    fields.protocol !== 'external_writeback_v1' ||
    strings.some((key) => typeof fields[key] !== 'string') ||
    !['ask', 'auto', 'full', 'read'].includes(String(fields.permission_profile)) ||
    !['in_flight', 'settled'].includes(String(fields.runtime_state)) ||
    ![
      'await_authorization',
      'awaiting_receipt',
      'reconciliation',
      'receipt_ready',
      'claimed',
    ].includes(String(fields.stage)) ||
    !Number.isSafeInteger(fields.revision) ||
    Number(fields.revision) < 1 ||
    !Number.isSafeInteger(fields.event_sequence) ||
    Number(fields.event_sequence) < 0 ||
    !Number.isSafeInteger(fields.assistant_session_id) ||
    Number(fields.assistant_session_id) < 1 ||
    !Number.isSafeInteger(fields.event_id) ||
    Number(fields.event_id) < 1 ||
    ['before_hash', 'after_hash'].some((key) => !/^[a-f0-9]{64}$/.test(String(fields[key]))) ||
    ['historical_applied', 'feedback_consumed', 'delivery_complete', 'continuation_available'].some(
      (key) => typeof fields[key] !== 'boolean',
    ) ||
    !(typeof proposal.id === 'string' || Number.isSafeInteger(proposal.id)) ||
    !['before', 'after'].every((key) => typeof proposal[key] === 'string') ||
    typeof proposal.requires_confirmation !== 'boolean' ||
    !(fields.decision === null || ['approve', 'auto', 'reject'].includes(String(fields.decision)))
  )
    throw new Error('外部写回响应字段无效，已禁止派发');
  if (fields.identity !== null) decodeWritebackIdentity(fields.identity);
  if (fields.observation !== null) {
    const observation = record(fields.observation);
    if (
      !['applied', 'not_written', 'outcome_unknown', 'missing', 'invalid'].includes(
        String(observation.state),
      ) ||
      !(
        observation.current === null ||
        ['before', 'after', 'diverged', 'missing', 'unreadable'].includes(
          String(observation.current),
        )
      ) ||
      typeof observation.receipt_persisted !== 'boolean'
    )
      throw new Error('外部写回观察字段无效');
  }
  return value as ExternalWriteback;
}

export async function getAgentCapabilities(config: ApiConfig): Promise<AgentCapabilities> {
  const value = record(await request(config, '/capabilities'));
  if (
    !Array.isArray(value.execution_protocols) ||
    value.execution_protocols.some((item) => item !== 'external_writeback_v1') ||
    !(
      value.managed_host_generation === null ||
      /^[a-f0-9]{64}$/.test(String(value.managed_host_generation))
    ) ||
    !(value.disabled_reason === null || typeof value.disabled_reason === 'string')
  )
    throw new Error('Agent 执行能力响应无效');
  return value as AgentCapabilities;
}

export async function getExternalWriteback(config: ApiConfig, runId: string, sessionId: string) {
  return decodeExternalWriteback(
    await request(
      config,
      `/${encodeURIComponent(runId)}/writeback?session_id=${encodeURIComponent(sessionId)}`,
    ),
  );
}

export async function prepareExternalWriteback(
  config: ApiConfig,
  runId: string,
  waitId: string,
  body: WritebackPrepare,
) {
  return decodeExternalWriteback(
    await request(
      config,
      `/${encodeURIComponent(runId)}/writeback/${encodeURIComponent(waitId)}/prepare`,
      body,
    ),
  );
}

export async function reconcileExternalWriteback(
  config: ApiConfig,
  runId: string,
  waitId: string,
  body: WritebackReconcile,
) {
  return decodeExternalWriteback(
    await request(
      config,
      `/${encodeURIComponent(runId)}/writeback/${encodeURIComponent(waitId)}/reconcile`,
      body,
    ),
  );
}
