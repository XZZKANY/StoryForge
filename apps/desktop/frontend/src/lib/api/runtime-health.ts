import { getApiConfig, trimApiBaseUrl } from './config';
import type { ApiReadinessResponse } from './contracts';
import type { ApiRuntimeHealth, ApiRuntimeHealthStatus } from './types';

export async function probeApiRuntimeHealth(): Promise<ApiRuntimeHealth> {
  const { baseUrl } = await getApiConfig();
  const trimmedBaseUrl = trimApiBaseUrl(baseUrl);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${trimmedBaseUrl}/health/ready`, {
      method: 'GET',
      cache: 'no-store',
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      return runtimeHealthFailure(trimmedBaseUrl, latencyMs, `API 返回 ${response.status}`);
    }
    const data = (await response.json()) as ApiReadinessResponse;
    const status = runtimeHealthStatus(data.status);
    return {
      status,
      reachable: true,
      baseUrl: trimmedBaseUrl,
      latencyMs,
      checks: runtimeHealthChecks(data.checks),
      detail: null,
    };
  } catch (error) {
    return runtimeHealthFailure(
      trimmedBaseUrl,
      Math.round(performance.now() - startedAt),
      error instanceof Error ? error.message : String(error),
    );
  }
}

function runtimeHealthFailure(
  baseUrl: string,
  latencyMs: number,
  detail: string,
): ApiRuntimeHealth {
  return {
    status: 'unreachable',
    reachable: false,
    baseUrl,
    latencyMs,
    checks: {},
    detail,
  };
}

function runtimeHealthStatus(
  value: ApiReadinessResponse['status'] | unknown,
): ApiRuntimeHealthStatus {
  if (value === 'ready') return 'ready';
  if (value === 'degraded') return 'degraded';
  return 'degraded';
}

function runtimeHealthChecks(
  value: ApiReadinessResponse['checks'] | unknown,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
