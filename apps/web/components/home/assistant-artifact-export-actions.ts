'use server';

import { redirect as nextRedirect } from 'next/navigation';
import { revalidatePath as nextRevalidatePath } from 'next/cache';

import {
  exportAuditReportRequest,
  exportEpubRequest,
  exportMarkdownRequest,
  readBookRun,
  type ApiRequest,
  type BookRunRead,
} from '../../app/book-runs/api';
import { apiFetch } from '../../lib/api-client';
import {
  appendAssistantSessionMessage,
  createAssistantSession,
  createAssistantToolCall,
} from './assistant-session-store';

type AssistantArtifactExportDeps = {
  readonly readBookRun?: (bookRunId: number) => Promise<BookRunRead | null>;
  readonly apiFetch?: (path: string, init: RequestInit) => Promise<Response>;
  readonly revalidatePath?: (path: string) => void;
  readonly redirect?: (url: string) => never;
  readonly writeAssistantArtifactExportSession?: (
    payload: AssistantArtifactExportSessionWrite,
  ) => Promise<number | void>;
  readonly writeAssistantToolCall?: (payload: AssistantToolCallWrite) => Promise<void>;
};

type AssistantArtifactExportSessionWrite = {
  readonly bookRunId: number;
  readonly assistantSessionId?: number;
  readonly artifacts: readonly ExportedArtifactSummary[];
};

type AssistantToolCallWrite = {
  readonly assistantSessionId: number;
  readonly toolName: string;
  readonly status: 'completed' | 'failed';
  readonly inputSummary: Record<string, unknown>;
  readonly outputSummary?: Record<string, unknown>;
  readonly errorMessage?: string;
  readonly relatedType?: string;
  readonly relatedId?: number;
};

const exportRequests = [
  exportMarkdownRequest,
  exportEpubRequest,
  exportAuditReportRequest,
] as const;

async function writeAssistantArtifactExportToolCall(
  payload: AssistantToolCallWrite,
): Promise<void> {
  const result = await createAssistantToolCall(payload.assistantSessionId, {
    tool_name: payload.toolName,
    status: payload.status,
    input_summary: payload.inputSummary,
    output_summary: payload.outputSummary ?? {},
    error_message: payload.errorMessage,
    related_type: payload.relatedType,
    related_id: payload.relatedId,
  });
  if (result.status === 'error') {
    throw new Error(result.message);
  }
}

async function writeArtifactExportFailureToolCall(
  deps: AssistantArtifactExportDeps,
  assistantSessionId: number | undefined,
  bookRunId: number,
  message: string,
): Promise<void> {
  if (!assistantSessionId) return;
  await (deps.writeAssistantToolCall ?? writeAssistantArtifactExportToolCall)({
    assistantSessionId,
    toolName: 'artifact.export',
    status: 'failed',
    inputSummary: { book_run_id: bookRunId },
    errorMessage: message,
    relatedType: 'book_run',
    relatedId: bookRunId,
  });
}

export async function submitAssistantArtifactExport(
  formData: FormData,
  deps: AssistantArtifactExportDeps = {},
) {
  const bookRunId = readPositiveInt(formData.get('book_run_id'));
  const assistantSessionId = readPositiveInt(formData.get('assistant_session_id'));
  const redirect = deps.redirect ?? nextRedirect;
  if (!bookRunId) {
    const params = new URLSearchParams({ artifact_export_status: 'invalid' });
    if (assistantSessionId) {
      params.set('assistant_session_id', String(assistantSessionId));
    }
    return redirect(`/?${params.toString()}`);
  }

  const readRun = deps.readBookRun ?? readBookRun;
  const run = await readRun(bookRunId);
  if (!run || run.status !== 'completed') {
    return redirect(buildArtifactExportResultUrl(bookRunId, 'not_ready', {}, assistantSessionId));
  }

  const fetcher = deps.apiFetch ?? apiFetch;
  const exportedArtifacts: ExportedArtifactSummary[] = [];
  let redirectAssistantSessionId: number | undefined;
  try {
    for (const buildRequest of exportRequests) {
      const request = buildRequest(bookRunId);
      exportedArtifacts.push(await submitExportRequest(fetcher, request));
    }
    const writtenAssistantSessionId = await (
      deps.writeAssistantArtifactExportSession ?? writeAssistantArtifactExportSession
    )({
      bookRunId,
      assistantSessionId,
      artifacts: exportedArtifacts,
    });
    redirectAssistantSessionId = writtenAssistantSessionId ?? assistantSessionId;
    if (redirectAssistantSessionId) {
      await (deps.writeAssistantToolCall ?? writeAssistantArtifactExportToolCall)({
        assistantSessionId: redirectAssistantSessionId,
        toolName: 'artifact.export',
        status: 'completed',
        inputSummary: { book_run_id: bookRunId },
        outputSummary: {
          summary: formatArtifactExportSummary(exportedArtifacts),
          artifact_ids: exportedArtifacts
            .map((artifact) => artifact.id)
            .filter((id): id is number => typeof id === 'number'),
        },
        relatedType: 'book_run',
        relatedId: bookRunId,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出链路返回失败。';
    await writeArtifactExportFailureToolCall(deps, assistantSessionId, bookRunId, message);
    return redirect(
      buildArtifactExportResultUrl(
        bookRunId,
        'failed',
        {
          artifact_export_error: message,
        },
        assistantSessionId,
      ),
    );
  }

  const revalidatePath = deps.revalidatePath ?? nextRevalidatePath;
  revalidatePath('/');
  return redirect(
    buildArtifactExportResultUrl(
      bookRunId,
      'ok',
      {
        artifact_export_summary: formatArtifactExportSummary(exportedArtifacts),
      },
      redirectAssistantSessionId,
    ),
  );
}

async function writeAssistantArtifactExportSession({
  bookRunId,
  assistantSessionId,
  artifacts,
}: AssistantArtifactExportSessionWrite): Promise<number> {
  const artifactSummary = formatArtifactExportSummary(artifacts);
  const content = `已导出 BookRun #${bookRunId} 制品：${artifactSummary}。`;

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

  const artifactId = artifacts.find((artifact) => artifact.id !== undefined)?.id;
  const result = await createAssistantSession({
    title: `BookRun #${bookRunId} 制品已导出`,
    task_type: 'artifact_export',
    book_run_id: bookRunId,
    artifact_id: artifactId,
    messages: [{ role: 'assistant', content }],
  });
  if (result.status === 'error') {
    throw new Error(result.message);
  }
  return result.data.id;
}

function buildArtifactExportResultUrl(
  bookRunId: number,
  status: 'ok' | 'failed' | 'not_ready',
  fields: Record<string, string>,
  assistantSessionId?: number,
): string {
  const params = new URLSearchParams({
    book_run_id: String(bookRunId),
    artifact_export_status: status,
  });
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) params.set(key, value);
  }
  if (assistantSessionId) {
    params.set('assistant_session_id', String(assistantSessionId));
  }
  return `/?${params.toString()}`;
}

async function submitExportRequest(
  fetcher: (path: string, init: RequestInit) => Promise<Response>,
  request: ApiRequest,
): Promise<ExportedArtifactSummary> {
  const response = await fetcher(request.path, request.init);
  if (!response.ok) {
    throw new Error(`导出失败：${request.path} 返回 ${response.status}`);
  }
  return readArtifactSummary(response, request);
}

type ExportedArtifactSummary = {
  readonly id?: number;
  readonly name: string;
  readonly version?: number;
  readonly mimeType?: string;
  readonly bookRunId?: number;
};

async function readArtifactSummary(
  response: Response,
  request: ApiRequest,
): Promise<ExportedArtifactSummary> {
  const fallback = fallbackArtifactName(request.path);
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const id = typeof payload.id === 'number' ? payload.id : undefined;
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name : fallback;
    const version = typeof payload.version === 'number' ? payload.version : undefined;
    const mimeType =
      typeof payload.mime_type === 'string' && payload.mime_type.trim()
        ? payload.mime_type
        : undefined;
    const artifactPayload = isRecord(payload.payload) ? payload.payload : {};
    const bookRunId =
      typeof artifactPayload.book_run_id === 'number'
        ? artifactPayload.book_run_id
        : bookRunIdFromRequestPath(request.path);
    return { id, name, version, mimeType, bookRunId };
  } catch {
    return { name: fallback };
  }
}

function fallbackArtifactName(path: string): string {
  if (path.endsWith('/exports/markdown')) return 'book.md';
  if (path.endsWith('/exports/epub')) return 'book.epub';
  if (path.endsWith('/exports/audit-report')) return 'audit_report.json';
  return '导出制品';
}

function formatArtifactExportSummary(artifacts: readonly ExportedArtifactSummary[]): string {
  return artifacts
    .map((artifact) => {
      const idLabel = artifact.id ? `${artifact.name}#${artifact.id}` : artifact.name;
      const versionLabel = artifact.version ? ` v${artifact.version}` : '';
      const details = [
        artifact.bookRunId ? `BookRun #${artifact.bookRunId}` : undefined,
        'Artifacts 下载摘要可查看',
      ].filter((value): value is string => value !== undefined);
      return details.length > 0
        ? `${idLabel}${versionLabel}（${details.join('，')}）`
        : `${idLabel}${versionLabel}`;
    })
    .join('、');
}

function bookRunIdFromRequestPath(path: string): number | undefined {
  const match = path.match(/\/api\/book-runs\/(\d+)\/exports\//);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPositiveInt(value: FormDataEntryValue | null): number | undefined {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
