import { JsonFloat } from '../kernel/json';
import { optionalFloat, type LlmSource } from './config';

export type UsageSource = 'provider_usage' | 'estimated_split' | 'unavailable' | (string & {});

/** 旧版记账字段（与 Python `_token_usage` 返回同形）。 */
export type LegacyUsage = {
  token_usage: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_hit_tokens: number | null;
  token_usage_source: UsageSource;
};

type JsonRecord = { readonly [key: string]: unknown };
const isRecord = (value: unknown): value is JsonRecord =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof JsonFloat);
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const length = (text: string) => Array.from(text).length;

/**
 * provider 回报的 prompt 前缀缓存命中 token 数；没报返回 null。
 * null（不知道）与 0（报了、全未命中）不是一回事：把不知道当 0 会让命中部分按全价入账。
 */
export function providerCacheHitTokens(usage: JsonRecord): number | null {
  const direct = usage.prompt_cache_hit_tokens;
  if (isInt(direct)) return Math.max(0, direct);
  const details = usage.prompt_tokens_details;
  if (isRecord(details) && isInt(details.cached_tokens)) return Math.max(0, details.cached_tokens);
  return null;
}

/** 有 provider 用量用它；只有总数时按 4 字一 token 拆分；都没有时按正文长度估算。 */
export function tokenUsage(data: unknown, prompt: string, content: string): LegacyUsage {
  const usage = isRecord(data) ? data.usage : undefined;
  if (isRecord(usage)) {
    const cacheHit = providerCacheHitTokens(usage);
    const {
      total_tokens: total,
      prompt_tokens: promptTokens,
      completion_tokens: completion,
    } = usage;
    if (isInt(promptTokens) && isInt(completion)) {
      const resolved = isInt(total) && total > 0 ? total : promptTokens + completion;
      return {
        token_usage: Math.max(0, resolved),
        prompt_tokens: Math.max(0, promptTokens),
        completion_tokens: Math.max(0, completion),
        cache_hit_tokens: cacheHit,
        token_usage_source: 'provider_usage',
      };
    }
    if (isInt(total) && total > 0) {
      const estimatedPrompt = Math.max(0, Math.floor(length(prompt) / 4));
      return {
        token_usage: total,
        prompt_tokens: estimatedPrompt,
        completion_tokens: Math.max(0, total - estimatedPrompt),
        cache_hit_tokens: cacheHit,
        token_usage_source: 'estimated_split',
      };
    }
  }
  const promptTokens = Math.max(1, Math.floor(length(prompt) / 4));
  const completion = Math.max(1, Math.floor(length(content) / 4));
  return {
    token_usage: promptTokens + completion,
    prompt_tokens: promptTokens,
    completion_tokens: completion,
    cache_hit_tokens: null,
    token_usage_source: 'estimated_split',
  };
}

export type CostBreakdown = {
  currency: 'CNY';
  prompt_tokens: number;
  completion_tokens: number;
  cache_hit_tokens: number | null;
  cache_miss_tokens: number | null;
  input_cny: number;
  output_cny: number;
  total_cny: number;
  input_cny_per_m_tokens: number;
  output_cny_per_m_tokens: number;
  cache_hit_input_cny_per_m_tokens: number | null;
  source: string;
};

/**
 * 按「命中 / 未命中」分段计 input 成本。未知价格或未知用量不等于免费：返回空对象。
 * 没配有效命中价就按全价估计；显式 0 命中价与缺价不同。
 */
export function costBreakdown(
  source: LlmSource,
  usage: { readonly [key: string]: unknown },
): CostBreakdown | Record<string, never> {
  const usageSource = usage.token_usage_source;
  if (usageSource === undefined || usageSource === null || usageSource === 'unavailable') return {};
  const inputRate = optionalFloat(source, 'STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS', NaN);
  const outputRate = optionalFloat(source, 'STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS', NaN);
  if ([inputRate, outputRate].some((rate) => !Number.isFinite(rate) || rate < 0)) return {};
  const promptTokens = isInt(usage.prompt_tokens) ? usage.prompt_tokens : 0;
  const completionTokens = isInt(usage.completion_tokens) ? usage.completion_tokens : 0;
  let cacheHitRate: number | null = optionalFloat(
    source,
    'STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS',
    NaN,
  );
  if (!Number.isFinite(cacheHitRate) || cacheHitRate < 0) cacheHitRate = null;
  const rawHit = usage.cache_hit_tokens;
  const cacheHit = isInt(rawHit) ? Math.min(promptTokens, Math.max(0, rawHit)) : null;
  const billedHit = cacheHit ?? 0;
  const billedMiss = promptTokens - billedHit;
  const hitRate = cacheHitRate ?? inputRate;
  const inputCny = (billedMiss / 1_000_000) * inputRate + (billedHit / 1_000_000) * hitRate;
  const outputCny = (completionTokens / 1_000_000) * outputRate;
  if (!Number.isFinite(inputCny + outputCny)) return {};
  return {
    currency: 'CNY',
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cache_hit_tokens: cacheHit,
    cache_miss_tokens: cacheHit !== null ? billedMiss : null,
    input_cny: inputCny,
    output_cny: outputCny,
    total_cny: inputCny + outputCny,
    input_cny_per_m_tokens: inputRate,
    output_cny_per_m_tokens: outputRate,
    cache_hit_input_cny_per_m_tokens: cacheHitRate,
    source: typeof usageSource === 'string' && usageSource ? usageSource : 'estimated_split',
  };
}
