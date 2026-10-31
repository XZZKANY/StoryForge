import type { ProjectReader } from '../readPort';
import type { ProjectWriter } from '../writePort';
import {
  BookBreakdownError,
  readBookBreakdownStatus,
  runBookBreakdown,
  type BreakdownCancellations,
  type BreakdownModel,
} from './bookBreakdown';
import {
  assertArgsInDomain,
  executeBookContextCommand,
  IdeCommandExecutionError,
} from './bookContextCommand';
import { buildCanonProjection } from './canonService';
import { FsToolError } from './fsTools';
import { InputDomainError } from './json';
import { runObservatoryScan } from './observatory';
import { optionalString } from './pythonText';
import { redactSensitive, type PlainJson, type SecretContext } from './redaction';
import { markChapterWritten, unmarkChapterWritten } from './serialPlanUpdate';

export type IdeCommandDefinition = { id: string; title: string; category: string; writes: boolean };

/** 命令目录与 Python 一致；都只写 `.storyforge/` 派生物或什么都不写，故 writes=false。 */
export const IDE_COMMANDS: readonly IdeCommandDefinition[] = [
  { id: 'audit.open', title: '打开审计记录', category: 'Audit', writes: false },
  { id: 'canon.refresh', title: '刷新 Canon 事实卡（dossier）', category: 'Canon', writes: false },
  { id: 'observatory.scan', title: '重扫世界线观测镜', category: 'Canon', writes: false },
  { id: 'book.breakdown', title: '生成结构化拆书报告', category: 'Analysis', writes: false },
  { id: 'book.breakdown.cancel', title: '取消结构化拆书', category: 'Analysis', writes: false },
  { id: 'book.breakdown.status', title: '检查拆书报告状态', category: 'Analysis', writes: false },
  { id: 'book.context', title: '读取作品底座', category: 'Manuscript', writes: false },
  {
    id: 'plan.mark_written',
    title: '标记章节已写入连载计划',
    category: 'Manuscript',
    writes: false,
  },
  {
    id: 'plan.unmark_written',
    title: '撤销章节的连载计划标记',
    category: 'Manuscript',
    writes: false,
  },
];
const COMMANDS = new Map(IDE_COMMANDS.map((command) => [command.id, command]));

export type IdeCommandDeps = {
  reader: ProjectReader;
  writer: ProjectWriter;
  /** 调用方持有的完整有序密钥快照（P2 的配置 owner 提供）。 */
  secrets: SecretContext;
  platform: 'windows' | 'posix';
  now: () => Date;
  cancellations: BreakdownCancellations;
  /** 已配置模型时拆书做结构化分析；未配置为 null。 */
  breakdownModel: BreakdownModel | null;
  newAnalysisId: () => string;
  /** P4 的运行记录：把拆书结果记成 Agent run 与产物；缺省不记。 */
  recordBreakdownRun?: (output: {
    [key: string]: unknown;
  }) => Promise<{ run_id: string; artifact_id: string | number }>;
};

type Args = { [key: string]: PlainJson };

function projectRoot(command: IdeCommandDefinition, args: Args, platform: 'windows' | 'posix') {
  const root = optionalString(args.project_root);
  if (root === null) throw new IdeCommandExecutionError(`${command.id} 需要 project_root。`);
  const absolute = platform === 'windows' ? /^(?:[a-z]:[\\/]|\\\\)/i : /^\//;
  if (!absolute.test(root))
    throw new IdeCommandExecutionError(`${command.id} 的 project_root 必须是绝对路径。`);
  return root;
}

/** 领域错误照原文给作者（400）；其余按 Python 未捕获异常的 500 处理。 */
async function domain<T>(
  run: () => Promise<T>,
  errors: readonly (new (...args: never[]) => Error)[],
) {
  try {
    return await run();
  } catch (error) {
    if (errors.some((type) => error instanceof type))
      throw new IdeCommandExecutionError((error as Error).message, 400, error);
    throw error;
  }
}

async function runCommand(command: IdeCommandDefinition, args: Args, deps: IdeCommandDeps) {
  const { reader, writer, platform } = deps;
  const glob = () => optionalString(args.glob) ?? '*.md';
  switch (command.id) {
    case 'audit.open':
      return null;
    case 'canon.refresh': {
      const root = projectRoot(command, args, platform);
      const projection = await domain(
        () =>
          buildCanonProjection(reader, writer, root, {
            glob: glob(),
            refresh: args.refresh !== false,
            platform,
          }),
        [FsToolError],
      );
      return { canon: projection.output };
    }
    case 'observatory.scan': {
      const root = projectRoot(command, args, platform);
      const output = await domain(
        () => runObservatoryScan(reader, writer, root, { platform, now: deps.now, glob: glob() }),
        [FsToolError],
      );
      return { observatory: output };
    }
    case 'book.breakdown': {
      const root = projectRoot(command, args, platform);
      const target = Object.prototype.hasOwnProperty.call(args, 'target_count')
        ? args.target_count
        : 8;
      if (typeof target !== 'number' || !Number.isInteger(target) || target < 3 || target > 12)
        throw new IdeCommandExecutionError('book.breakdown 的 target_count 必须在 3 到 12 之间。');
      const analysisId = optionalString(args.analysis_id);
      let output: { [key: string]: unknown } = await domain(
        () =>
          runBookBreakdown(reader, writer, root, {
            platform,
            targetCount: target,
            model: deps.breakdownModel,
            analysisId,
            cancellation: analysisId ? deps.cancellations.prepare(analysisId) : null,
            cancellations: deps.cancellations,
            newAnalysisId: deps.newAnalysisId,
            writingSkills: args.writing_skills === true,
          }),
        [BookBreakdownError, FsToolError],
      );
      if (deps.recordBreakdownRun)
        output = { ...output, ...(await deps.recordBreakdownRun(output)) };
      return { breakdown: output };
    }
    case 'book.breakdown.cancel': {
      const analysisId = optionalString(args.analysis_id);
      if (analysisId === null)
        throw new IdeCommandExecutionError('book.breakdown.cancel 需要 analysis_id。');
      return {
        breakdown: {
          analysis_id: analysisId,
          cancellation_requested: deps.cancellations.request(analysisId),
        },
      };
    }
    case 'book.breakdown.status': {
      const root = projectRoot(command, args, platform);
      const output = await domain(
        () => readBookBreakdownStatus(reader, root, platform),
        [BookBreakdownError, FsToolError],
      );
      return { breakdown: output };
    }
    default: {
      // plan.mark_written / plan.unmark_written：「没改」不是错误，如实带 reason 返回。
      const root = projectRoot(command, args, platform);
      const filePath = optionalString(args.file_path);
      if (filePath === null) throw new IdeCommandExecutionError(`${command.id} 需要 file_path。`);
      const update =
        command.id === 'plan.unmark_written' ? unmarkChapterWritten : markChapterWritten;
      return { plan: await update(reader, writer, root, filePath, platform) };
    }
  }
}

/**
 * 执行已注册的 IDE 命令并返回与 HTTP 响应相同的信封。
 * 请求体不是对象 → 422，未知命令 → 404，参数或领域状态不满足 → 400（原文给作者），其余 → 500。
 */
export async function executeIdeCommand(
  commandId: string,
  args: Record<string, unknown>,
  deps: IdeCommandDeps,
) {
  if (commandId === 'book.context')
    return executeBookContextCommand(deps.reader, args, deps.secrets, deps.platform);
  // 与 HTTP 请求同一 JSON 边界：省略 undefined、调用 toJSON。
  const request = JSON.parse(JSON.stringify({ args })) as { args?: unknown };
  const supplied = request.args === undefined ? {} : request.args;
  if (supplied === null || Array.isArray(supplied) || typeof supplied !== 'object')
    throw new IdeCommandExecutionError('API 返回 422', 422);
  const command = COMMANDS.get(commandId);
  if (command === undefined) throw new IdeCommandExecutionError(`未知 IDE 命令：${commandId}`, 404);
  const original = supplied as Args;
  assertArgsInDomain(command.id, original);
  let extra: { [key: string]: unknown } | null;
  try {
    extra = await runCommand(command, original, deps);
  } catch (error) {
    if (error instanceof IdeCommandExecutionError) throw error;
    // 作者声明或参考文本写错：把指出位置的原文交给作者。
    if (error instanceof InputDomainError)
      throw new IdeCommandExecutionError(error.message, 400, error);
    throw new IdeCommandExecutionError('API 返回 500', 500, error);
  }
  const payload: { [key: string]: PlainJson } = {
    title: command.title,
    category: command.category,
    writes: command.writes,
    args: redactSensitive(original, deps.secrets),
    ...(extra
      ? (redactSensitive(extra as PlainJson, deps.secrets) as { [key: string]: PlainJson })
      : {}),
  };
  // _accepted_command_result 先脱敏 args / extra，再脱敏整个 payload；字段序列化器再脱敏一次。
  return {
    command_id: command.id,
    status: 'accepted',
    audit_event_id: null,
    payload: redactSensitive(redactSensitive(payload, deps.secrets), deps.secrets),
  };
}
