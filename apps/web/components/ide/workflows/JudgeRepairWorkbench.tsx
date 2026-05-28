'use client';

import { useState } from 'react';

import type { IdeCommandResponse } from '../commands/command-client';
import type { Diagnostic } from '../../../../../packages/shared/src/diagnostic';
import { createCommandRegistry, type CommandRegistry } from '../commands/registry';
import { registerBuiltinCommands } from '../commands/registerBuiltinCommands';
import { ChapterEditor } from '../editors/ChapterEditor';
import { ProblemsPanel } from '../panels/ProblemsPanel';
import { DiffViewer } from '../views/DiffViewer';

export type JudgeRepairResult = {
  readonly before: string;
  readonly after: string;
  readonly repair_patch_id?: number | string;
  readonly audit_event_id?: string | null;
};

export type JudgeApprovalResult = {
  readonly audit_event_id?: string | null;
};

export type JudgeCommandExecutor = (
  commandId: string,
  args: Record<string, unknown>,
) => Promise<IdeCommandResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function repairPatchId(value: unknown): number | string | undefined {
  if (!isRecord(value)) return undefined;
  const id = value.id ?? value.repair_patch_id;
  return typeof id === 'number' || typeof id === 'string' ? id : undefined;
}

function applyRepairPatch(content: string, patch: Record<string, unknown>): string {
  const targetSpan = stringValue(patch.target_span);
  const replacementText = stringValue(patch.replacement_text);
  if (targetSpan) {
    return content.replace(targetSpan, replacementText);
  }
  const spanStart = patch.span_start;
  const spanEnd = patch.span_end;
  if (
    typeof spanStart === 'number' &&
    typeof spanEnd === 'number' &&
    spanStart >= 0 &&
    spanStart <= spanEnd &&
    spanEnd <= content.length
  ) {
    return `${content.slice(0, spanStart)}${replacementText}${content.slice(spanEnd)}`;
  }
  return content;
}

export function buildJudgeRepairCommandArgs(
  diagnostic: Diagnostic,
  content: string,
): Record<string, unknown> {
  const fix = diagnostic.quickFixes?.find((item) => item.command_id === 'judge.repair');
  return { ...commandArgs(fix?.args), content };
}

export async function resolveJudgeRepairResult(
  diagnostic: Diagnostic,
  content: string,
  executeCommand: JudgeCommandExecutor,
): Promise<JudgeRepairResult> {
  const response = await executeCommand(
    'judge.repair',
    buildJudgeRepairCommandArgs(diagnostic, content),
  );
  const patch = isRecord(response.payload.patch) ? response.payload.patch : {};
  return {
    before: content,
    after: applyRepairPatch(content, patch),
    repair_patch_id: repairPatchId(patch),
    audit_event_id: response.audit_event_id,
  };
}

export async function resolveJudgeApprovalResult(
  repairPatchId: number | string,
  executeCommand: JudgeCommandExecutor,
): Promise<JudgeApprovalResult> {
  const response = await executeCommand('judge.approve', { repair_patch_id: repairPatchId });
  return { audit_event_id: response.audit_event_id };
}

export type JudgeRepairWorkbenchProps = {
  readonly content: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly selectedDiagnosticId?: string;
  readonly judgeRunArgs?: Record<string, unknown>;
  readonly repairResult?: JudgeRepairResult;
  readonly approvalResult?: JudgeApprovalResult;
  readonly commands?: CommandRegistry;
  readonly onContentChange?: (content: string) => void;
};

function defaultCommandRegistry(): CommandRegistry {
  return registerBuiltinCommands(createCommandRegistry());
}

function commandArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function JudgeRepairWorkbench({
  content,
  diagnostics,
  selectedDiagnosticId,
  judgeRunArgs = {},
  repairResult,
  approvalResult,
  commands = defaultCommandRegistry(),
  onContentChange = () => undefined,
}: JudgeRepairWorkbenchProps) {
  const selectedDiagnostic =
    diagnostics.find((diagnostic) => diagnostic.id === selectedDiagnosticId) ?? diagnostics[0];
  const selectedRange = selectedDiagnostic
    ? `${selectedDiagnostic.range.start}:${selectedDiagnostic.range.end}`
    : '';
  const [resolvedRepairResult, setResolvedRepairResult] = useState<JudgeRepairResult | undefined>(
    repairResult,
  );
  const [resolvedApprovalResult, setResolvedApprovalResult] = useState<
    JudgeApprovalResult | undefined
  >(approvalResult);
  const [commandError, setCommandError] = useState<string | undefined>();
  const activeRepairResult = resolvedRepairResult ?? repairResult;
  const activeApprovalResult = resolvedApprovalResult ?? approvalResult;
  const approveArgs = activeRepairResult?.repair_patch_id
    ? { repair_patch_id: activeRepairResult.repair_patch_id }
    : {};
  const executeCommand: JudgeCommandExecutor = (commandId, args) =>
    commands.execute(commandId, args);

  return (
    <section
      aria-label="Judge Repair Workbench"
      className="grid gap-4"
      data-testid="judge-repair-workbench"
      data-command-chain="judge.run judge.repair judge.approve"
      data-selected-diagnostic-id={selectedDiagnostic?.id ?? ''}
      data-selected-range={selectedRange}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-white"
          data-command-id="judge.run"
          data-command-args={JSON.stringify(judgeRunArgs)}
          onClick={() => {
            setCommandError(undefined);
            void commands.execute('judge.run', judgeRunArgs).catch((error: unknown) => {
              setCommandError(error instanceof Error ? error.message : String(error));
            });
          }}
        >
          运行 Judge
        </button>
      </div>
      <ChapterEditor content={content} diagnostics={diagnostics} onChange={onContentChange} />
      <ProblemsPanel
        diagnostics={diagnostics}
        onSelectDiagnostic={() => undefined}
        onQuickFix={(diagnostic) => {
          setCommandError(undefined);
          void resolveJudgeRepairResult(diagnostic, content, executeCommand)
            .then((result) => {
              setResolvedRepairResult(result);
              setResolvedApprovalResult(undefined);
            })
            .catch((error: unknown) => {
              setCommandError(error instanceof Error ? error.message : String(error));
            });
        }}
      />
      {commandError ? <p className="text-sm text-rose-300">命令执行失败：{commandError}</p> : null}
      {activeRepairResult ? (
        <DiffViewer
          before={activeRepairResult.before}
          after={activeRepairResult.after}
          approveCommandId="judge.approve"
          approveArgs={approveArgs}
          auditEventId={activeApprovalResult?.audit_event_id ?? activeRepairResult.audit_event_id}
          onApprove={() => {
            if (!activeRepairResult?.repair_patch_id) return;
            setCommandError(undefined);
            void resolveJudgeApprovalResult(activeRepairResult.repair_patch_id, executeCommand)
              .then(setResolvedApprovalResult)
              .catch((error: unknown) => {
                setCommandError(error instanceof Error ? error.message : String(error));
              });
          }}
        />
      ) : (
        <p className="text-sm text-stone-300">选择诊断后可生成修复 Diff。</p>
      )}
    </section>
  );
}
