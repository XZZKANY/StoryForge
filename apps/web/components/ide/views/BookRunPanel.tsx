import { useState } from 'react';

export type BookRunPanelRun = {
  readonly id: number;
  readonly status: string;
  readonly current_chapter_index: number;
  readonly total_chapters: number;
  readonly token_budget: number | null;
  readonly tokens_used: number;
  readonly elapsed_time_sec: number;
  readonly time_budget_sec: number | null;
  readonly estimated_cost: number;
  readonly checkpoint: readonly Record<string, unknown>[];
  readonly progress?: Record<string, unknown>;
  readonly blocked_chapter?: Record<string, unknown> | null;
  readonly provider_fallback?: Record<string, unknown> | null;
};

export type BookRunCommandResult = {
  readonly command_id: string;
  readonly status: string;
  readonly audit_event_id?: string | null;
  readonly payload?: Record<string, unknown>;
};

export type BookRunCommandExecutor = (
  commandId: string,
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export type BookRunCommandState = {
  readonly result?: BookRunCommandResult;
  readonly error?: string;
};

export type BookRunPanelProps = {
  readonly run?: BookRunPanelRun;
  readonly initialCommandResult?: BookRunCommandResult;
  readonly commandError?: string;
  readonly onExecuteCommand?: BookRunCommandExecutor;
};

type BookRunCommand = {
  readonly label: string;
  readonly commandId: string;
};

const bookRunCommands: readonly BookRunCommand[] = [
  { label: 'Start', commandId: 'bookrun.start' },
  { label: 'Pause', commandId: 'bookrun.pause' },
  { label: 'Resume', commandId: 'bookrun.resume' },
  { label: 'Stop', commandId: 'bookrun.stop' },
  { label: 'Retry from checkpoint', commandId: 'bookrun.retry_from_checkpoint' },
  { label: 'Open audit', commandId: 'audit.open' },
];

export function BookRunPanel({
  run,
  initialCommandResult,
  commandError,
  onExecuteCommand,
}: BookRunPanelProps) {
  const [latestCommandResult, setLatestCommandResult] = useState<BookRunCommandResult | undefined>(
    initialCommandResult,
  );
  const [latestCommandError, setLatestCommandError] = useState<string | undefined>(commandError);
  const executeCommand = async (commandId: string, args: Record<string, unknown>) => {
    if (!onExecuteCommand) return;
    setLatestCommandError(undefined);
    const nextState = await resolveBookRunCommandState(commandId, args, onExecuteCommand);
    if (nextState.result) {
      setLatestCommandResult(nextState.result);
    }
    if (nextState.error) {
      setLatestCommandError(nextState.error);
    }
  };
  if (!run) {
    return (
      <section className="space-y-3 rounded-xl border border-stone-800 bg-stone-900 p-4 text-stone-100">
        <header>
          <p className="text-xs uppercase tracking-wide text-stone-400">BookRun Run Panel</p>
          <h2 className="mt-1 text-lg font-semibold">运行控制台</h2>
        </header>
        <p className="rounded-lg border border-dashed border-stone-700 p-4 text-sm text-stone-400">
          当前没有选中的 BookRun
        </p>
        <CommandBar onExecuteCommand={executeCommand} />
        <CommandResult result={latestCommandResult} error={latestCommandError} />
      </section>
    );
  }

  const tokenBudgetLabel = run.token_budget === null ? 'unlimited' : String(run.token_budget);
  const remainingTokens =
    run.token_budget === null ? null : Math.max(run.token_budget - run.tokens_used, 0);

  return (
    <section className="space-y-4 rounded-xl border border-stone-800 bg-stone-900 p-4 text-stone-100">
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-400">BookRun Run Panel</p>
        <h2 className="mt-1 text-lg font-semibold">BookRun #{run.id}</h2>
        <p className="mt-2 text-sm text-stone-300">{run.status}</p>
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <Metric label="章节进度" value={`${run.current_chapter_index} / ${run.total_chapters}`} />
        <Metric label="Token 预算" value={`${run.tokens_used} / ${tokenBudgetLabel}`} />
        <Metric
          label="已用时间"
          value={`${run.elapsed_time_sec}s / ${run.time_budget_sec ?? 'unlimited'}s`}
        />
        <Metric label="预估成本" value={`$${run.estimated_cost}`} />
      </dl>

      {remainingTokens === null ? null : (
        <p className="text-xs text-stone-400">tokens remaining {remainingTokens}</p>
      )}

      <section className="rounded-lg border border-stone-800 bg-stone-950 p-3">
        <h3 className="text-sm font-semibold">checkpoint</h3>
        {run.checkpoint.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">暂无 checkpoint</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-stone-300">
            {run.checkpoint.map((item, index) => (
              <CheckpointItem key={`checkpoint:${index}`} item={item} index={index} />
            ))}
          </ul>
        )}
      </section>

      {run.blocked_chapter ? <BlockedChapterLink blockedChapter={run.blocked_chapter} /> : null}

      {run.provider_fallback ? (
        <section className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm">
          <h3 className="font-semibold text-amber-100">provider fallback</h3>
          <p className="mt-2 text-amber-100">{formatRecord(run.provider_fallback)}</p>
        </section>
      ) : null}

      <CommandBar runId={run.id} onExecuteCommand={executeCommand} />
      <CommandResult result={latestCommandResult} error={latestCommandError} />
    </section>
  );
}

export async function resolveBookRunCommandState(
  commandId: string,
  args: Record<string, unknown>,
  onExecuteCommand: BookRunCommandExecutor,
): Promise<BookRunCommandState> {
  try {
    const result = await onExecuteCommand(commandId, args);
    if (isBookRunCommandResult(result)) {
      return { result };
    }
    return { error: '命令响应格式错误' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function isBookRunCommandResult(value: unknown): value is BookRunCommandResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.command_id === 'string' &&
    typeof result.status === 'string' &&
    (typeof result.audit_event_id === 'string' ||
      result.audit_event_id === null ||
      result.audit_event_id === undefined)
  );
}

function CommandResult({
  result,
  error,
}: {
  readonly result?: BookRunCommandResult;
  readonly error?: string;
}) {
  if (!result && !error) return null;
  return (
    <section
      className="rounded-lg border border-stone-800 bg-stone-950 p-3 text-sm"
      data-command-result-id={result?.command_id}
      data-command-result-status={result?.status}
      data-audit-event-id={result?.audit_event_id ?? undefined}
    >
      <h3 className="font-semibold">最近命令结果</h3>
      {result ? (
        <dl className="mt-2 space-y-1 text-stone-300">
          <div>
            <dt className="inline text-stone-400">command_id=</dt>
            <dd className="inline font-mono">{result.command_id}</dd>
          </div>
          <div>
            <dt className="inline text-stone-400">status=</dt>
            <dd className="inline font-mono">{result.status}</dd>
          </div>
          {result.audit_event_id ? (
            <div>
              <dt className="inline text-stone-400">audit_event_id=</dt>
              <dd className="inline font-mono">{result.audit_event_id}</dd>
              <span className="sr-only">audit_event_id={result.audit_event_id}</span>
            </div>
          ) : null}
        </dl>
      ) : null}
      {error ? <p className="mt-2 text-red-200">命令执行失败：{error}</p> : null}
    </section>
  );
}

function CheckpointItem({
  item,
  index,
}: {
  readonly item: Record<string, unknown>;
  readonly index: number;
}) {
  const chapterIndex = numberValue(item.chapter_index);
  const checkpointHref = chapterHref(chapterIndex);
  return (
    <li
      className="rounded border border-stone-800 bg-stone-900 p-2"
      data-checkpoint-index={chapterIndex ?? undefined}
      data-checkpoint-href={checkpointHref ?? undefined}
    >
      <p>{formatRecord(item)}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {checkpointHref ? (
          <a className="rounded bg-stone-800 px-2 py-1 text-stone-100" href={checkpointHref}>
            打开章节 {chapterIndex}
          </a>
        ) : null}
        <OptionalLink href={modelRunHref(numberValue(item.model_run_id))} label="ModelRun" />
        <OptionalLink
          href={judgeReportHref(numberValue(item.judge_report_id))}
          label="JudgeReport"
        />
        <OptionalLink href={approveHref(numberValue(item.approved_scene_id))} label="Approve" />
      </div>
      <span className="sr-only">{`checkpoint:${index}`}</span>
    </li>
  );
}

function BlockedChapterLink({
  blockedChapter,
}: {
  readonly blockedChapter: Record<string, unknown>;
}) {
  const chapterIndex = numberValue(blockedChapter.chapter_index);
  const href = chapterHref(chapterIndex);
  return (
    <section
      className="rounded-lg border border-red-900/70 bg-red-950/30 p-3 text-sm"
      data-blocked-chapter-index={chapterIndex ?? undefined}
      data-blocked-chapter-href={href ?? undefined}
    >
      <h3 className="font-semibold text-red-100">
        blocked chapter {String(chapterIndex ?? 'unknown')}
      </h3>
      <p className="mt-2 text-red-100">{formatRecord(blockedChapter)}</p>
      {href ? (
        <a
          className="mt-2 inline-block rounded bg-red-900 px-2 py-1 text-xs text-red-100"
          href={href}
        >
          打开阻塞章节
        </a>
      ) : null}
    </section>
  );
}

function OptionalLink({ href, label }: { readonly href: string | null; readonly label: string }) {
  if (!href) return null;
  return (
    <a className="rounded bg-stone-800 px-2 py-1 text-stone-100" href={href}>
      {label}
    </a>
  );
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function chapterHref(chapterIndex: number | null): string | null {
  return chapterIndex === null ? null : `/ide?tab=chapter:${chapterIndex}`;
}

function modelRunHref(modelRunId: number | null): string | null {
  return modelRunId === null ? null : `/ide?panel.bottom=runs&model_run=${modelRunId}`;
}

function judgeReportHref(judgeReportId: number | null): string | null {
  return judgeReportId === null ? null : `/ide?panel.bottom=problems&judge_report=${judgeReportId}`;
}

function approveHref(approvedSceneId: number | null): string | null {
  return approvedSceneId === null ? null : `/ide?tab=scene:${approvedSceneId}`;
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg bg-stone-950 p-3">
      <dt className="text-stone-400">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function CommandBar({
  runId,
  onExecuteCommand,
}: {
  readonly runId?: number;
  readonly onExecuteCommand?: BookRunCommandExecutor;
}) {
  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950 p-3">
      <p className="text-xs text-stone-400">
        写操作通过 CommandRegistry 执行，并由 /api/ide/commands 返回 audit_event_id。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {bookRunCommands.map((command) => (
          <button
            key={command.commandId}
            type="button"
            data-command-id={command.commandId}
            onClick={() => onExecuteCommand?.(command.commandId, commandArgs(runId))}
            className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-100 hover:bg-stone-700"
          >
            {command.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function commandArgs(runId: number | undefined): Record<string, unknown> {
  return runId === undefined ? {} : { book_run_id: runId };
}

function formatRecord(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' · ');
}
