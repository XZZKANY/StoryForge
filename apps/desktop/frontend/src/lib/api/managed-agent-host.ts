import type { ApiConfig } from './types';
import type { components } from '../../../../../../packages/shared/src/generated/api-types';

export type AgentCapabilities = components['schemas']['AgentCapabilitiesRead'];
export type ExternalWriteback = components['schemas']['WritebackRead'];
export type WritebackPrepare = components['schemas']['WritebackPrepareRequest'];
export type WritebackReconcile = components['schemas']['WritebackReconcileRequest'];
export type WritebackRecovery = components['schemas']['WritebackRecoveryRequest'];
export type WritebackRecovered = components['schemas']['WritebackRecoveryRead'];
export type WritebackRecoveryList = components['schemas']['WritebackRecoveryList'];

/** Decode the Native IPC response; old binaries remain legacy, never inferred capable. */
export function decodeNativeApiConfig(value: unknown): ApiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native API config is invalid');
  }
  const fields = value as Record<string, unknown>;
  if (typeof fields.baseUrl !== 'string' || typeof fields.apiKey !== 'string') {
    throw new Error('Native API config is invalid');
  }
  const generation = fields.managedHostGeneration;
  const protocols = fields.executionProtocols;
  if (
    (generation !== undefined &&
      generation !== null &&
      (typeof generation !== 'string' || !/^[a-f0-9]{64}$/.test(generation))) ||
    (protocols !== undefined &&
      (!Array.isArray(protocols) || protocols.some((item) => item !== 'external_writeback_v1')))
  ) {
    throw new Error('Native host capability is invalid');
  }
  return {
    baseUrl: fields.baseUrl,
    apiKey: fields.apiKey,
    managedHostGeneration: typeof generation === 'string' ? generation : null,
    executionProtocols:
      Array.isArray(protocols) && protocols.length ? ['external_writeback_v1'] : [],
  };
}

/** Only pair a fresh Native-owned projection with the API's exact spawn generation. */
export function supportsExternalWriteback(
  config: ApiConfig,
  capability: AgentCapabilities,
): boolean {
  return (
    typeof config.managedHostGeneration === 'string' &&
    config.executionProtocols?.includes('external_writeback_v1') === true &&
    capability.managed_host_generation === config.managedHostGeneration &&
    capability.execution_protocols?.includes('external_writeback_v1') === true &&
    capability.disabled_reason == null
  );
}
