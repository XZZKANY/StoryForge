/**
 * 文件版本记录
 * 在项目目录下的 .storyforge/versions/ 镜像保存被覆盖前的内容快照，
 * 提供历史列表查看与恢复。全部走真实文件系统，不伪造数据。
 *
 * 布局：<project>/.storyforge/versions/<相对路径>/<unix毫秒>.snapshot.md
 */

import { TauriFileSystem, FileEntry } from './tauri-fs';
import { relativePathInsideProject } from './project/path';

const VERSION_ROOT = '.storyforge/versions';
const SNAPSHOT_SUFFIX = '.snapshot.md';
const META_SUFFIX = '.meta.json';
/** 每个文件保留的快照上限:autoSave 900ms 防抖下无上限会把用户盘写爆。 */
const MAX_SNAPSHOTS_PER_FILE = 20;

export type VersionEntry = {
  /** 快照文件完整路径 */
  path: string;
  /** 保存时间（unix 毫秒）。同时作为该文件版本目录内唯一的节点 id。 */
  timestamp: number;
  /** 写回来源，如 Agent 或 Editor */
  source?: string;
  /** 本次写回摘要 */
  summary?: string;
  /** 被写回文件的项目相对路径 */
  file?: string;
  patchId?: string;
  assistantSessionId?: number | null;
  issueIds?: string[];
  contextFiles?: string[];
  /** 剧情分支画布血缘：父节点 timestamp；null/缺省表示分支起点或旧线性快照。 */
  parentId?: number | null;
  /** 所属分支 id；缺省按 main 处理。 */
  branchId?: string;
  /** 分支展示名。 */
  branchLabel?: string;
};

export type VersionSnapshotMetadata = {
  source?: string;
  summary?: string;
  file?: string;
  patchId?: string;
  assistantSessionId?: number | null;
  issueIds?: string[];
  contextFiles?: string[];
  parentId?: number | null;
  branchId?: string;
  branchLabel?: string;
};

function sep(projectPath: string): string {
  return projectPath.includes('\\') ? '\\' : '/';
}

function normalizeRoot(projectPath: string): string {
  return projectPath.replace(/[/\\]+$/, '');
}

/** 某个文件的版本目录。剧情分支画布的分支清单也落在这里。 */
export function versionDirFor(projectPath: string, filePath: string): string | null {
  const relative = relativePathInsideProject(projectPath, filePath);
  if (!relative) return null;
  const s = sep(projectPath);
  const safeRelative = relative.split(/[/\\]/).join(s);
  return [normalizeRoot(projectPath), ...VERSION_ROOT.split('/'), safeRelative].join(s);
}

/**
 * 在覆盖写入前，把当前磁盘内容存为一份快照。
 * 若文件尚不存在（首次创建）则跳过。返回快照路径与节点时间戳，或 null。
 */
export async function snapshotBeforeWrite(
  projectPath: string | null,
  filePath: string,
  previousContent: string,
  metadata: VersionSnapshotMetadata = {},
): Promise<{ path: string; timestamp: number } | null> {
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
    file: metadata.file ?? relativePathInsideProject(projectPath, filePath) ?? filePath,
    patchId: metadata.patchId,
    assistantSessionId: metadata.assistantSessionId,
    issueIds: metadata.issueIds,
    contextFiles: metadata.contextFiles,
    parentId: metadata.parentId,
    branchId: metadata.branchId,
    branchLabel: metadata.branchLabel,
  };
  await TauriFileSystem.writeFile(
    `${dir}${s}${timestamp}${META_SUFFIX}`,
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  await pruneSnapshots(dir, s);
  return { path: snapshotPath, timestamp };
}

/** 按时间倒序保留最近 MAX_SNAPSHOTS_PER_FILE 份,超出的连同 meta 一起删;清理失败只告警,绝不阻断写回主路径。 */
async function pruneSnapshots(dir: string, s: string): Promise<void> {
  try {
    const entries = await TauriFileSystem.listDir(dir, false);
    const stamps = entries
      .filter((entry: FileEntry) => !entry.isDir && entry.name.endsWith(SNAPSHOT_SUFFIX))
      .map((entry: FileEntry) => Number(entry.name.slice(0, -SNAPSHOT_SUFFIX.length)))
      .filter((stamp: number) => Number.isFinite(stamp))
      .sort((a: number, b: number) => b - a);
    for (const stamp of stamps.slice(MAX_SNAPSHOTS_PER_FILE)) {
      try {
        await TauriFileSystem.deletePath(`${dir}${s}${stamp}${SNAPSHOT_SUFFIX}`);
        await TauriFileSystem.deletePath(`${dir}${s}${stamp}${META_SUFFIX}`);
      } catch (error) {
        console.warn('[versions] 过期快照清理失败(跳过):', stamp, error);
      }
    }
  } catch (error) {
    console.warn('[versions] 快照保留清理失败(不影响写入):', error);
  }
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
      const timestamp = Number.parseInt(
        e.name.slice(0, e.name.length - SNAPSHOT_SUFFIX.length),
        10,
      );
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
        metadata = JSON.parse(
          await TauriFileSystem.readFile(entry.metaPath),
        ) as VersionSnapshotMetadata;
      } catch {
        // 旧快照没有 meta sidecar 时仍可展示时间与恢复按钮。
      }
      list.push({
        path: entry.path,
        timestamp: entry.timestamp,
        source: metadata.source,
        summary: metadata.summary,
        file: metadata.file,
        patchId: metadata.patchId,
        assistantSessionId: metadata.assistantSessionId,
        issueIds: metadata.issueIds,
        contextFiles: metadata.contextFiles,
        parentId: metadata.parentId,
        branchId: metadata.branchId,
        branchLabel: metadata.branchLabel,
      });
      return list;
    }, Promise.resolve([]));
}

/** 读取某个版本快照内容。 */
export async function readVersion(snapshotPath: string): Promise<string> {
  return TauriFileSystem.readFile(snapshotPath);
}
