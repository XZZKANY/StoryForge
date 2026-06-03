export type AssistantTaskType =
  | 'trial_generation'
  | 'chapter_review'
  | 'artifact_export'
  | 'goal_update';

export type AssistantToolStatus = 'completed' | 'running' | 'waiting' | 'failed' | 'needs_approval';

export type AssistantToolNode = {
  readonly id: string;
  readonly label: string;
  readonly tool: string;
  readonly status: AssistantToolStatus;
  readonly elapsedLabel?: string;
  readonly tokenLabel?: string;
  readonly toolUseLabel?: string;
  readonly summary: string;
};

export type AssistantMessage = {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly createdAt: string;
  readonly taskType?: AssistantTaskType;
  readonly toolNodes?: readonly AssistantToolNode[];
};
