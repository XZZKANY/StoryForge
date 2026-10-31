/** 内核功能（审稿 / 跨章一致性 / 拆书）共用的模型调用端口：失败一律抛错，重试、降级还是报错由调用方定。 */
export type LlmPort = (request: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ content: unknown; latency_ms?: unknown }>;
