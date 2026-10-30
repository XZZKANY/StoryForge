import { FsToolError, resolveProjectRoot } from '../kernel/fsTools';
import {
  dumpJson,
  InputDomainError,
  JsonFields,
  parseJsonBytes,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { platformTextBytes, type ProjectWriter } from '../writePort';

/**
 * 批量写章的记录 `.storyforge/write-batch.json`：只记最近一批。
 * 单独一个文件，不放进 serial-plan.json：AI 用 project.plan_update 改计划时不会和它互相盖掉；
 * 每章「已写」照旧由 markChapterWritten 标在 serial-plan.json 里。
 * 记录是记录，不是真值：哪章写没写一律以正文为准，读的时候对不上要标出来。
 */

export const WRITE_BATCH_RELATIVE_PATH = '.storyforge/write-batch.json';
export const WRITE_BATCH_VERSION = 1;
/** 范围最多 10000 章（防误输入），每章一条，缩进排版后几 MB；读的预算放宽到 16 MiB。 */
const WRITE_BATCH_MAX_BYTES = 16 * 1024 * 1024;

export type WriteBatchStatus = 'running' | 'stopped' | 'finished';

/**
 * 停下的原因。前四个是上一章没写成（规则 1），接着两个是修订等作者处理（规则 2），
 * 之后依次是事实对不上、只读、换模型、用到上限、试写量完（规则 3–6），
 * 最后三个由界面送来（作者按停止、应用上次被关掉、这一章没能开跑）。
 */
export type WriteBatchStopCode =
  | 'run_failed'
  | 'run_stopped'
  | 'check_blocked'
  | 'no_revision'
  | 'needs_confirmation'
  | 'writeback_blocked'
  | 'fact_disputes'
  | 'read_only'
  | 'model_changed'
  | 'cap_reached'
  | 'trial_done'
  | 'author_stopped'
  | 'app_closed'
  | 'run_not_started';

export const WRITE_BATCH_STOP_CODES: readonly WriteBatchStopCode[] = [
  'run_failed',
  'run_stopped',
  'check_blocked',
  'no_revision',
  'needs_confirmation',
  'writeback_blocked',
  'fact_disputes',
  'read_only',
  'model_changed',
  'cap_reached',
  'trial_done',
  'author_stopped',
  'app_closed',
  'run_not_started',
];

/** 界面能送来的停下原因；其余都由引擎判定。 */
export const INTERFACE_STOP_CODES: readonly WriteBatchStopCode[] = [
  'author_stopped',
  'app_closed',
  'run_not_started',
];

export type WriteBatchStop = {
  code: WriteBatchStopCode;
  /** 给作者看的说明。 */
  message: string;
  /** 停在哪一章（续写从这里看起）；说不出是哪章时为 null。 */
  ordinal: number | null;
};

export type WriteBatchLegRun = { ordinal: number; run_id: string; tokens: number };

/** 开跑或续跑一段算一条：续跑会重新估、重新确认，所以上限按段算。 */
export type WriteBatchLeg = {
  started_at: string;
  basis: 'history' | 'trial';
  /** 试写段没有预估与上限。 */
  estimated_tokens: number | null;
  cap_tokens: number | null;
  /** 这一段已记的各章运行用量之和。 */
  used_tokens: number;
  /** 这一段记过的运行，按记的先后；最后一条就是「上一章」。 */
  runs: WriteBatchLegRun[];
};

export type WriteBatchChapterState =
  | 'pending'
  | 'written'
  | 'stopped_here'
  | 'skipped_written'
  | 'after_trial';

export type WriteBatchCheck = {
  /** unchecked：检查器重查后仍没给出结果，这章未经检查。 */
  verdict: 'pass' | 'repairable' | 'blocked' | 'unchecked';
  issue_count: number;
  summary: string;
};

export type WriteBatchRecordChapter = {
  ordinal: number;
  target_path: string;
  state: WriteBatchChapterState;
  run_id: string | null;
  /** 引擎读盘算的，界面送来的不收。 */
  written_sha256: string | null;
  chars: number | null;
  check: WriteBatchCheck | null;
  tokens: number | null;
  /** 写前快照对应的版本记录、记账前的事实台账版本：只有界面知道，原样存，撤销时用。 */
  snapshot_version: string | null;
  facts_before: string | null;
  fact_disputes: number | null;
};

export type WriteBatchRecord = {
  version: number;
  id: string;
  from: number;
  to: number;
  created_at: string;
  /** 当前这一段开跑时界面送来的模型配置标识（续跑时换成新的）。 */
  model_key: string;
  status: WriteBatchStatus;
  /** 作者在清单上点了「这批审完了」。 */
  reviewed: boolean;
  stop: WriteBatchStop | null;
  legs: WriteBatchLeg[];
  chapters: WriteBatchRecordChapter[];
};

const CHAPTER_STATES: readonly WriteBatchChapterState[] = [
  'pending',
  'written',
  'stopped_here',
  'skipped_written',
  'after_trial',
];
const VERDICTS: readonly WriteBatchCheck['verdict'][] = [
  'pass',
  'repairable',
  'blocked',
  'unchecked',
];

/** 按应用写出的格式逐字段校验；对不上就整份不认，不当成「没有批量」。 */
class RecordFields extends JsonFields {
  constructor() {
    super(WRITE_BATCH_RELATIVE_PATH);
  }
  count(value: JsonValue | undefined, path: string): number {
    const number = this.integer(value, path);
    if (!Number.isSafeInteger(number) || number < 0) this.fail(path, '非负整数', value);
    return number;
  }
  ordinal(value: JsonValue | undefined, path: string): number {
    const number = this.integer(value, path);
    if (!Number.isSafeInteger(number) || number < 1) this.fail(path, '从 1 起的整数', value);
    return number;
  }
  nullable<T>(
    value: JsonValue | undefined,
    path: string,
    read: (value: JsonValue | undefined, path: string) => T,
  ): T | null {
    if (value === undefined) this.fail(path, '值或 null', value);
    return value === null ? null : read(value, path);
  }
  oneOf<T extends string>(value: JsonValue | undefined, path: string, allowed: readonly T[]): T {
    const text = this.string(value, path);
    if (!(allowed as readonly string[]).includes(text))
      throw new InputDomainError(`${this.source} 的 ${path} 不认识：${text}`);
    return text as T;
  }
  at(object: JsonObject, key: string): JsonValue | undefined {
    return this.member(object, key);
  }
  array(value: JsonValue | undefined, path: string, nonEmpty = false): JsonValue[] {
    if (!Array.isArray(value) || (nonEmpty && !value.length))
      return this.fail(path, nonEmpty ? '非空数组' : '数组', value);
    return value;
  }
}

function parseStop(fields: RecordFields, value: JsonValue | undefined): WriteBatchStop {
  const stop = fields.object(value, 'stop');
  return {
    code: fields.oneOf(fields.at(stop, 'code'), 'stop.code', WRITE_BATCH_STOP_CODES),
    message: fields.string(fields.at(stop, 'message'), 'stop.message'),
    ordinal: fields.nullable(fields.at(stop, 'ordinal'), 'stop.ordinal', (v, p) =>
      fields.ordinal(v, p),
    ),
  };
}

function parseLeg(fields: RecordFields, value: JsonValue, at: string): WriteBatchLeg {
  const leg = fields.object(value, at);
  const runs = fields.array(fields.at(leg, 'runs'), `${at}.runs`);
  return {
    started_at: fields.string(fields.at(leg, 'started_at'), `${at}.started_at`),
    basis: fields.oneOf(fields.at(leg, 'basis'), `${at}.basis`, ['history', 'trial'] as const),
    estimated_tokens: fields.nullable(
      fields.at(leg, 'estimated_tokens'),
      `${at}.estimated_tokens`,
      (v, p) => fields.count(v, p),
    ),
    cap_tokens: fields.nullable(fields.at(leg, 'cap_tokens'), `${at}.cap_tokens`, (v, p) =>
      fields.count(v, p),
    ),
    used_tokens: fields.count(fields.at(leg, 'used_tokens'), `${at}.used_tokens`),
    runs: runs.map((item, index) => {
      const where = `${at}.runs[${index}]`;
      const run = fields.object(item, where);
      return {
        ordinal: fields.ordinal(fields.at(run, 'ordinal'), `${where}.ordinal`),
        run_id: fields.string(fields.at(run, 'run_id'), `${where}.run_id`),
        tokens: fields.count(fields.at(run, 'tokens'), `${where}.tokens`),
      };
    }),
  };
}

function parseCheck(fields: RecordFields, value: JsonValue, at: string): WriteBatchCheck {
  const check = fields.object(value, at);
  return {
    verdict: fields.oneOf(fields.at(check, 'verdict'), `${at}.verdict`, VERDICTS),
    issue_count: fields.count(fields.at(check, 'issue_count'), `${at}.issue_count`),
    summary: fields.string(fields.at(check, 'summary'), `${at}.summary`),
  };
}

function parseChapter(fields: RecordFields, value: JsonValue, at: string): WriteBatchRecordChapter {
  const chapter = fields.object(value, at);
  const text = (key: string) =>
    fields.nullable(fields.at(chapter, key), `${at}.${key}`, (v, p) => fields.string(v, p));
  const count = (key: string) =>
    fields.nullable(fields.at(chapter, key), `${at}.${key}`, (v, p) => fields.count(v, p));
  return {
    ordinal: fields.ordinal(fields.at(chapter, 'ordinal'), `${at}.ordinal`),
    target_path: fields.string(fields.at(chapter, 'target_path'), `${at}.target_path`),
    state: fields.oneOf(fields.at(chapter, 'state'), `${at}.state`, CHAPTER_STATES),
    run_id: text('run_id'),
    written_sha256: text('written_sha256'),
    chars: count('chars'),
    check: fields.nullable(fields.at(chapter, 'check'), `${at}.check`, (v, p) =>
      parseCheck(fields, v!, p),
    ),
    tokens: count('tokens'),
    snapshot_version: text('snapshot_version'),
    facts_before: text('facts_before'),
    fact_disputes: count('fact_disputes'),
  };
}

/** 校验一份批量记录；版本不认识、字段不对、章与范围对不上都报 InputDomainError。 */
export function parseWriteBatchRecord(value: JsonValue): WriteBatchRecord {
  const fields = new RecordFields();
  const raw = fields.object(value, '顶层');
  const version = fields.integer(fields.at(raw, 'version'), 'version');
  if (version !== WRITE_BATCH_VERSION)
    throw new InputDomainError(
      `${WRITE_BATCH_RELATIVE_PATH} 的版本是 ${version}，这一版只认 ${WRITE_BATCH_VERSION}：` +
        '可能是更新的 StoryForge 写的，先升级再打开。',
    );
  const from = fields.ordinal(fields.at(raw, 'from'), 'from');
  const to = fields.ordinal(fields.at(raw, 'to'), 'to');
  if (from > to) throw new InputDomainError(`${WRITE_BATCH_RELATIVE_PATH} 的 from 大于 to`);
  const legs = fields.array(fields.at(raw, 'legs'), 'legs', true);
  const chapters = fields.array(fields.at(raw, 'chapters'), 'chapters');
  const record: WriteBatchRecord = {
    version,
    id: fields.string(fields.at(raw, 'id'), 'id'),
    from,
    to,
    created_at: fields.string(fields.at(raw, 'created_at'), 'created_at'),
    model_key: fields.string(fields.at(raw, 'model_key'), 'model_key'),
    status: fields.oneOf(fields.at(raw, 'status'), 'status', [
      'running',
      'stopped',
      'finished',
    ] as const),
    reviewed: fields.boolean(fields.at(raw, 'reviewed'), 'reviewed'),
    stop: fields.nullable(fields.at(raw, 'stop'), 'stop', (v) => parseStop(fields, v)),
    legs: legs.map((item, index) => parseLeg(fields, item, `legs[${index}]`)),
    chapters: chapters.map((item, index) => parseChapter(fields, item, `chapters[${index}]`)),
  };
  if (record.chapters.length !== to - from + 1)
    throw new InputDomainError(`${WRITE_BATCH_RELATIVE_PATH} 的章数和范围对不上`);
  record.chapters.forEach((chapter, index) => {
    if (chapter.ordinal !== from + index)
      throw new InputDomainError(
        `${WRITE_BATCH_RELATIVE_PATH} 的 chapters[${index}] 应是第 ${from + index} 章`,
      );
  });
  if ((record.status === 'stopped') !== (record.stop !== null))
    throw new InputDomainError(`${WRITE_BATCH_RELATIVE_PATH} 的 status 和 stop 对不上`);
  return record;
}

/** 读最近一批；文件不存在为 null。读不到报 FsToolError，写坏了或版本不认识报 InputDomainError。 */
export async function readWriteBatchRecord(
  reader: ProjectReader,
  root: string,
): Promise<WriteBatchRecord | null> {
  await resolveProjectRoot(reader, root);
  let raw: Uint8Array;
  try {
    const kind = (await reader.inspectProjectPath(root, WRITE_BATCH_RELATIVE_PATH)).targetKind;
    if (kind === 'missing') return null;
    if (kind !== 'file') throw new InputDomainError(`${WRITE_BATCH_RELATIVE_PATH} 不是文件`);
    const target = await reader.resolveProjectPath(root, WRITE_BATCH_RELATIVE_PATH);
    const read = await reader.readProjectBytes(
      root,
      target.resolvedRelativePath,
      WRITE_BATCH_MAX_BYTES,
    );
    if (read.exceeded) throw new InputDomainError(`${WRITE_BATCH_RELATIVE_PATH}：文件超过 16 MiB`);
    raw = read.bytes;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    throw new FsToolError(`${WRITE_BATCH_RELATIVE_PATH} 读不出来：${error.message}`);
  }
  return parseWriteBatchRecord(parseJsonBytes(raw, WRITE_BATCH_RELATIVE_PATH));
}

/** 原子写（宿主负责：同目录临时文件 + 刷盘 + 替换），与 serial-plan.json 同一个写口。 */
export async function writeWriteBatchRecord(
  writer: ProjectWriter,
  root: string,
  record: WriteBatchRecord,
  platform: 'windows' | 'posix',
): Promise<void> {
  const text = dumpJson(record, { indent: 2, ensureAscii: false });
  await writer.writeProjectFile(root, WRITE_BATCH_RELATIVE_PATH, platformTextBytes(text, platform));
}
