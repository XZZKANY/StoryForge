import { assertSessionProjectMatches, type AssistantSessionRef } from '../assistant/service';
import { redactSensitive, type PlainJson, type SecretContext } from '../kernel/redaction';
import { sha256Hex } from '../kernel/sha256';
import type { ArtifactRecord, RunStore } from '../store/runs';
import { checkSource } from './chapterCheckProtocol';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 请求体不合格（Python 路由在服务之前就回 422 的那些）。 */
export class ChapterCheckHistoryRequestError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'ChapterCheckHistoryRequestError';
  }
}

export type ChapterCheckHistoryDeps = {
  store: RunStore;
  /** 会话在哪个库就从哪里取；不存在时抛 AssistantSessionNotFoundError（404）。 */
  sessions: { getSession(id: number): Promise<AssistantSessionRef> };
  secrets: SecretContext;
  platform: 'windows' | 'posix';
};

const QUERY_KEYS = ['project_root', 'assistant_session_id', 'limit'];
const strictInt = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value);

/** 照 `ChapterCheckHistoryQuery`：不认识的键拒绝，整数不接受字符串与布尔。 */
function parseQuery(value: unknown) {
  const invalid = (field: string): never => {
    throw new ChapterCheckHistoryRequestError(`请求字段不合法：${field}`);
  };
  if (!isObj(value)) invalid('body');
  const body = value as Obj;
  for (const key of Object.keys(body)) if (!QUERY_KEYS.includes(key)) invalid(key);
  const root = body.project_root;
  if (typeof root !== 'string' || Array.from(root).length < 1 || Array.from(root).length > 32768)
    invalid('project_root');
  const sessionId = body.assistant_session_id;
  if (!strictInt(sessionId) || (sessionId as number) < 1) invalid('assistant_session_id');
  const limit = body.limit === undefined ? 20 : body.limit;
  if (!strictInt(limit) || (limit as number) < 1 || (limit as number) > 50) invalid('limit');
  return { projectRoot: root as string, sessionId: sessionId as number, limit: limit as number };
}

/** Python 的 `dict.get` 比较：缺失的键与显式的 null 都是 None。 */
const differs = (a: unknown, b: unknown) =>
  (a === undefined ? null : a) !== (b === undefined ? null : b);

const AMBIGUOUS = '此检查对应多个候选记录，归属存在歧义；未展示正文。';
const UNBOUND = '候选稿已脱敏或来源绑定不一致，未展示全文；请核对原运行证据。';

/** 候选稿只有在与检查、brief 逐项绑定时才展示正文。 */
function boundCandidate(
  candidates: ArtifactRecord[],
  check: Obj,
  brief: Obj | null,
): [ArtifactRecord | null, string | null] {
  if (!candidates.length) return [null, null];
  if (candidates.length !== 1) return [null, AMBIGUOUS];
  const row = candidates[0];
  const payload = row.payload;
  const content = payload.content;
  if (
    brief === null ||
    row.requires_confirmation ||
    payload.read_only !== true ||
    typeof content !== 'string' ||
    'before' in payload ||
    'after' in payload ||
    'approval_action' in payload ||
    differs(payload.target_path, brief.target_path) ||
    differs(payload.brief_id, brief.brief_id) ||
    differs(payload.brief_sha256, check.brief_sha256) ||
    differs(payload.content_sha256, check.content_sha256) ||
    differs(sha256Hex(content), check.content_sha256)
  )
    return [null, UNBOUND];
  return [row, null];
}

/** 库里存 `YYYY-MM-DD HH:MM:SS`（UTC），接口给 `YYYY-MM-DDTHH:MM:SS`（pydantic 的序列化）。 */
const apiTime = (value: string | null) => (value === null ? null : value.replace(' ', 'T'));

/**
 * 只读核对一个会话的章节检查历史（`/api/agent-runs/chapter-checks/query`）：每条检查配上
 * 它之前、哈希对得上的 brief，以及它与同 run 下一条检查之间的候选稿。最新的在前。
 */
export async function queryChapterCheckHistory(
  deps: ChapterCheckHistoryDeps,
  body: unknown,
): Promise<Obj> {
  const { projectRoot, sessionId, limit } = parseQuery(body);
  const conversation = await deps.sessions.getSession(sessionId);
  assertSessionProjectMatches(conversation, projectRoot, deps.platform);
  const runs = await deps.store.runsOfAssistantSession(sessionId);
  const publicIds = new Map(runs.map((run) => [run.id, run.public_id]));
  const artifacts: ArtifactRecord[] = [];
  for (const run of runs) artifacts.push(...(await deps.store.artifacts(run.id)));
  const checks = artifacts
    .filter((artifact) => artifact.kind === 'chapter_check')
    .sort((a, b) => b.id - a.id);
  const shown = checks.slice(0, limit);
  const runIds = new Set(shown.map((check) => check.run_id));
  const related = artifacts
    .filter(
      (artifact) =>
        runIds.has(artifact.run_id) &&
        (artifact.kind === 'chapter_brief' || artifact.kind === 'chapter_candidate'),
    )
    .sort((a, b) => b.id - a.id);
  const boundaries = checks.filter((check) => runIds.has(check.run_id));
  const entries: Obj[] = [];
  for (const check of shown) {
    const payload = check.payload;
    const brief =
      related.find(
        (row) =>
          row.run_id === check.run_id &&
          row.kind === 'chapter_brief' &&
          row.id < check.id &&
          !differs(checkSource('', row.payload).brief_sha256, payload.brief_sha256),
      )?.payload ?? null;
    const later = boundaries
      .filter((other) => other.run_id === check.run_id && other.id > check.id)
      .map((other) => other.id);
    const nextCheck = later.length ? Math.min(...later) : null;
    const candidates = related.filter(
      (row) =>
        row.run_id === check.run_id &&
        row.kind === 'chapter_candidate' &&
        row.id > check.id &&
        (nextCheck === null || row.id < nextCheck),
    );
    const [candidate, error] = boundCandidate(candidates, payload, brief);
    entries.push({
      run_id: publicIds.get(check.run_id),
      check_artifact_id: check.id,
      created_at: apiTime(await deps.store.artifactCreatedAt(check.id)),
      target_path: brief === null || brief.target_path === undefined ? null : brief.target_path,
      // 响应模型的序列化器对检查与候选稿再脱敏一次。
      check: redactSensitive(payload as PlainJson, deps.secrets),
      candidate:
        candidate === null ? null : redactSensitive(candidate.payload as PlainJson, deps.secrets),
      candidate_artifact_id: candidate === null ? null : candidate.id,
      candidate_error: error,
    });
  }
  return {
    project_root: projectRoot,
    assistant_session_id: sessionId,
    entries,
    truncated: checks.length > limit,
  };
}
