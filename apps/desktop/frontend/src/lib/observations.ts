/**
 * 观测信号纯逻辑：observatory.scan 后端 payload → ObsPanel Observation 映射 + 编辑器锚点解析。
 *
 * 后端形状（apps/api app/domains/agent_runs/observatory.py）：
 * observations[{id, severity, title, detail, source, location{path, line?, snippet?}}]。
 * severity 已在后端归一化为 error/warning/advisory；id 跨次运行稳定（前端凭它记忆已处理态）。
 */

import type { Observation, ObsSeverity } from '../components/shell/ObsPanel';

export type ObservationAnchor = {
  path: string;
  line?: number;
  snippet?: string;
};

export type ObservatoryChecker = {
  key: string;
  tool: string;
  status: string;
} & Record<string, unknown>;

export type ObservatoryData = {
  observations: Observation[];
  checkers: ObservatoryChecker[];
  generatedAt: string | null;
};

const SEVERITIES: ReadonlySet<string> = new Set(['error', 'warning', 'advisory']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function readAnchor(value: unknown): ObservationAnchor | null {
  const record = asRecord(value);
  const path = readNonEmptyString(record?.path);
  if (!path) return null;
  const anchor: ObservationAnchor = { path };
  if (typeof record?.line === 'number' && Number.isInteger(record.line) && record.line >= 1) {
    anchor.line = record.line;
  }
  const snippet = readNonEmptyString(record?.snippet);
  if (snippet) anchor.snippet = snippet;
  return anchor;
}

export function formatAnchorLabel(anchor: ObservationAnchor): string {
  return anchor.line != null ? `${anchor.path}:${anchor.line}` : anchor.path;
}

/** 后端 observatory payload → ObsPanel 观测列表；resolvedIds 保留跨扫描的已处理态。 */
export function mapObservatoryPayload(
  raw: unknown,
  resolvedIds: ReadonlySet<string>,
): ObservatoryData {
  const record = asRecord(raw);
  const observations: Observation[] = [];
  for (const item of asArray(record?.observations)) {
    const entry = asRecord(item);
    if (!entry) continue;
    const id = readNonEmptyString(entry.id);
    const severity = readNonEmptyString(entry.severity);
    if (!id || !severity || !SEVERITIES.has(severity)) continue;
    const anchor = readAnchor(entry.location);
    observations.push({
      id,
      severity: severity as ObsSeverity,
      title: readNonEmptyString(entry.title) ?? id,
      detail: readNonEmptyString(entry.detail),
      source: readNonEmptyString(entry.source),
      location: anchor ? formatAnchorLabel(anchor) : undefined,
      anchor: anchor ?? undefined,
      resolved: resolvedIds.has(id),
    });
  }
  const checkers: ObservatoryChecker[] = [];
  for (const item of asArray(record?.checkers)) {
    const entry = asRecord(item);
    const key = readNonEmptyString(entry?.key);
    const tool = readNonEmptyString(entry?.tool);
    const status = readNonEmptyString(entry?.status);
    if (!entry || !key || !tool || !status) continue;
    checkers.push({ ...entry, key, tool, status });
  }
  return {
    observations,
    checkers,
    generatedAt: readNonEmptyString(record?.generated_at) ?? null,
  };
}

/**
 * 把锚点解析成 1-based 行号：行号在界内直接用；否则 snippet 整串匹配；
 * 套话类 snippet 是命中词拼接（如「不禁、五味杂陈」）而非原文子串，按分隔符拆词降级；
 * 全部失败返回 null（原文已改动，锚点失效——调用方给出明确提示，不静默）。
 */
export function resolveAnchorLine(
  content: string,
  anchor: Pick<ObservationAnchor, 'line' | 'snippet'>,
): number | null {
  const lines = content.split('\n');
  if (anchor.line != null && anchor.line >= 1 && anchor.line <= lines.length) {
    return anchor.line;
  }
  const snippet = (anchor.snippet ?? '').trim();
  if (!snippet) return null;
  const exact = lines.findIndex((line) => line.includes(snippet));
  if (exact >= 0) return exact + 1;
  const tokens = snippet
    .split(/[、,，;；/\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  for (const token of tokens) {
    const hit = lines.findIndex((line) => line.includes(token));
    if (hit >= 0) return hit + 1;
  }
  return null;
}
