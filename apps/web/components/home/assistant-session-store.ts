import { apiFetch, readJson, type ApiFetchInit, type ApiResult } from '../../lib/api-client';
import type { HomeRecentItem } from './home-data';

type AssistantSessionRead = {
  readonly id: number;
  readonly title: string;
  readonly task_type: string;
  readonly blueprint_id: number | null;
  readonly book_run_id: number | null;
  readonly artifact_id: number | null;
  readonly messages: readonly unknown[];
  readonly created_at?: string;
  readonly updated_at?: string;
};

type AssistantMessageCreate = {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
};

type AssistantMessageRead = AssistantMessageCreate & {
  readonly id: number;
  readonly session_id: number;
  readonly created_at?: string;
  readonly updated_at?: string;
};

export type AssistantToolCallStatus =
  | 'planned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'needs_approval'
  | 'paused';

export type AssistantToolCallRead = {
  readonly id: number;
  readonly session_id: number;
  readonly tool_name: string;
  readonly status: AssistantToolCallStatus;
  readonly input_summary: Record<string, unknown>;
  readonly output_summary: Record<string, unknown>;
  readonly error_message: string | null;
  readonly related_type: string | null;
  readonly related_id: number | null;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type AssistantSessionDetail = Omit<AssistantSessionRead, 'messages'> & {
  readonly messages: readonly AssistantMessageRead[];
};

export type AssistantSessionCreate = {
  readonly title: string;
  readonly task_type: string;
  readonly blueprint_id?: number | null;
  readonly book_run_id?: number | null;
  readonly artifact_id?: number | null;
  readonly messages?: readonly AssistantMessageCreate[];
};

export type AssistantToolCallCreate = {
  readonly tool_name: string;
  readonly status: AssistantToolCallStatus;
  readonly input_summary?: Record<string, unknown>;
  readonly output_summary?: Record<string, unknown>;
  readonly error_message?: string | null;
  readonly related_type?: string | null;
  readonly related_id?: number | null;
  readonly started_at?: string | null;
  readonly finished_at?: string | null;
};

export type AssistantToolCallUpdate = Partial<AssistantToolCallCreate>;

function formatAssistantTaskType(taskType: string): string {
  const labels: Record<string, string> = {
    trial_generation: '试读生成',
    chapter_review: '章节审阅',
    artifact_export: '产物导出',
    goal_update: '目标调整',
  };
  return labels[taskType] ?? taskType;
}

function buildAssistantSessionHref(session: AssistantSessionRead): string {
  const params = new URLSearchParams({
    assistant_session_id: String(session.id),
  });
  if (session.book_run_id) {
    params.set('book_run_id', String(session.book_run_id));
  }
  if (session.artifact_id) {
    params.set('artifact_id', String(session.artifact_id));
  }
  if (session.blueprint_id) {
    params.set('blueprint_id', String(session.blueprint_id));
  }
  return `/?${params.toString()}`;
}

export function mapAssistantSessionToHomeRecentItem(session: AssistantSessionRead): HomeRecentItem {
  const references = [
    session.book_run_id ? `BookRun #${session.book_run_id}` : null,
    session.artifact_id ? `Artifact #${session.artifact_id}` : null,
    session.blueprint_id ? `Blueprint #${session.blueprint_id}` : null,
  ].filter((value): value is string => value !== null);

  const referenceSummary =
    references.length > 0 ? `，关联 ${references.join(' / ')}` : '，暂无关联任务';

  const updatedAt = session.updated_at ?? session.created_at;
  return {
    title: session.title,
    summary: `${formatAssistantTaskType(session.task_type)}${referenceSummary}`,
    href: buildAssistantSessionHref(session),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function isAssistantSessionRead(value: unknown): value is AssistantSessionRead {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const session = value as Partial<AssistantSessionRead>;
  return (
    typeof session.id === 'number' &&
    typeof session.title === 'string' &&
    typeof session.task_type === 'string' &&
    Array.isArray(session.messages)
  );
}

function isAssistantSessionDetail(value: unknown): value is AssistantSessionDetail {
  return isAssistantSessionRead(value) && value.messages.every(isAssistantMessageRead);
}

function isAssistantSessionList(value: unknown): value is readonly AssistantSessionRead[] {
  return Array.isArray(value) && value.every(isAssistantSessionRead);
}

function isAssistantMessageRead(value: unknown): value is AssistantMessageRead {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Partial<AssistantMessageRead>;
  return (
    typeof message.id === 'number' &&
    typeof message.session_id === 'number' &&
    (message.role === 'user' || message.role === 'assistant' || message.role === 'system') &&
    typeof message.content === 'string'
  );
}

function isAssistantToolCallStatus(value: unknown): value is AssistantToolCallStatus {
  return (
    value === 'planned' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'needs_approval' ||
    value === 'paused'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isAssistantToolCallRead(value: unknown): value is AssistantToolCallRead {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'number' &&
    typeof value.session_id === 'number' &&
    typeof value.tool_name === 'string' &&
    isAssistantToolCallStatus(value.status) &&
    isRecord(value.input_summary) &&
    isRecord(value.output_summary) &&
    isNullableString(value.error_message) &&
    isNullableString(value.related_type) &&
    isNullableNumber(value.related_id) &&
    isNullableString(value.started_at) &&
    isNullableString(value.finished_at) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isAssistantToolCallList(value: unknown): value is readonly AssistantToolCallRead[] {
  return Array.isArray(value) && value.every(isAssistantToolCallRead);
}

async function postAssistantJson<T>(
  path: string,
  body: unknown,
  validate: (value: unknown) => value is T,
  invalidMessage: string,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<ApiResult<T>> {
  const init: ApiFetchInit = {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  try {
    const response = await apiFetch(path, init);
    if (!response.ok) {
      return { status: 'error', message: `API 返回 ${response.status}` };
    }
    const payload: unknown = await response.json();
    if (!validate(payload)) {
      return { status: 'error', message: invalidMessage };
    }
    return { status: 'ready', data: payload };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : '未知错误' };
  }
}

export async function createAssistantSession(
  payload: AssistantSessionCreate,
): Promise<ApiResult<AssistantSessionRead>> {
  return postAssistantJson(
    '/api/assistant/sessions',
    payload,
    isAssistantSessionRead,
    'Assistant 会话创建响应格式不正确',
  );
}

export async function appendAssistantSessionMessage(
  assistantSessionId: number,
  payload: AssistantMessageCreate,
): Promise<ApiResult<AssistantMessageRead>> {
  return postAssistantJson(
    `/api/assistant/sessions/${assistantSessionId}/messages`,
    payload,
    isAssistantMessageRead,
    'Assistant 会话消息响应格式不正确',
  );
}

export async function readRecentAssistantSessions(
  limit = 8,
): Promise<ApiResult<readonly HomeRecentItem[]>> {
  const result = await readJson<readonly AssistantSessionRead[]>('/api/assistant/sessions', {
    params: { limit },
    validate: isAssistantSessionList,
    invalidMessage: 'Assistant 最近会话响应格式不正确',
  });

  if (result.status === 'error') {
    return result;
  }

  return {
    status: 'ready',
    data: result.data.map(mapAssistantSessionToHomeRecentItem),
  };
}

export async function readAssistantSession(
  assistantSessionId: number,
): Promise<ApiResult<AssistantSessionDetail>> {
  return readJson<AssistantSessionDetail>(`/api/assistant/sessions/${assistantSessionId}`, {
    validate: isAssistantSessionDetail,
    invalidMessage: 'Assistant 会话详情响应格式不正确',
  });
}

export async function readAssistantToolCalls(
  assistantSessionId: number,
): Promise<ApiResult<readonly AssistantToolCallRead[]>> {
  return readJson<readonly AssistantToolCallRead[]>(
    `/api/assistant/sessions/${assistantSessionId}/tool-calls`,
    {
      validate: isAssistantToolCallList,
      invalidMessage: 'Assistant 工具调用响应格式不正确',
    },
  );
}

export async function createAssistantToolCall(
  assistantSessionId: number,
  payload: AssistantToolCallCreate,
): Promise<ApiResult<AssistantToolCallRead>> {
  return postAssistantJson(
    `/api/assistant/sessions/${assistantSessionId}/tool-calls`,
    payload,
    isAssistantToolCallRead,
    'Assistant 工具调用创建响应格式不正确',
  );
}

export async function updateAssistantToolCall(
  toolCallId: number,
  payload: AssistantToolCallUpdate,
): Promise<ApiResult<AssistantToolCallRead>> {
  return postAssistantJson(
    `/api/assistant/tool-calls/${toolCallId}`,
    payload,
    isAssistantToolCallRead,
    'Assistant 工具调用更新响应格式不正确',
    'PATCH',
  );
}
