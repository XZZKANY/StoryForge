/**
 * 作品版本记录。
 *
 * 新版本只在 .storyforge/versions 下保存轻量 schema-v2 元数据，正文与作品状态由
 * app-local 影子 Git tree 内容寻址保存。旧 .snapshot.md 继续读取，不做破坏性迁移。
 */

import type { FileEntry } from './tauri-fs';
import { TauriFileSystem } from './tauri-fs';
import { relativePathInsideProject } from './project/path';
import {
  createShadowSnapshot,
  filterShadowSnapshotHashes,
  readShadowSnapshotFile,
  releaseShadowSnapshot,
  retainShadowSnapshot,
} from './shadow-git';

const VERSION_ROOT = '.storyforge/versions';
const SNAPSHOT_SUFFIX = '.snapshot.md';
const META_SUFFIX = '.meta.json';
const CHECKPOINT_DIR = 'checkpoints';
const TREE_HASH_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export type VersionContentRef =
  | { kind: 'legacy-file'; path: string }
  | { kind: 'shadow-tree'; treeHash: string; file: string };

export type VersionState = { exists: boolean; content: string };

export type VersionEntry = {
  /** 唯一 UI key：legacy 为 snapshot 路径，v2 为 meta 路径。 */
  path: string;
  contentRef: VersionContentRef;
  /** 保存时间（unix 毫秒）。同时作为该文件版本目录内的剧情节点 id。 */
  timestamp: number;
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
  runId?: string;
  created?: boolean;
  checkpoint?: boolean;
  recordId?: string;
  /** 元数据仍展示，但内容对象/ref 已丢失时明确禁用恢复。 */
  unavailableReason?: string;
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
  runId?: string;
  checkpoint?: boolean;
  created?: boolean;
};

type StoredVersionMetadata = VersionSnapshotMetadata & {
  schemaVersion?: number;
  storage?: string;
  treeHash?: string;
  recordId?: string;
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

async function targetFileExists(filePath: string): Promise<boolean> {
  try {
    return await TauriFileSystem.pathExists(filePath);
  } catch {
    // 是否存在决定恢复时会不会删除，探测失败时保守地视为已存在。
    return true;
  }
}

let lastTimestamp = 0;
let fallbackRecordSequence = 0;

function nextTimestamp(): number {
  const now = Date.now();
  lastTimestamp = Math.max(now, lastTimestamp + 1);
  return lastTimestamp;
}

function nextRecordId(timestamp: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${timestamp}_${uuid}`;
  fallbackRecordSequence += 1;
  return `${timestamp}_${fallbackRecordSequence}`;
}

/**
 * 写回前记录整个作品工作树。tree、meta、长期 ref 任一步失败都会 reject，调用方不得继续写盘。
 */
export async function snapshotBeforeWrite(
  projectPath: string | null,
  filePath: string,
  _previousContent: string,
  metadata: VersionSnapshotMetadata = {},
): Promise<{ path: string; timestamp: number; created: boolean } | null> {
  if (!projectPath) return null;
  const dir = versionDirFor(projectPath, filePath);
  const relativeFile = relativePathInsideProject(projectPath, filePath);
  if (!dir || !relativeFile) return null;

  const created = !(await targetFileExists(filePath));
  const checkpoint = metadata.checkpoint === true;
  const s = sep(projectPath);
  const targetDir = checkpoint ? `${dir}${s}${CHECKPOINT_DIR}` : dir;
  const timestamp = nextTimestamp();
  const recordId = nextRecordId(timestamp);
  const metaPath = `${targetDir}${s}${timestamp}${META_SUFFIX}`;
  const snapshot = await createShadowSnapshot(projectPath);
  const stored: StoredVersionMetadata = {
    schemaVersion: 2,
    storage: 'shadow-git',
    treeHash: snapshot.treeHash,
    recordId,
    source: metadata.source ?? 'Editor',
    summary: metadata.summary ?? '手动保存前快照',
    file: metadata.file ?? relativeFile,
    patchId: metadata.patchId,
    assistantSessionId: metadata.assistantSessionId,
    issueIds: metadata.issueIds,
    contextFiles: metadata.contextFiles,
    parentId: metadata.parentId,
    branchId: metadata.branchId,
    branchLabel: metadata.branchLabel,
    runId: metadata.runId,
    created,
  };

  try {
    await TauriFileSystem.writeFile(projectPath, metaPath, `${JSON.stringify(stored, null, 2)}\n`);
    await retainShadowSnapshot(projectPath, snapshot.treeHash, recordId);
  } catch (error) {
    await Promise.allSettled([
      releaseShadowSnapshot(projectPath, recordId),
      TauriFileSystem.deletePath(projectPath, metaPath),
    ]);
    throw error;
  }
  return { path: metaPath, timestamp, created };
}

/** 列出某文件的历史版本，普通版本与 Agent checkpoints 合并后按时间倒序。 */
export async function listVersions(
  projectPath: string | null,
  filePath: string,
): Promise<VersionEntry[]> {
  if (!projectPath) return [];
  const dir = versionDirFor(projectPath, filePath);
  const relativeFile = relativePathInsideProject(projectPath, filePath);
  if (!dir || !relativeFile) return [];
  const s = sep(projectPath);
  const [plain, checkpoints] = await Promise.all([
    readVersionDir(dir, relativeFile, false),
    readVersionDir(`${dir}${s}${CHECKPOINT_DIR}`, relativeFile, true),
  ]);
  const versions = [...plain, ...checkpoints].sort((a, b) => b.timestamp - a.timestamp);
  const hashes = [
    ...new Set(
      versions.flatMap((entry) =>
        entry.contentRef.kind === 'shadow-tree' && TREE_HASH_PATTERN.test(entry.contentRef.treeHash)
          ? [entry.contentRef.treeHash]
          : [],
      ),
    ),
  ];
  if (hashes.length > 0) {
    try {
      const valid = new Set(await filterShadowSnapshotHashes(projectPath, hashes));
      for (const entry of versions) {
        if (
          entry.contentRef.kind === 'shadow-tree' &&
          !entry.unavailableReason &&
          !valid.has(entry.contentRef.treeHash)
        ) {
          entry.unavailableReason = '影子 Git tree 或作品版本保活 ref 已丢失';
        }
      }
    } catch (error) {
      const detail = error instanceof Error && error.message ? `：${error.message}` : '';
      for (const entry of versions) {
        if (entry.contentRef.kind === 'shadow-tree' && !entry.unavailableReason) {
          entry.unavailableReason = `影子 Git 版本存储当前不可用${detail}`;
        }
      }
    }
  }
  return versions;
}

async function readVersionDir(
  dir: string,
  expectedFile: string,
  checkpoint: boolean,
): Promise<VersionEntry[]> {
  let entries: FileEntry[];
  try {
    entries = await TauriFileSystem.listDir(dir, false);
  } catch {
    return [];
  }

  const files = entries.filter((entry) => !entry.isDir);
  const names = new Set(files.map((entry) => entry.name));
  const legacy = await Promise.all(
    files
      .filter((entry) => entry.name.endsWith(SNAPSHOT_SUFFIX))
      .map((entry) => readLegacyEntry(entry, checkpoint)),
  );
  const treeBacked = await Promise.all(
    files
      .filter(
        (entry) =>
          entry.name.endsWith(META_SUFFIX) &&
          !names.has(entry.name.slice(0, -META_SUFFIX.length) + SNAPSHOT_SUFFIX),
      )
      .map((entry) => readTreeEntry(entry, expectedFile, checkpoint)),
  );
  return [...legacy, ...treeBacked].filter((entry): entry is VersionEntry => entry !== null);
}

async function readLegacyEntry(
  entry: FileEntry,
  checkpoint: boolean,
): Promise<VersionEntry | null> {
  const timestamp = timestampFromName(entry.name, SNAPSHOT_SUFFIX);
  if (timestamp === null) return null;
  const metaPath = entry.path.slice(0, -SNAPSHOT_SUFFIX.length) + META_SUFFIX;
  const metadata = await readMetadata(metaPath);
  return entryFromMetadata(
    entry.path,
    { kind: 'legacy-file', path: entry.path },
    timestamp,
    metadata,
    checkpoint,
  );
}

async function readTreeEntry(
  entry: FileEntry,
  expectedFile: string,
  checkpoint: boolean,
): Promise<VersionEntry | null> {
  const timestamp = timestampFromName(entry.name, META_SUFFIX);
  if (timestamp === null) return null;
  const metadata = await readMetadata(entry.path);
  const treeHash = metadata.treeHash ?? '';
  const storedFile = metadata.file ?? expectedFile;
  let unavailableReason: string | undefined;
  if (metadata.schemaVersion !== 2 || metadata.storage !== 'shadow-git') {
    unavailableReason = '版本元数据 schema/storage 无效';
  } else if (!TREE_HASH_PATTERN.test(treeHash)) {
    unavailableReason = '版本元数据缺少有效 tree hash';
  } else if (normalizeRelative(storedFile) !== normalizeRelative(expectedFile)) {
    unavailableReason = '版本元数据指向了其他项目文件';
  } else if (!metadata.recordId) {
    unavailableReason = '版本元数据缺少保活 record id';
  }
  return {
    ...entryFromMetadata(
      entry.path,
      { kind: 'shadow-tree', treeHash, file: expectedFile },
      timestamp,
      metadata,
      checkpoint,
    ),
    recordId: metadata.recordId,
    unavailableReason,
  };
}

function entryFromMetadata(
  path: string,
  contentRef: VersionContentRef,
  timestamp: number,
  metadata: StoredVersionMetadata,
  checkpoint: boolean,
): VersionEntry {
  return {
    path,
    contentRef,
    timestamp,
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
    runId: metadata.runId,
    created: metadata.created,
    checkpoint,
  };
}

function timestampFromName(name: string, suffix: string): number | null {
  const timestamp = Number.parseInt(name.slice(0, -suffix.length), 10);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

async function readMetadata(path: string): Promise<StoredVersionMetadata> {
  try {
    return decodeMetadata(JSON.parse(await TauriFileSystem.readFile(path)));
  } catch {
    return {};
  }
}

function decodeMetadata(value: unknown): StoredVersionMetadata {
  const raw = asRecord(value);
  return {
    schemaVersion: numberField(raw.schemaVersion),
    storage: stringField(raw.storage),
    treeHash: stringField(raw.treeHash),
    recordId: stringField(raw.recordId),
    source: stringField(raw.source),
    summary: stringField(raw.summary),
    file: stringField(raw.file),
    patchId: stringField(raw.patchId),
    assistantSessionId:
      raw.assistantSessionId === null ? null : numberField(raw.assistantSessionId),
    issueIds: stringArrayField(raw.issueIds),
    contextFiles: stringArrayField(raw.contextFiles),
    parentId: raw.parentId === null ? null : numberField(raw.parentId),
    branchId: stringField(raw.branchId),
    branchLabel: stringField(raw.branchLabel),
    runId: stringField(raw.runId),
    created: booleanField(raw.created),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}

/** 读取 legacy 或 tree-backed 版本的文件存在态与正文。 */
export async function readVersionState(
  projectPath: string,
  entry: VersionEntry,
): Promise<VersionState> {
  if (entry.unavailableReason) throw new Error(entry.unavailableReason);
  if (entry.contentRef.kind === 'legacy-file') {
    if (entry.created === true) return { exists: false, content: '' };
    return { exists: true, content: await TauriFileSystem.readFile(entry.contentRef.path) };
  }
  return await readShadowSnapshotFile(
    projectPath,
    entry.contentRef.treeHash,
    entry.contentRef.file,
  );
}
