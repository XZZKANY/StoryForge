import { TauriFileSystem } from './tauri-fs';
import { relativeToProject } from './project-context';
import { countCjkChars, countParagraphs } from './text-metrics';
import { writeReceiptAudit } from './writeback-audit';
import type { IssueCounts, IssueResolution } from './suggestion-ops';

export type RevisionLoopRecord = {
  /** Ephemeral admission, excluded from semantic payload and stored evidence. */
  deliveryTicket?: string;
  projectPath: string | null;
  filePath: string;
  before: string;
  after: string;
  summary: string;
  note: string;
  userIntent: string;
  assistantSessionId: number | null;
  patchId?: string | null;
  /** Native writeback receipt identity, used for idempotent local audit repair. */
  operationId?: string;
  issueIds?: string[];
  /** 每个问题在本次写回中的归属态；旧记录可能没有，只有扁平 issueIds 时用 readRevisionLoopIssues 补 open。 */
  issueResolutions?: IssueResolution[];
  issueCounts?: IssueCounts;
  /** false 表示这些问题拿不到行范围、无法归属；记录里显式写「未归属」，不报 0/N。 */
  issueAttributed?: boolean;
  contextFiles?: string[];
};

export type RevisionLoopResult = {
  recordPath: string | null;
  writebackWarning?: string | null;
};

export type ExportCurrentFileResult = {
  exportPath: string;
};

function separator(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

function normalizeRoot(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '');
}

function timestampSlug(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function projectChildPath(projectPath: string, segments: string[]): string {
  const s = separator(projectPath);
  return [normalizeRoot(projectPath), ...segments].join(s);
}

export function buildRevisionLoopRecordPath(
  projectPath: string,
  filePath: string,
  stamp = new Date(),
): string {
  const sourceName = stripMarkdownExtension(basename(filePath));
  return projectChildPath(projectPath, [
    '.storyforge',
    'author-loop',
    `${timestampSlug(stamp)}-${sourceName}.md`,
  ]);
}

export function buildExportPath(projectPath: string, filePath: string, stamp = new Date()): string {
  const sourceName = stripMarkdownExtension(basename(filePath));
  return projectChildPath(projectPath, ['导出', `${timestampSlug(stamp)}-${sourceName}.md`]);
}

export async function recordRevisionLoop(record: RevisionLoopRecord): Promise<RevisionLoopResult> {
  const {
    projectPath,
    filePath,
    before,
    after,
    summary,
    note,
    userIntent,
    assistantSessionId,
    patchId,
    operationId,
    issueIds = [],
    issueResolutions = [],
    issueCounts,
    issueAttributed = true,
    contextFiles = [],
  } = record;
  if (!projectPath) return { recordPath: null };

  const relativePath = relativeToProject(projectPath, filePath);
  if (operationId !== undefined && !/^[a-f0-9]{64}$/.test(operationId)) {
    throw new Error('写回回执 operationId 无效');
  }
  const recordPath = operationId
    ? projectChildPath(projectPath, ['.storyforge', 'author-loop', `${operationId}.md`])
    : buildRevisionLoopRecordPath(projectPath, filePath);
  const content = [
    '# 作者闭环记录',
    '',
    `- 文件：${relativePath}`,
    `- 时间：${new Date().toISOString()}`,
    `- 动作：接受 AI 修订并写回正文`,
    `- Assistant Session：${assistantSessionId ?? '本地未记录'}`,
    `- Patch ID：${patchId ?? '本地未记录'}`,
    ...(operationId ? [`- Writeback Operation：${operationId}`] : []),
    `- Issue IDs：${issueIds.length ? issueIds.join(', ') : '未限定'}`,
    ...(issueResolutions.length
      ? [
          `- Issue Status：${issueResolutions.map((issue) => `${issue.id}=${issue.status}`).join(', ')}${issueAttributed ? '' : ' (unattributed: 无行范围)'}`,
        ]
      : []),
    ...(issueCounts && issueCounts.observed > 0 && issueAttributed
      ? [
          `- Issue Counts：observed ${issueCounts.observed} / author-confirmed ${issueCounts.authorConfirmed} / resolved ${issueCounts.resolved}`,
        ]
      : []),
    `- 上下文文件：${contextFiles.length ? contextFiles.join(', ') : '未记录'}`,
    `- 修改前字数：${countCjkChars(before)}`,
    `- 修改后字数：${countCjkChars(after)}`,
    `- 修改后段落：${countParagraphs(after)}`,
    '',
    '## 用户意图',
    '',
    userIntent.trim() || '审查并改进当前文件',
    '',
    '## 修订摘要',
    '',
    summary,
    '',
    '## 决策备注',
    '',
    note,
  ].join('\n');

  if (operationId) {
    const semanticPayload = JSON.stringify({
      file: relativePath,
      before,
      after,
      summary,
      note,
      userIntent,
      assistantSessionId,
      patchId: patchId ?? null,
      issueIds,
      ...(issueResolutions.length ? { issueResolutions } : {}),
      ...(issueAttributed ? {} : { issueAttribution: 'unattributed' }),
      ...(issueCounts && issueCounts.observed > 0 ? { issueCounts } : {}),
      contextFiles,
    });
    await writeReceiptAudit(
      projectPath,
      recordPath,
      operationId,
      semanticPayload,
      content,
      record.deliveryTicket,
    );
  } else {
    await TauriFileSystem.writeFile(projectPath, recordPath, content);
  }
  return { recordPath };
}

export async function exportCurrentFile(params: {
  projectPath: string;
  filePath: string;
  content: string;
}): Promise<ExportCurrentFileResult> {
  const { projectPath, filePath, content } = params;
  const exportPath = buildExportPath(projectPath, filePath);
  const sourceName = stripMarkdownExtension(basename(filePath));
  const relativePath = relativeToProject(projectPath, filePath);
  const exportContent = [
    `# ${sourceName}`,
    '',
    '<!--',
    `StoryForge Desktop Export`,
    `Source: ${relativePath}`,
    `ExportedAt: ${new Date().toISOString()}`,
    '-->',
    '',
    content.trimEnd(),
    '',
  ].join('\n');

  await TauriFileSystem.writeFile(projectPath, exportPath, exportContent);
  return { exportPath };
}

/**
 * 读取闭环记录的问题归属：新记录带 issueResolutions，旧记录只有扁平 issueIds——后者视为
 * 未归属（open），不臆造状态，旧记录仍可读。
 */
export function readRevisionLoopIssues(
  record: Pick<RevisionLoopRecord, 'issueIds' | 'issueResolutions'>,
): IssueResolution[] {
  if (record.issueResolutions && record.issueResolutions.length > 0) return record.issueResolutions;
  return (record.issueIds ?? []).map((id) => ({ id, status: 'open' as const }));
}
