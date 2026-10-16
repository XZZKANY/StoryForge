import { ProjectReadError, type ProjectReader, type ProjectWriter } from '@storyforge/engine';

/** 调用 Python 之前读下的一组文件（项目相对路径 → 字节；null = 当时不存在）。 */
export type Preimage = ReadonlyMap<string, Uint8Array | null>;

/**
 * 影子档（P5-1）的项目读写口：写入一律截在内存里（不碰作者的 `.storyforge/`，Python 那一侧照常在写），
 * 读取先看截下的写入、再落到真实读口——引擎刷新派生缓存后再读，读到的是自己这一次写出来的版本，
 * 与 Python 那一侧「写了再读」一致。路径按真实读口解析后的项目相对路径对齐。
 *
 * `preimage`（IDE 命令影子档用）：引擎在 Python 跑完之后才复算，这几个路径要读 Python 改之前的样子——
 * 截下的写入优先，其次是改前快照，最后才落到真实读口。
 */
export function overlayProject(
  base: ProjectReader,
  preimage: Preimage = new Map(),
): {
  reader: ProjectReader;
  writer: ProjectWriter;
  writes: () => readonly string[];
  /** 截下的写入：项目相对路径 → 最后一次写的字节。 */
  written: () => ReadonlyMap<string, Uint8Array>;
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
      const own = files.get(key(root, relative)) ?? preimage.get(relative);
      if (own)
        return {
          entryKind: 'file',
          targetKind: 'file',
          isReparsePoint: false,
          sizeBytes: own.length,
        };
      const metadata =
        preimage.get(relative) === null
          ? ({
              entryKind: 'missing',
              targetKind: 'missing',
              isReparsePoint: false,
              sizeBytes: 0,
            } as const)
          : await base.inspectProjectPath(root, path);
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
      const relative = await resolved(root, path);
      const own = files.get(key(root, relative)) ?? preimage.get(relative);
      if (own === null) throw new ProjectReadError('影子档：调用前这个文件不存在');
      if (!own) return base.readProjectBytes(root, path, maxBytes);
      return { bytes: own.slice(0, maxBytes + 1), exceeded: own.length > maxBytes };
    },
  };
  const writer: ProjectWriter = {
    async writeProjectFile(root, relativePath, bytes) {
      files.set(key(root, relativePath), bytes.slice());
    },
  };
  return {
    reader,
    writer,
    writes: () => [...files.keys()].map((item) => item.split('\u0000')[1]),
    written: () =>
      new Map([...files].map(([item, bytes]) => [item.split('\u0000')[1], bytes] as const)),
  };
}
