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

/** payload v2 结构化台账（观测镜富 view）：字段形状对齐后端 observatory.py。 */
export type ObservatoryEntity = {
  id: string;
  canonicalName: string;
  kind: string | null;
  aliases: string[];
  appearanceMissing: boolean;
  firstChapter: number | null;
  lastChapter: number | null;
  totalCount: number;
  holdings: { item: string; fromChapter: number | null; toChapter: number | null }[];
  lifespan: { exitsAfterChapter: number; reason: string | null } | null;
  provenance: {
    path: string;
    chapter: number | null;
    firstLine: number | null;
    count: number | null;
  }[];
  provenanceTruncated: boolean;
  relatedObservationIds: string[];
};

export type ObservatoryPromiseIssue = {
  id: string | null;
  category: string;
  severity: string | null;
  message: string;
};

export type ObservatoryPromise = {
  id: string;
  title: string;
  status: string | null;
  kind: string | null;
  plantedChapter: number | null;
  dueChapter: number | null;
  resolvedChapter: number | null;
  lastTouchChapter: number | null;
  issues: ObservatoryPromiseIssue[];
};

export type ObservatoryPromises = {
  currentChapter: number | null;
  ledger: ObservatoryPromise[];
};

export type ObservatoryProposalClaim = {
  invariant: string;
  entry: Record<string, unknown>;
};

export type ObservatoryProposals = {
  available: boolean;
  newEntities: { id: string; canonicalName: string; aliases: string[] }[];
  newClaims: ObservatoryProposalClaim[];
  pendingCount: number;
};

export const EMPTY_OBSERVATORY_PROMISES: ObservatoryPromises = {
  currentChapter: null,
  ledger: [],
};

export const EMPTY_OBSERVATORY_PROPOSALS: ObservatoryProposals = {
  available: false,
  newEntities: [],
  newClaims: [],
  pendingCount: 0,
};

export type ObservatoryData = {
  observations: Observation[];
  checkers: ObservatoryChecker[];
  entities: ObservatoryEntity[];
  promises: ObservatoryPromises;
  proposals: ObservatoryProposals;
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

function readChapter(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function readStringList(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string' && item !== '');
}

function mapEntities(raw: unknown): ObservatoryEntity[] {
  const entities: ObservatoryEntity[] = [];
  for (const item of asArray(raw)) {
    const entry = asRecord(item);
    const id = readNonEmptyString(entry?.id);
    if (!entry || !id) continue;
    const appearance = asRecord(entry.appearance);
    const lifespanRecord = asRecord(entry.lifespan);
    const exitsAfter = readChapter(lifespanRecord?.exits_after_chapter);
    const holdings: ObservatoryEntity['holdings'] = [];
    for (const holding of asArray(entry.holdings)) {
      const record = asRecord(holding);
      const holdingItem = readNonEmptyString(record?.item);
      if (!holdingItem) continue;
      holdings.push({
        item: holdingItem,
        fromChapter: readChapter(record?.from_chapter),
        toChapter: readChapter(record?.to_chapter),
      });
    }
    const provenance: ObservatoryEntity['provenance'] = [];
    for (const occurrence of asArray(entry.provenance)) {
      const record = asRecord(occurrence);
      const path = readNonEmptyString(record?.path);
      if (!path) continue;
      provenance.push({
        path,
        chapter: readChapter(record?.chapter),
        firstLine: readChapter(record?.first_line),
        count: readChapter(record?.count),
      });
    }
    entities.push({
      id,
      canonicalName: readNonEmptyString(entry.canonical_name) ?? id,
      kind: readNonEmptyString(entry.kind) ?? null,
      aliases: readStringList(entry.aliases),
      appearanceMissing: appearance?.missing !== false,
      firstChapter: readChapter(appearance?.first_chapter),
      lastChapter: readChapter(appearance?.last_chapter),
      totalCount: readChapter(appearance?.total_count) ?? 0,
      holdings,
      lifespan:
        exitsAfter != null
          ? {
              exitsAfterChapter: exitsAfter,
              reason: readNonEmptyString(lifespanRecord?.reason) ?? null,
            }
          : null,
      provenance,
      provenanceTruncated: entry.provenance_truncated === true,
      relatedObservationIds: readStringList(entry.related_observation_ids),
    });
  }
  return entities;
}

function mapPromises(raw: unknown): ObservatoryPromises {
  const record = asRecord(raw);
  if (!record) return EMPTY_OBSERVATORY_PROMISES;
  const ledger: ObservatoryPromise[] = [];
  for (const item of asArray(record.ledger)) {
    const entry = asRecord(item);
    const id = readNonEmptyString(entry?.id);
    if (!entry || !id) continue;
    const issues: ObservatoryPromiseIssue[] = [];
    for (const issue of asArray(entry.issues)) {
      const issueRecord = asRecord(issue);
      const category = readNonEmptyString(issueRecord?.category);
      if (!category) continue;
      issues.push({
        id: readNonEmptyString(issueRecord?.id) ?? null,
        category,
        severity: readNonEmptyString(issueRecord?.severity) ?? null,
        message: readNonEmptyString(issueRecord?.message) ?? '',
      });
    }
    ledger.push({
      id,
      title: readNonEmptyString(entry.title) ?? id,
      status: readNonEmptyString(entry.status) ?? null,
      kind: readNonEmptyString(entry.kind) ?? null,
      plantedChapter: readChapter(entry.planted_chapter),
      dueChapter: readChapter(entry.due_chapter),
      resolvedChapter: readChapter(entry.resolved_chapter),
      lastTouchChapter: readChapter(entry.last_touch_chapter),
      issues,
    });
  }
  return { currentChapter: readChapter(record.current_chapter), ledger };
}

function mapProposals(raw: unknown): ObservatoryProposals {
  const record = asRecord(raw);
  if (!record || record.available !== true) return EMPTY_OBSERVATORY_PROPOSALS;
  const newEntities: ObservatoryProposals['newEntities'] = [];
  for (const item of asArray(record.new_entities)) {
    const entry = asRecord(item);
    const id = readNonEmptyString(entry?.id);
    if (!entry || !id) continue;
    newEntities.push({
      id,
      canonicalName: readNonEmptyString(entry.canonical_name) ?? id,
      aliases: readStringList(entry.aliases),
    });
  }
  const newClaims: ObservatoryProposalClaim[] = [];
  const invariants = asRecord(record.new_invariants);
  for (const invariant of Object.keys(invariants ?? {})) {
    for (const claim of asArray(invariants?.[invariant])) {
      const entry = asRecord(claim);
      if (!entry) continue;
      newClaims.push({ invariant, entry });
    }
  }
  return {
    available: true,
    newEntities,
    newClaims,
    pendingCount: readChapter(record.pending_count) ?? newEntities.length + newClaims.length,
  };
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
    entities: mapEntities(record?.entities),
    promises: mapPromises(record?.promises),
    proposals: mapProposals(record?.proposals),
    generatedAt: readNonEmptyString(record?.generated_at) ?? null,
  };
}

/**
 * 光标行实体联动：按实体表面形（canonical_name + aliases）做包含匹配，返回命中实体 id。
 * 单字符表面形跳过（中文单字包含匹配噪声过大）；纯注意力提示，不是业务结论。
 */
export function matchEntityIdsInLine(entities: ObservatoryEntity[], lineText: string): string[] {
  if (!lineText) return [];
  const matched: string[] = [];
  for (const entity of entities) {
    const surfaces = [entity.canonicalName, ...entity.aliases].filter((form) => form.length >= 2);
    if (surfaces.some((form) => lineText.includes(form))) matched.push(entity.id);
  }
  return matched;
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
