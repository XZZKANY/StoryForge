import { TauriFileSystem } from './tauri-fs';
import { relativeToProject } from './project-context';

export type RevisionLoopRecord = {
  projectPath: string | null;
  filePath: string;
  before: string;
  after: string;
  summary: string;
  note: string;
  userIntent: string;
  assistantSessionId: number | null;
  patchId?: string | null;
  issueIds?: string[];
  contextFiles?: string[];
};

export type RevisionLoopResult = {
  recordPath: string | null;
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

function countCjkChars(content: string): number {
  return Array.from(content).filter((char) => /[\u4e00-\u9fff]/u.test(char)).length;
}

function countParagraphs(content: string): number {
  return content
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean).length;
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
    issueIds = [],
    contextFiles = [],
  } = record;
  if (!projectPath) return { recordPath: null };

  const relativePath = relativeToProject(projectPath, filePath);
  const recordPath = buildRevisionLoopRecordPath(projectPath, filePath);
  const content = [
    '# 作者闭环记录',
    '',
    `- 文件：${relativePath}`,
    `- 时间：${new Date().toISOString()}`,
    `- 动作：接受 AI 修订并写回正文`,
    `- Assistant Session：${assistantSessionId ?? '本地未记录'}`,
    `- Patch ID：${patchId ?? '本地未记录'}`,
    `- Issue IDs：${issueIds.length ? issueIds.join(', ') : '未限定'}`,
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

  await TauriFileSystem.writeFile(recordPath, content);
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

  await TauriFileSystem.writeFile(exportPath, exportContent);
  return { exportPath };
}
