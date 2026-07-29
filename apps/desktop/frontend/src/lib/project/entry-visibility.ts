import type { FileEntry } from '../tauri-fs';

/** 与后端 `app/common/author_voice.py::RELATIVE_PATH` 同一个文件，两处须同改。 */
const AUTHOR_INSTRUCTIONS_CHILD = 'agent-instructions.md';

function visibleStoryforgeChild(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  const child = normalizedPath.match(/\/\.storyforge\/(.+)$/)?.[1];
  return (
    !child ||
    child === 'canon' ||
    child.startsWith('canon/') ||
    // 作者自定义指令是作者写给 agent 看的，藏起来等于要求他跳出 IDE 用外部工具在隐藏
    // 目录里手工建文件。放行后文件树 / 快速打开 / 项目搜索三处入口一并打通。
    child === AUTHOR_INSTRUCTIONS_CHILD
  );
}

export function isAuthorInstructionsPath(path: string | null): boolean {
  return Boolean(path && /[/\\]\.storyforge[/\\]agent-instructions\.md$/i.test(path));
}

function normalizedExtension(entry: FileEntry): string {
  return entry.extension?.toLowerCase() ?? '';
}

export function isCanonDeclarationPath(path: string | null): boolean {
  return Boolean(path && /[/\\]\.storyforge[/\\]canon[/\\]canon\.json$/i.test(path));
}

export function isReadOnlyDerivedProjectPath(path: string | null): boolean {
  return Boolean(path && /[/\\]\.storyforge[/\\]canon[/\\]derived[/\\]/i.test(path));
}

export function isVisibleProjectTreeEntry(entry: FileEntry): boolean {
  const extension = normalizedExtension(entry);
  return (
    visibleStoryforgeChild(entry.path) &&
    (entry.isDir ||
      extension === 'md' ||
      extension === 'markdown' ||
      isCanonDeclarationPath(entry.path))
  );
}

export function isOpenableProjectFileEntry(entry: FileEntry): boolean {
  return !entry.isDir && isVisibleProjectTreeEntry(entry);
}
