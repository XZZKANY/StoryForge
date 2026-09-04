export type KnowledgeContextEntry = {
  knowledgeId: string;
  relativePath: string;
  selectionSource: 'author_pinned' | 'auto_retrieved';
  evidenceState: 'current' | 'stale';
  warningCount: number;
  snapshotId: string;
};

export type AssistantFileSuggestion = {
  id: string;
  filePath: string;
  title: string;
  summary: string;
  before: string;
  after: string;
  note: string;
  createdAt: number;
  model?: string;
  assistantSessionId?: number | null;
  issueIds?: string[];
  contextFiles?: string[];
  knowledgeEntries?: KnowledgeContextEntry[];
  userIntent?: string;
  scopeWarning?: string;
  /** 缺省即 true：只有后端按项目权限档位明确判定不必确认时才是 false。 */
  requiresConfirmation?: boolean;
  /** 发起这次写回的 AgentRun；写进快照 meta，用来认出「同一轮的改动」。 */
  runId?: string;
};

export function createRemoteFileSuggestion(params: {
  id?: string;
  filePath: string;
  before: string;
  after: string;
  summary: string;
  model: string;
  userIntent: string;
  assistantSessionId?: number | null;
  issueIds?: string[];
  contextFiles?: string[];
  knowledgeEntries?: KnowledgeContextEntry[];
  scopeWarning?: string;
  requiresConfirmation?: boolean;
  runId?: string;
}): AssistantFileSuggestion {
  const {
    id,
    filePath,
    before,
    after,
    summary,
    model,
    userIntent,
    assistantSessionId,
    issueIds = [],
    contextFiles = [],
    knowledgeEntries = [],
    scopeWarning,
    requiresConfirmation = true,
    runId,
  } = params;
  return {
    id: id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filePath,
    title: 'AI 修订',
    summary,
    before,
    after,
    note: [
      `用户意图：${userIntent.trim() || '审查并改进当前文件'}`,
      `模型：${model || '未知'}`,
      issueIds.length ? `问题范围：${issueIds.join(', ')}` : '',
      contextFiles.length ? `上下文：${contextFiles.join(', ')}` : '',
      scopeWarning ? `⚠ 范围提醒：${scopeWarning}` : '',
      requiresConfirmation
        ? '接受会写入当前文件；拒绝则丢弃；保存旁注会写入 .storyforge/notes。'
        : '本项目为自动档：已直接写入当前文件（写前留了快照，可在通知里撤销）。',
    ]
      .filter(Boolean)
      .join('\n'),
    createdAt: Date.now(),
    model,
    assistantSessionId: assistantSessionId ?? null,
    issueIds,
    contextFiles,
    knowledgeEntries,
    userIntent,
    scopeWarning,
    requiresConfirmation,
    runId,
  };
}
