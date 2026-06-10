import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { apiFetch, type ApiFetchInit } from '../../lib/api-client';
import {
  appendAssistantSessionMessage,
  createAssistantSession,
} from './assistant-session-store';
import {
  writeAssistantToolCall,
  type AssistantToolCallWrite,
} from './assistant-tools/tool-call-writer';

type AssistantBookRunCommand = 'pause' | 'resume' | 'stop' | 'retry';

type AssistantBookRunSessionWrite = {
  readonly bookRunId: number;
  readonly blueprintId?: number;
  readonly command: AssistantBookRunCommand;
  readonly assistantSessionId?: number;
};

type AssistantBookRunActionDependencies = {
  readonly apiFetch: (path: string, init: ApiFetchInit) => Promise<Response>;
  readonly revalidatePath: (path: string) => void;
  readonly redirect: (url: string) => never;
  readonly writeAssistantBookRunSession?: (
    payload: AssistantBookRunSessionWrite,
  ) => Promise<number | void>;
  readonly writeAssistantToolCall?: (payload: AssistantToolCallWrite) => Promise<void>;
};

function readPositiveInt(formData: FormData, key: string): number | undefined {
  const value = formData.get(key);
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readCommand(formData: FormData): AssistantBookRunCommand | undefined {
  const value = formData.get('book_run_command');
  return value === 'pause' || value === 'resume' || value === 'stop' || value === 'retry'
    ? value
    : undefined;
}

function buildResultUrl(
  bookRunId: number,
  status: string,
  message?: string,
  assistantSessionId?: number,
): string {
  const params = new URLSearchParams({
    book_run_id: String(bookRunId),
    book_run_command_status: status,
  });
  if (assistantSessionId) {
    params.set('assistant_session_id', String(assistantSessionId));
  }
  if (message) {
    params.set('book_run_command_message', message);
  }
  return `/?${params.toString()}`;
}

function formatCommandLabel(command: AssistantBookRunCommand): string {
  const labels: Record<AssistantBookRunCommand, string> = {
    pause: '暂停',
    resume: '恢复',
    stop: '停止',
    retry: '重试',
  };
  return labels[command];
}

async function writeAssistantBookRunSession({
  bookRunId,
  blueprintId,
  command,
  assistantSessionId,
}: AssistantBookRunSessionWrite): Promise<number> {
  const commandLabel = formatCommandLabel(command);
  const references = [`BookRun #${bookRunId}`, blueprintId ? `Blueprint #${blueprintId}` : null]
    .filter((value): value is string => value !== null)
    .join('，关联 ');
  const content = `已${commandLabel} ${references}。`;

  if (assistantSessionId) {
    const result = await appendAssistantSessionMessage(assistantSessionId, {
      role: 'assistant',
      content,
    });
    if (result.status === 'error') {
      throw new Error(result.message);
    }
    return assistantSessionId;
  }

  const result = await createAssistantSession({
    title: `BookRun #${bookRunId} 已${commandLabel}`,
    task_type: 'trial_generation',
    blueprint_id: blueprintId,
    book_run_id: bookRunId,
    messages: [{ role: 'assistant', content }],
  });
  if (result.status === 'error') {
    throw new Error(result.message);
  }
  return result.data.id;
}

async function writeBookRunFailureToolCall(
  dependencies: AssistantBookRunActionDependencies,
  assistantSessionId: number | undefined,
  bookRunId: number,
  command: AssistantBookRunCommand,
  message: string,
): Promise<void> {
  if (!assistantSessionId) return;
  await (dependencies.writeAssistantToolCall ?? writeAssistantToolCall)({
    assistantSessionId,
    toolName: `book_run.${command}`,
    status: 'failed',
    inputSummary: { book_run_id: bookRunId, command },
    errorMessage: message,
    relatedType: 'book_run',
    relatedId: bookRunId,
  });
}

export async function submitAssistantBookRunCommand(
  formData: FormData,
  dependencies: AssistantBookRunActionDependencies = {
    apiFetch,
    revalidatePath,
    redirect,
  },
): Promise<never> {
  'use server';

  const bookRunId = readPositiveInt(formData, 'book_run_id');
  const blueprintId = readPositiveInt(formData, 'blueprint_id');
  const assistantSessionId = readPositiveInt(formData, 'assistant_session_id');
  const command = readCommand(formData);
  if (!bookRunId || !command) {
    const params = new URLSearchParams({ book_run_command_status: 'invalid' });
    if (assistantSessionId) {
      params.set('assistant_session_id', String(assistantSessionId));
    }
    return dependencies.redirect(`/?${params.toString()}`);
  }

  const init: ApiFetchInit = { method: 'POST' };
  if (command === 'pause' || command === 'stop') {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify({
      reason: command === 'pause' ? '用户从 Assistant 暂停' : '用户从 Assistant 停止',
    });
  }

  let response: Response;
  try {
    response = await dependencies.apiFetch(`/api/book-runs/${bookRunId}/${command}`, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    await writeBookRunFailureToolCall(dependencies, assistantSessionId, bookRunId, command, message);
    return dependencies.redirect(buildResultUrl(bookRunId, 'failed', message, assistantSessionId));
  }
  if (!response.ok) {
    const message = `BookRun API 返回 ${response.status}`;
    await writeBookRunFailureToolCall(dependencies, assistantSessionId, bookRunId, command, message);
    return dependencies.redirect(
      buildResultUrl(bookRunId, 'failed', message, assistantSessionId),
    );
  }

  let redirectAssistantSessionId: number | undefined;
  try {
    const writtenAssistantSessionId = await (
      dependencies.writeAssistantBookRunSession ?? writeAssistantBookRunSession
    )({
      bookRunId,
      blueprintId,
      command,
      assistantSessionId,
    });
    redirectAssistantSessionId = writtenAssistantSessionId ?? assistantSessionId;
    if (redirectAssistantSessionId) {
      await (dependencies.writeAssistantToolCall ?? writeAssistantToolCall)({
        assistantSessionId: redirectAssistantSessionId,
        toolName: `book_run.${command}`,
        status: 'completed',
        inputSummary: { book_run_id: bookRunId, command },
        outputSummary: { summary: `已${formatCommandLabel(command)} BookRun #${bookRunId}。` },
        relatedType: 'book_run',
        relatedId: bookRunId,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return dependencies.redirect(buildResultUrl(bookRunId, 'failed', message, assistantSessionId));
  }

  dependencies.revalidatePath('/');
  return dependencies.redirect(
    buildResultUrl(bookRunId, 'ok', undefined, redirectAssistantSessionId),
  );
}
