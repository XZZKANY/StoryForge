import type { ProjectReader } from '../readPort';
import type { ProjectWriter } from '../writePort';
import { readPendingProposals } from './canonDelta';
import { buildDossiers, dossierToJson } from './canonDossier';
import { writeDerived } from './canonFiles';
import type { CanonIssue } from './canonGate';
import { buildCanonProjection, UNCACHED_SCAN_NOTE } from './canonService';
import { buildFactLedgerView } from './factLedgerView';
import { FsToolError, resolveProjectRoot } from './fsTools';
import type { JsonObject } from './json';
import { matchPythonPath } from './pathMatch';
import { scanProjectFiles } from './projectTree';
import {
  buildPromiseLedger,
  DEFAULT_STALE_AFTER_CHAPTERS,
  promiseCheck,
  type PromiseCheckResult,
} from './promiseScan';
import { proseStaticScan } from './proseScan';
import { pythonStrip } from './pythonText';
import type { Presence } from './canonRebuild';

/** 文笔气味逐文件扫描的文件数上限：超出如实记 truncated，不静默丢。 */
const MAX_PROSE_FILES = 100;
const SNIPPET_TITLE_BUDGET = 40;
const CANON_DECLARATION_PATH = '.storyforge/canon/canon.json';
// error 专属声明结构矛盾（blocking）；确定性文本气味最高到 warning。
const SEVERITY: Readonly<Record<string, string>> = {
  blocking: 'error',
  high: 'warning',
  medium: 'warning',
  严重: 'warning',
  高: 'warning',
  中: 'warning',
  低: 'advisory',
  low: 'advisory',
  advisory: 'advisory',
};
const PROMISE_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  duplicate_id: '声明重复',
  resolved_chapter: '兑现章缺失',
  resolved_before_planted: '先收后埋',
  due_before_planted: '期限早于埋设',
  overdue: '逾期未回应',
  stalled: '长期未推进',
  cadence_gap: '节拍断档',
};

type Observation = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  source: string;
  location: { path: string; line?: number; snippet?: string };
};

const severityOf = (raw: unknown) =>
  Object.prototype.hasOwnProperty.call(SEVERITY, String(raw)) ? SEVERITY[String(raw)] : 'advisory';

async function syntheticId(prefix: string, parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(parts.join('|')));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  return `${prefix}_${hex.join('').slice(0, 12)}`;
}

function canonObservations(output: { conflicts: CanonIssue[]; advisories: CanonIssue[] }) {
  const observations: Observation[] = [];
  for (const conflict of output.conflicts) {
    const category = String(conflict.category || 'conflict');
    const title =
      category === 'single_holder'
        ? `「${conflict.item}」唯一持有冲突`
        : category === 'timeline_order'
          ? '时间线先后声明成环'
          : `canon 硬矛盾：${category}`;
    observations.push({
      id: String(conflict.id),
      severity: severityOf(conflict.severity),
      title,
      detail: String(conflict.message || ''),
      source: `canon·${category}`,
      location: { path: CANON_DECLARATION_PATH },
    });
  }
  for (const advisory of output.advisories) {
    const category = String(advisory.category || 'advisory');
    const hits = (Array.isArray(advisory.hits) ? advisory.hits : []) as {
      path: unknown;
      first_line: unknown;
    }[];
    let location: Observation['location'] = { path: CANON_DECLARATION_PATH };
    if (hits.length && typeof hits[0].path === 'string') {
      location = { path: hits[0].path };
      if (typeof hits[0].first_line === 'number') location.line = hits[0].first_line;
    }
    observations.push({
      id: String(advisory.id),
      severity: severityOf(advisory.severity),
      title: `${advisory.entity || '实体'} 声明退场后仍出场`,
      detail: String(advisory.message || ''),
      source: `canon·${category}`,
      location,
    });
  }
  return observations;
}

function promiseObservations(output: PromiseCheckResult): Observation[] {
  const observations: Observation[] = [];
  for (const [issues, fallback] of [
    [output.conflicts, 'blocking'],
    [output.advisories, 'medium'],
  ] as const) {
    for (const issue of issues) {
      const category = String(issue.category || 'promise');
      const label = Object.prototype.hasOwnProperty.call(PROMISE_CATEGORY_LABELS, category)
        ? PROMISE_CATEGORY_LABELS[category]
        : category;
      const name = issue.title || issue.promise_id || '未命名伏笔';
      observations.push({
        id: String(issue.id),
        severity: severityOf(issue.severity || fallback),
        title: `伏笔「${name}」${label}`,
        detail: String(issue.message || ''),
        source: `promise·${category}`,
        location: { path: CANON_DECLARATION_PATH },
      });
    }
  }
  return observations;
}

/**
 * 对项目内 Markdown 逐文件跑文笔气味；空文件 / 越界由底层拒绝，这里如实计数跳过。
 * 遍历沿用统一的项目遍历预算（隐藏目录不进入、符号链接目录不跟随）。
 */
async function proseObservations(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
) {
  await resolveProjectRoot(reader, root);
  const markdown = (
    await scanProjectFiles(reader, root, {
      visible: (path) => !path.split('/').some((part) => part.startsWith('.')),
    })
  ).filter((path) => matchPythonPath(path.split('/').slice(-1)[0], '*.md', platform));
  const scanned: string[] = [];
  const skipped: string[] = [];
  const observations: Observation[] = [];
  for (const relative of markdown.slice(0, MAX_PROSE_FILES)) {
    let report: Awaited<ReturnType<typeof proseStaticScan>>;
    try {
      report = await proseStaticScan(reader, root, relative);
    } catch (error) {
      if (!(error instanceof FsToolError)) throw error;
      skipped.push(relative);
      continue;
    }
    scanned.push(relative);
    for (const issue of report.issues) {
      const dimension = issue.dimension || 'prose';
      const snippet = issue.snippet || '';
      const titleSnippet = Array.from(snippet).slice(0, SNIPPET_TITLE_BUDGET).join('') || dimension;
      const suggestion = pythonStrip(issue.suggestion || '');
      const strategy = pythonStrip(issue.revision_strategy || '');
      const parts = [issue.message || ''];
      if (suggestion) parts.push(suggestion);
      if (strategy) parts.push(`建议策略 ${strategy}`);
      observations.push({
        id: await syntheticId('prose', [relative, dimension, snippet]),
        severity: severityOf(issue.severity),
        title: `「${titleSnippet}」`,
        detail: parts.filter(Boolean).join(' · '),
        source: `prose·${dimension}`,
        location: { path: relative, snippet },
      });
    }
  }
  return {
    observations,
    meta: {
      files_scanned: scanned.length,
      files_skipped: skipped.length,
      files_truncated: markdown.length > MAX_PROSE_FILES,
      issue_count: observations.length,
    },
  };
}

function entityDossiers(
  canon: JsonObject,
  presence: Presence,
  output: { conflicts: CanonIssue[]; advisories: CanonIssue[] },
): JsonObject[] {
  const related = new Map<string, string[]>();
  const relate = (key: string, id: unknown) => {
    const list = related.get(key) ?? [];
    list.push(String(id));
    related.set(key, list);
  };
  for (const conflict of output.conflicts) {
    if (conflict.category !== 'single_holder') continue;
    for (const holder of (conflict.holders as unknown[]) ?? []) relate(String(holder), conflict.id);
  }
  for (const advisory of output.advisories)
    if (typeof advisory.entity === 'string') relate(advisory.entity, advisory.id);
  return buildDossiers(canon, presence).map((dossier) => ({
    ...dossierToJson(dossier),
    related_observation_ids: related.get(dossier.id) ?? [],
  }));
}

/** Python datetime.isoformat()：UTC、微秒为 0 时省略小数部分。 */
function isoformatUtc(date: Date): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const base =
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  const millis = date.getUTCMilliseconds();
  return base + (millis ? `.${pad(millis, 3)}000` : '') + '+00:00';
}

/** 聚合确定性检查器，归一化观测信号并写 observations.json 派生缓存（无 LLM）。 */
export async function runObservatoryScan(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  options: {
    platform: 'windows' | 'posix';
    now: () => Date;
    glob?: string;
    staleAfterChapters?: number;
  },
) {
  const { platform } = options;
  const projection = await buildCanonProjection(reader, writer, root, {
    glob: options.glob ?? '*.md',
    refresh: true,
    platform,
  });
  const canonOutput = projection.output as {
    conflicts: CanonIssue[];
    advisories: CanonIssue[];
    conflict_count: number;
    advisory_count: number;
    entity_count: number;
  };
  const promiseOutput = await promiseCheck(reader, root, {
    platform,
    staleAfterChapters: options.staleAfterChapters ?? DEFAULT_STALE_AFTER_CHAPTERS,
  });
  const prose = await proseObservations(reader, root, platform);
  const observations = [
    ...canonObservations(canonOutput),
    ...promiseObservations(promiseOutput),
    ...prose.observations,
  ];
  const count = (severity: string) =>
    observations.filter((item) => item.severity === severity).length;
  const payload: { [key: string]: unknown } = {
    version: 2,
    cache_status: projection.sourceRevision === null ? 'uncached_unverified' : 'published',
    generated_at: isoformatUtc(options.now()),
    observations,
    counts: {
      error: count('error'),
      warning: count('warning'),
      advisory: count('advisory'),
      total: observations.length,
    },
    checkers: [
      {
        key: 'canon',
        tool: 'project.canon',
        status: 'ran',
        conflict_count: canonOutput.conflict_count,
        advisory_count: canonOutput.advisory_count,
        entity_count: canonOutput.entity_count,
      },
      {
        key: 'promise',
        tool: 'project.promise_check',
        status: 'ran',
        conflict_count: promiseOutput.conflict_count,
        advisory_count: promiseOutput.advisory_count,
        promise_count: promiseOutput.promise_count,
        current_chapter: promiseOutput.current_chapter,
      },
      { key: 'prose', tool: 'project.prose_check', status: 'ran', ...prose.meta },
      {
        key: 'consistency',
        tool: 'project.consistency',
        status: 'on_demand',
        reason: '机械观察不下结论，Agent 内按需触发。',
      },
      {
        key: 'collapse',
        tool: 'project.collapse_check',
        status: 'on_demand',
        reason: '需要 Agent 提供场景节拍等语义参数，裸跑无信号。',
      },
      {
        key: 'entity_budget',
        tool: 'project.entity_budget_check',
        status: 'on_demand',
        reason: '需要 Agent 提供新实体清单，裸跑无信号。',
      },
      {
        key: 'deep_consistency',
        tool: 'project.deep_consistency',
        status: 'on_demand',
        reason: '语义评审走 LLM，永远按需触发，不进保存重扫。',
      },
    ],
    entities: entityDossiers(projection.canon, projection.presence, canonOutput),
    promises: {
      current_chapter: promiseOutput.current_chapter,
      ledger: buildPromiseLedger(projection.canon, promiseOutput),
    },
    proposals: await readPendingProposals(reader, root),
    note: '确定性参考信号（无 LLM）：advisory 需结合原文核实，不是质量判定。',
  };
  // 事实台账分区：还没开始记账的书不出这个键，老书的扫描结果一字不差。
  const facts = await buildFactLedgerView(reader, root, platform);
  if (facts !== null) payload.facts = facts;
  if (projection.sourceRevision === null) payload.note = `${payload.note}${UNCACHED_SCAN_NOTE}`;
  else
    await writeDerived(reader, writer, root, 'observations.json', payload, {
      sourceRevision: projection.sourceRevision,
      platform,
    });
  return payload;
}
