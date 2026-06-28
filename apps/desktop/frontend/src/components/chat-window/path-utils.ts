import { isKnownAgentRoleMention } from '../../lib/agent-roles';

export function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function relativePath(projectPath: string | null, filePath: string): string {
  if (!projectPath) return basename(filePath);
  const root = projectPath.replace(/[/\\]+$/, '');
  if (filePath.startsWith(root)) {
    return filePath.slice(root.length).replace(/^[/\\]+/, '');
  }
  return basename(filePath);
}

export function joinProjectPath(projectPath: string, child: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath.replace(/[/\\]+$/, '')}${separator}${child.replace(/^[/\\]+/, '')}`;
}

export function looksAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(path) || path.startsWith('/') || path.startsWith('\\');
}

export function extractContextReferences(text: string): string[] {
  const matches = Array.from(text.matchAll(/@([^\s，。！？!?；;：:,、]+)/g));
  return matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => !isKnownAgentRoleMention(`@${value}`));
}
