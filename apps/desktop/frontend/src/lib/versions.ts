/**
 * 作品版本记录。
 *
 * 新版本只在 .storyforge/versions 下保存轻量 schema-v2 元数据，正文与作品状态由
 * app-local 影子 Git tree 内容寻址保存。旧 .snapshot.md 继续读取，不做破坏性迁移。
 */

import { joinPath } from './fs-path-ops';
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
const LINEAGE_FILE = 'lineage.json';
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

/** 某个文件的版本目录。剧情分支画布的分支清单也落在这里。 */
export function versionDirFor(projectPath: string, filePath: string): string | null {
  const relative = relativePathInsideProject(projectPath, filePath);
  if (!relative) return null;
  return versionDirForRelative(projectPath, relative);
}

function versionDirForRelative(projectPath: string, relative: string): string {
  return joinPath(projectPath, VERSION_ROOT, relative);
}

async function readLineage(projectPath: string, dir: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(
      await TauriFileSystem.readProjectFile(projectPath, joinPath(dir, LINEAGE_FILE)),
    ) as { previous?: unknown };
    return Array.isArray(parsed.previous)
      ? parsed.previous.filter((name): name is string => typeof name === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * 改名 / 移动之后，在新名字的版本目录里记下以前的相对路径（连同以前名字自己的曾用名），
 * 版本记录就跟着文件走。文件夹改名时给里面每个文件各记一份。
 */
export async function recordRenameLineage(
  projectPath: string,
  renamedFiles: ReadonlyArray<{ from: string; to: string }>,
): Promise<void> {
  for (const { from, to } of renamedFiles) {
    const fromRelative = relativePathInsideProject(projectPath, from);
    const toDir = versionDirFor(projectPath, to);
    const fromDir = versionDirFor(projectPath, from);
    if (!fromRelative || !toDir || !fromDir) continue;
    const previous = [
      ...(await readLineage(projectPath, toDir)),
      fromRelative,
      ...(await readLineage(projectPath, fromDir)),
    ];
    const unique = [...new Map(previous.map((name) => [normalizeRelative(name), name])).values()];
    await TauriFileSystem.writeFile(
      projectPath,
      joinPath(toDir, LINEAGE_FILE),
      `${JSON.stringify({ previous: unique }, null, 2)}\n`,
    );
  }
}

async function targetFileExists(projectPath: string, filePath: string): Promise<boolean> {
  try {
    return await TauriFileSystem.projectPathExists(projectPath, filePath);
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
  deliveryTicket?: string,
): Promise<{ path: string; timestamp: number; created: boolean } | null> {
  if (!projectPath) return null;
  if (!versionDirFor(projectPath, filePath)) return null;
  const created = !(await targetFileExists(projectPath, filePath));
  const snapshot = await createShadowSnapshot(projectPath, deliveryTicket);
  return await recordShadowVersion(
    projectPath,
    filePath,
    snapshot.treeHash,
    created,
    metadata,
    deliveryTicket,
  );
}

/**
 * 删除前给要删的每个文件各记一条版本：整本书只拍一次影子快照（文件夹里文件多时逐个拍太慢），
 * 每个文件各写一条元数据与保活 ref。任一步失败都会 reject，调用方不得继续删除。
 */
export async function snapshotBeforeDelete(
  projectPath: string,
  filePaths: readonly string[],
): Promise<void> {
  if (filePaths.length === 0) return;
  const snapshot = await createShadowSnapshot(projectPath);
  for (const filePath of filePaths) {
    await recordShadowVersion(projectPath, filePath, snapshot.treeHash, false, {
      source: 'Editor',
      summary: '删除前快照',
    });
  }
}

async function recordShadowVersion(
  projectPath: string,
  filePath: string,
  treeHash: string,
  created: boolean,
  metadata: VersionSnapshotMetadata,
  deliveryTicket?: string,
): Promise<{ path: string; timestamp: number; created: boolean } | null> {
  const dir = versionDirFor(projectPath, filePath);
  const relativeFile = relativePathInsideProject(projectPath, filePath);
  if (!dir || !relativeFile) return null;
  const checkpoint = metadata.checkpoint === true;
  const targetDir = checkpoint ? joinPath(dir, CHECKPOINT_DIR) : dir;
  const timestamp = nextTimestamp();
  const recordId = nextRecordId(timestamp);
  const metaPath = joinPath(targetDir, `${timestamp}${META_SUFFIX}`);
  const stored: StoredVersionMetadata = {
    schemaVersion: 2,
    storage: 'shadow-git',
    treeHash,
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
    await TauriFileSystem.writeFile(
      projectPath,
      metaPath,
      `${JSON.stringify(stored, null, 2)}\n`,
      deliveryTicket,
    );
    await retainShadowSnapshot(projectPath, treeHash, recordId, deliveryTicket);
  } catch (error) {
    await Promise.allSettled([
      releaseShadowSnapshot(projectPath, recordId, deliveryTicket),
      TauriFileSystem.deletePath(projectPath, metaPath, false, deliveryTicket),
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
  // 改过名的文件：以前的名字下记的版本一并列出，内容仍按当时的路径从影子树里取。
  const previous = (await readLineage(projectPath, dir)).filter(
    (name) => normalizeRelative(name) !== normalizeRelative(relativeFile),
  );
  const lists = await Promise.all(
    [
      { dir, file: relativeFile },
      ...previous.map((name) => ({ dir: versionDirForRelative(projectPath, name), file: name })),
    ].flatMap((source) => [
      readVersionDir(projectPath, source.dir, source.file, false),
      readVersionDir(projectPath, joinPath(source.dir, CHECKPOINT_DIR), source.file, true),
    ]),
  );
  const versions = lists.flat().sort((a, b) => b.timestamp - a.timestamp);
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
  projectPath: string,
  dir: string,
  expectedFile: string,
  checkpoint: boolean,
): Promise<VersionEntry[]> {
  let entries: FileEntry[];
  try {
    entries = await TauriFileSystem.listProjectDir(projectPath, dir, false);
  } catch {
    return [];
  }

  const files = entries.filter((entry) => !entry.isDir);
  const names = new Set(files.map((entry) => entry.name));
  const legacy = await Promise.all(
    files
      .filter((entry) => entry.name.endsWith(SNAPSHOT_SUFFIX))
      .map((entry) => readLegacyEntry(projectPath, entry, checkpoint)),
  );
  const treeBacked = await Promise.all(
    files
      .filter(
        (entry) =>
          entry.name.endsWith(META_SUFFIX) &&
          !names.has(entry.name.slice(0, -META_SUFFIX.length) + SNAPSHOT_SUFFIX),
      )
      .map((entry) => readTreeEntry(projectPath, entry, expectedFile, checkpoint)),
  );
  return [...legacy, ...treeBacked].filter((entry): entry is VersionEntry => entry !== null);
}

async function readLegacyEntry(
  projectPath: string,
  entry: FileEntry,
  checkpoint: boolean,
): Promise<VersionEntry | null> {
  const timestamp = timestampFromName(entry.name, SNAPSHOT_SUFFIX);
  if (timestamp === null) return null;
  const metaPath = entry.path.slice(0, -SNAPSHOT_SUFFIX.length) + META_SUFFIX;
  const metadata = await readMetadata(projectPath, metaPath);
  return entryFromMetadata(
    entry.path,
    { kind: 'legacy-file', path: entry.path },
    timestamp,
    metadata,
    checkpoint,
  );
}

async function readTreeEntry(
  projectPath: string,
  entry: FileEntry,
  expectedFile: string,
  checkpoint: boolean,
): Promise<VersionEntry | null> {
  const timestamp = timestampFromName(entry.name, META_SUFFIX);
  if (timestamp === null) return null;
  const metadata = await readMetadata(projectPath, entry.path);
  const treeHash = metadata.treeHash ?? '';
  const storedFile = metadata.file ?? expectedFile;
  let unavailableReason: string | undefined;
  if (metadata.schemaVersion !== 2 || metadata.storage !== 'shadow-git') {
    unavailableReason = '版本元数据 schema/storage 无效';
  } else if (!TREE_HASH_PATTERN.test(treeHash)) {
    unavailableReason = '版本元数据缺少有效 tree hash';
  } else if (normalizeRelative(storedFile) !== normalizeRelative(expectedFile)) {
    unavailableReason = '版本元数据指向了其他作品的文件';
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

async function readMetadata(projectPath: string, path: string): Promise<StoredVersionMetadata> {
  try {
    return decodeMetadata(JSON.parse(await TauriFileSystem.readProjectFile(projectPath, path)));
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
    return {
      exists: true,
      content: await TauriFileSystem.readProjectFile(projectPath, entry.contentRef.path),
    };
  }
  const state = await readShadowSnapshotFile(
    projectPath,
    entry.contentRef.treeHash,
    entry.contentRef.file,
  );
  // 记的是「写入前文件在」，树里却没有：是快照把它排除了（单个文件超过 2 MiB，或被作品的 .gitignore 忽略），
  // 不是原本不存在——不能当成「不存在」去恢复，那会删掉当前文件。
  if (!state.exists && entry.created === false)
    throw new Error(
      '这个版本没有存下这份文件的内容（单个文件超过 2 MiB，或被作品的 .gitignore 忽略），没法从这里恢复。',
    );
  return state;
}
