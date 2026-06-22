/**
 * 文件版本记录
 * 在项目目录下的 .storyforge/versions/ 镜像保存被覆盖前的内容快照，
 * 提供历史列表查看与恢复。全部走真实文件系统，不伪造数据。
 *
 * 布局：<project>/.storyforge/versions/<相对路径>/<unix毫秒>.snapshot.md
 */

import { TauriFileSystem, FileEntry } from './tauri-fs';

const VERSION_ROOT = '.storyforge/versions';
const SNAPSHOT_SUFFIX = '.snapshot.md';
const META_SUFFIX = '.meta.json';

export type VersionEntry = {
  /** 快照文件完整路径 */
  path: string;
  /** 保存时间（unix 毫秒） */
  timestamp: number;
  /** 写回来源，如 Agent 或 Editor */
  source?: string;
  /** 本次写回摘要 */
  summary?: string;
  /** 被写回文件的项目相对路径 */
  file?: string;
};

export type VersionSnapshotMetadata = {
  source?: string;
  summary?: string;
  file?: string;
};

function sep(projectPath: string): string {
  return projectPath.includes('\\') ? '\\' : '/';
}

function normalizeRoot(projectPath: string): string {
  return projectPath.replace(/[/\\]+$/, '');
}

/** 文件相对项目根的路径（用作版本目录名，分隔符统一为下划线段以避免深层目录爆炸由调用方决定）。 */
function relativeToProject(projectPath: string, filePath: string): string | null {
  const root = normalizeRoot(projectPath);
  if (!filePath.startsWith(root)) return null;
  return filePath.slice(root.length).replace(/^[/\\]+/, '');
}

/** 某个文件的版本目录。 */
function versionDirFor(projectPath: string, filePath: string): string | null {
  const relative = relativeToProject(projectPath, filePath);
  if (!relative) return null;
  const s = sep(projectPath);
  const safeRelative = relative.split(/[/\\]/).join(s);
  return [normalizeRoot(projectPath), ...VERSION_ROOT.split('/'), safeRelative].join(s);
}

/**
 * 在覆盖写入前，把当前磁盘内容存为一份快照。
 * 若文件尚不存在（首次创建）则跳过。返回快照路径或 null。
 */
export async function snapshotBeforeWrite(
  projectPath: string | null,
  filePath: string,
  previousContent: string,
  metadata: VersionSnapshotMetadata = {},
): Promise<string | null> {
  if (!projectPath) return null;
  const dir = versionDirFor(projectPath, filePath);
  if (!dir) return null;

  const s = sep(projectPath);
  const timestamp = Date.now();
  const snapshotPath = `${dir}${s}${timestamp}${SNAPSHOT_SUFFIX}`;
  // write_file 会自动创建父目录。
  await TauriFileSystem.writeFile(snapshotPath, previousContent);
  const meta = {
    source: metadata.source ?? 'Editor',
    summary: metadata.summary ?? '手动保存前快照',
    file: metadata.file ?? relativeToProject(projectPath, filePath) ?? filePath,
  };
  await TauriFileSystem.writeFile(
    `${dir}${s}${timestamp}${META_SUFFIX}`,
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  return snapshotPath;
}

/** 列出某文件的历史版本，按时间倒序。 */
export async function listVersions(
  projectPath: string | null,
  filePath: string,
): Promise<VersionEntry[]> {
  if (!projectPath) return [];
  const dir = versionDirFor(projectPath, filePath);
  if (!dir) return [];

  let entries: FileEntry[];
  try {
    entries = await TauriFileSystem.listDir(dir, false);
  } catch {
    // 目录不存在 = 尚无历史
    return [];
  }

  return entries
    .filter((e) => !e.isDir && e.name.endsWith(SNAPSHOT_SUFFIX))
    .map((e) => {
      const timestamp = Number.parseInt(e.name.slice(0, e.name.length - SNAPSHOT_SUFFIX.length), 10);
      const metaPath = e.path.slice(0, e.path.length - SNAPSHOT_SUFFIX.length) + META_SUFFIX;
      return {
        path: e.path,
        timestamp,
        metaPath,
      };
    })
    .filter((e) => Number.isFinite(e.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp)
    .reduce<Promise<VersionEntry[]>>(async (promise, entry) => {
      const list = await promise;
      let metadata: VersionSnapshotMetadata = {};
      try {
        metadata = JSON.parse(await TauriFileSystem.readFile(entry.metaPath)) as VersionSnapshotMetadata;
      } catch {
        // 旧快照没有 meta sidecar 时仍可展示时间与恢复按钮。
      }
      list.push({
        path: entry.path,
        timestamp: entry.timestamp,
        source: metadata.source,
        summary: metadata.summary,
        file: metadata.file,
      });
      return list;
    }, Promise.resolve([]));
}

/** 读取某个版本快照内容。 */
export async function readVersion(snapshotPath: string): Promise<string> {
  return TauriFileSystem.readFile(snapshotPath);
}
