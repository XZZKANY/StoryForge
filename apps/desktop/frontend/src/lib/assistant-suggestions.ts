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
};

function appendSuggestionBlock(content: string, userIntent: string): string {
  const trimmed = content.trimEnd();
  const block = [
    '',
    '',
    '---',
    '',
    '## StoryForge 建议',
    '',
    `- 用户意图：${userIntent.trim() || '审查并改进当前文件'}`,
    '- 建议：先把结构问题落在当前文件，再决定是否同步到正文或关联设定。',
    '- 下一步：确认本文件修改后，检查关联文件是否需要同步更新。',
  ].join('\n');
  return `${trimmed}${block}`;
}

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
  } = params;
  return {
    id: id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filePath,
    title: 'AI 修订建议',
    summary,
    before,
    after,
    note: [
      `用户意图：${userIntent.trim() || '审查并改进当前文件'}`,
      `模型：${model || '未知'}`,
      issueIds.length ? `Issue Scope：${issueIds.join(', ')}` : '',
      contextFiles.length ? `上下文：${contextFiles.join(', ')}` : '',
      '接受会写入当前文件；拒绝则丢弃；保存旁注会写入 .storyforge/notes。',
    ]
      .filter(Boolean)
      .join('\n'),
    createdAt: Date.now(),
    model,
    assistantSessionId: assistantSessionId ?? null,
    issueIds,
    contextFiles,
  };
}

export function createLocalFileSuggestion(params: {
  filePath: string;
  content: string;
  userIntent: string;
}): AssistantFileSuggestion {
  const { filePath, content, userIntent } = params;
  const after = appendSuggestionBlock(content, userIntent);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filePath,
    title: '建议写入当前文件',
    summary: '在当前文件末尾追加一段可确认的 StoryForge 建议，作为后续同步正文或关联设定的依据。',
    before: content,
    after,
    note: [
      '这条建议先保存为文件内的结构化旁注。',
      '接受后会写入当前文件；拒绝则丢弃；保存旁注会写入 .storyforge/notes。',
    ].join('\n'),
    createdAt: Date.now(),
    issueIds: [],
    contextFiles: [],
  };
}
