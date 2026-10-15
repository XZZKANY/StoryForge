import type { ProjectReader, ProjectWriter } from '@storyforge/engine';

/**
 * 影子档（P5-1）的项目读写口：写入一律截在内存里（不碰作者的 `.storyforge/`，Python 那一侧照常在写），
 * 读取先看截下的写入、再落到真实读口——引擎刷新派生缓存后再读，读到的是自己这一次写出来的版本，
 * 与 Python 那一侧「写了再读」一致。路径按真实读口解析后的项目相对路径对齐。
 */
export function overlayProject(base: ProjectReader): {
  reader: ProjectReader;
  writer: ProjectWriter;
  writes: () => readonly string[];
} {
  const files = new Map<string, Uint8Array>();
  const key = (root: string, relative: string) => `${root}\u0000${relative}`;
  const resolved = async (root: string, path: string) =>
    (await base.resolveProjectPath(root, path)).resolvedRelativePath;
  const children = (root: string, directory: string) => {
    const prefix = key(root, directory === '.' ? '' : `${directory}/`);
    const names = new Set<string>();
    for (const file of files.keys())
      if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split('/')[0]);
    return names;
  };

  const reader: ProjectReader = {
    resolveProjectPath: (root, path) => base.resolveProjectPath(root, path),
    async inspectProjectPath(root, path) {
      const relative = await resolved(root, path);
      const own = files.get(key(root, relative));
      if (own)
        return {
          entryKind: 'file',
          targetKind: 'file',
          isReparsePoint: false,
          sizeBytes: own.length,
        };
      const metadata = await base.inspectProjectPath(root, path);
      if (metadata.targetKind === 'missing' && children(root, relative).size)
        return {
          entryKind: 'directory',
          targetKind: 'directory',
          isReparsePoint: false,
          sizeBytes: 0,
        };
      return metadata;
    },
    async readProjectDirectory(root, path, remainingEntries) {
      const relative = await resolved(root, path);
      const own = children(root, relative);
      if (!own.size) return base.readProjectDirectory(root, path, remainingEntries);
      const metadata = await base.inspectProjectPath(root, path);
      const listed =
        metadata.targetKind === 'directory'
          ? await base.readProjectDirectory(root, path, remainingEntries + own.size)
          : { names: [], exceeded: false, terminalError: null };
      const names = [...new Set([...listed.names, ...own])].sort();
      return {
        names: names.slice(0, remainingEntries + 1),
        exceeded: names.length > remainingEntries,
        terminalError: names.length > remainingEntries ? null : listed.terminalError,
      };
    },
    async readProjectBytes(root, path, maxBytes) {
      const own = files.get(key(root, await resolved(root, path)));
      if (!own) return base.readProjectBytes(root, path, maxBytes);
      return { bytes: own.slice(0, maxBytes + 1), exceeded: own.length > maxBytes };
    },
  };
  const writer: ProjectWriter = {
    async writeProjectFile(root, relativePath, bytes) {
      files.set(key(root, relativePath), bytes.slice());
    },
  };
  return { reader, writer, writes: () => [...files.keys()].map((item) => item.split('\u0000')[1]) };
}
