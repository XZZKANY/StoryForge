import type { components } from '../../../../../../packages/shared/src/generated/api-types';
import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';

export type ChapterCheckHistoryRequest = components['schemas']['ChapterCheckHistoryQuery'];
type ExecutionStatus = 'completed' | 'failed' | 'incomplete';
type ManuscriptStatus = 'pass' | 'fail' | 'unknown';

export type ChapterCheckFinding = {
  rule: string;
  severity: 'hard' | 'advisory';
  message: string;
  line: number | null;
  evidence: string | null;
  evidenceVerified: boolean;
};

export type ChapterCheckDisplay = {
  executionStatus: ExecutionStatus;
  manuscriptStatus: ManuscriptStatus;
  manuscriptHardCount: number;
  advisoryCount: number;
  contentSha256: string;
  briefSha256: string;
  coverage: {
    suppliedChars: number;
    sourceVerified: boolean;
    received: number | null;
    validated: number;
    limit: number;
    complete: boolean;
  };
  findings: ChapterCheckFinding[];
};

export type ChapterCheckEntry = {
  runId: string;
  artifactId: number;
  targetPath: string | null;
  createdAt: string;
  check: ChapterCheckDisplay | null;
  checkError: string | null;
  candidateContent: string | null;
  candidateError: string | null;
};

export type ChapterCheckHistory = { entries: ChapterCheckEntry[]; truncated: boolean };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function decodeCheck(raw: unknown): ChapterCheckDisplay | null {
  if (
    !record(raw) ||
    raw.protocol_version !== 2 ||
    !hash(raw.content_sha256) ||
    !hash(raw.brief_sha256)
  )
    return null;
  const execution = raw.execution_status;
  const manuscript = raw.manuscript_status;
  if (execution !== 'completed' && execution !== 'failed' && execution !== 'incomplete')
    return null;
  if (manuscript !== 'pass' && manuscript !== 'fail' && manuscript !== 'unknown') return null;
  const coverage = raw.coverage;
  if (
    !count(raw.manuscript_hard_failure_count) ||
    !count(raw.advisory_count) ||
    !record(coverage) ||
    !count(coverage.supplied_content_chars) ||
    typeof coverage.source_verified !== 'boolean' ||
    !(coverage.findings_received === null || count(coverage.findings_received)) ||
    !count(coverage.findings_validated) ||
    !count(coverage.findings_limit) ||
    typeof coverage.result_complete !== 'boolean' ||
    !Array.isArray(raw.findings)
  )
    return null;
  const findings: ChapterCheckFinding[] = [];
  for (const item of raw.findings) {
    if (
      !record(item) ||
      typeof item.rule !== 'string' ||
      typeof item.message !== 'string' ||
      (item.severity !== 'hard' && item.severity !== 'advisory') ||
      !(item.line === null || (count(item.line) && item.line > 0)) ||
      !(item.evidence === null || typeof item.evidence === 'string')
    )
      return null;
    findings.push({
      rule: item.rule,
      severity: item.severity,
      message: item.message,
      line: item.line,
      evidence: item.evidence,
      evidenceVerified: item.evidence_verified === true,
    });
  }
  return {
    executionStatus: execution,
    manuscriptStatus: manuscript,
    manuscriptHardCount: raw.manuscript_hard_failure_count,
    advisoryCount: raw.advisory_count,
    contentSha256: raw.content_sha256,
    briefSha256: raw.brief_sha256,
    coverage: {
      suppliedChars: coverage.supplied_content_chars,
      sourceVerified: coverage.source_verified,
      received: coverage.findings_received,
      validated: coverage.findings_validated,
      limit: coverage.findings_limit,
      complete: coverage.result_complete,
    },
    findings,
  };
}

function decodeEntry(raw: unknown): ChapterCheckEntry {
  if (
    !record(raw) ||
    !count(raw.check_artifact_id) ||
    raw.check_artifact_id < 1 ||
    typeof raw.run_id !== 'string' ||
    !raw.run_id ||
    typeof raw.created_at !== 'string' ||
    !(raw.target_path === null || typeof raw.target_path === 'string') ||
    !(raw.candidate_error === null || typeof raw.candidate_error === 'string')
  ) {
    throw new Error('章节检查历史记录格式无效；未展示未绑定的候选稿。');
  }
  const check = decodeCheck(raw.check);
  let candidateContent: string | null = null;
  if (raw.candidate !== null) {
    const candidate = raw.candidate;
    if (
      !record(candidate) ||
      candidate.read_only !== true ||
      typeof candidate.content !== 'string' ||
      !record(raw.check) ||
      candidate.content_sha256 !== raw.check.content_sha256 ||
      candidate.brief_sha256 !== raw.check.brief_sha256 ||
      candidate.target_path !== raw.target_path ||
      !hash(candidate.content_sha256) ||
      !hash(candidate.brief_sha256) ||
      !count(raw.candidate_artifact_id) ||
      raw.candidate_artifact_id < 1 ||
      'before' in candidate ||
      'after' in candidate ||
      'approval_action' in candidate
    ) {
      throw new Error('候选稿记录来源不匹配或不是只读证据；未展示正文。');
    }
    candidateContent = candidate.content;
  }
  return {
    runId: raw.run_id,
    artifactId: raw.check_artifact_id,
    targetPath: raw.target_path,
    createdAt: raw.created_at,
    check,
    checkError: check ? null : '历史记录缺少可核实的检查执行/覆盖状态，不能当作检查通过。',
    candidateContent,
    candidateError: raw.candidate_error,
  };
}

export function decodeChapterCheckHistory(
  raw: unknown,
  request: ChapterCheckHistoryRequest,
): ChapterCheckHistory {
  if (
    !record(raw) ||
    raw.project_root !== request.project_root ||
    raw.assistant_session_id !== request.assistant_session_id ||
    !Array.isArray(raw.entries) ||
    typeof raw.truncated !== 'boolean' ||
    raw.entries.length > (request.limit ?? 20)
  ) {
    throw new Error('章节检查历史归属或格式不匹配。');
  }
  const entries = raw.entries.map(decodeEntry);
  if (new Set(entries.map((entry) => entry.artifactId)).size !== entries.length) {
    throw new Error('章节检查历史含重复记录，无法核实归属。');
  }
  return { entries, truncated: raw.truncated };
}

export async function queryChapterCheckHistory(
  request: ChapterCheckHistoryRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ChapterCheckHistory> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/agent-runs/chapter-checks/query`, {
    method: 'POST',
    signal: options.signal,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-StoryForge-API-Key': apiKey },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return decodeChapterCheckHistory(await response.json(), request);
}
