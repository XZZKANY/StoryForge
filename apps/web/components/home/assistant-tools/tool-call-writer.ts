import { createAssistantToolCall } from '../assistant-session-store';

export type AssistantToolCallWrite = {
  readonly assistantSessionId: number;
  readonly toolName: string;
  readonly status: 'completed' | 'failed';
  readonly inputSummary: Record<string, unknown>;
  readonly outputSummary?: Record<string, unknown>;
  readonly errorMessage?: string;
  readonly relatedType?: string;
  readonly relatedId?: number;
};

export async function writeAssistantToolCall(payload: AssistantToolCallWrite): Promise<void> {
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
