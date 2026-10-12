import { dumpJson } from './json';
import type { PlainJson } from './redaction';
import { sha256Hex } from './sha256';

export const MAX_DELIVERY_REFS = 32;

/** 已确认的 writer 回执的不可变引用：只留标识与哈希，不留正文。 */
export function generationDeliveryReference(
  assistantToolCallId: number,
  manifest: { [key: string]: PlainJson },
): string {
  const encoded = dumpJson(manifest, {
    ensureAscii: false,
    sortKeys: true,
    separators: [',', ':'],
  });
  return dumpJson(
    {
      assistant_tool_call_id: assistantToolCallId,
      manifest_version: manifest.version,
      delivery_boundary: manifest.delivery_boundary,
      manifest_sha256: sha256Hex(encoded),
      project_identity_sha256: manifest.project_identity_sha256,
      request: manifest.request,
    },
    { ensureAscii: false },
  );
}

/** 一次执行范围内的送达关联；由调用方显式持有（Python 用 ContextVar 隐式传递）。 */
export class GenerationDeliveryCapture {
  private readonly refs: string[] = [];

  constructor(private readonly onRecord?: (refs: PlainJson[]) => void) {}

  /** 生产方只在回执已提交并刷新之后调用。 */
  record(assistantToolCallId: number, manifest: { [key: string]: PlainJson }) {
    if (this.refs.length >= MAX_DELIVERY_REFS)
      throw new RangeError('生成送达关联超过预算，不能静默省略。');
    this.refs.push(generationDeliveryReference(assistantToolCallId, manifest));
    this.onRecord?.(this.refs.map((ref) => JSON.parse(ref)));
  }

  /** 绝不信任调用方 / 模型自带的关联，包括没有 writer 运行的时候。 */
  bind(summary: { [key: string]: PlainJson }): { [key: string]: PlainJson } {
    const result: { [key: string]: PlainJson } = {};
    for (const [key, value] of Object.entries(summary))
      if (key !== 'generation_delivery_refs') result[key] = value;
    if (this.refs.length) result.generation_delivery_refs = this.refs.map((ref) => JSON.parse(ref));
    return result;
  }
}
