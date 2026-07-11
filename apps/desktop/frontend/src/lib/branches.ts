/**
 * 剧情分支画布（Source Control Graph for Fiction）— 单章版本分支。
 *
 * 复用 .storyforge/versions 下的快照作为节点内容仓库，仅额外维护一份
 * 每文件的分支清单 .storyforge/versions/<相对文件>/branches.json，
 * 记录分支、活动分支与各分支 tip。血缘（parentId/branchId）写在每个
 * 快照的 .meta.json 里（见 versions.ts）。全部走真实文件系统，不伪造数据。
 */

import { TauriFileSystem } from './tauri-fs';
import { versionDirFor, type VersionEntry } from './versions';

export const MAIN_BRANCH_ID = 'main';
const MANIFEST_NAME = 'branches.json';
const BRANCH_PALETTE = ['#C77DB5', '#5AA0E6', '#6FB07A', '#D6975A', '#B98AD6', '#5FB3B3'];

export type BranchInfo = {
  id: string;
  label: string;
  color: string;
  /** 分叉点节点 id（来自主线/父分支的哪个节点）；main 为 null。 */
  baseNodeId: number | null;
  /** 当前 tip 节点 id，新保存挂在它后面。 */
  headNodeId: number | null;
};

export type BranchManifest = {
  activeBranchId: string;
  branches: BranchInfo[];
};

export type GraphNode = {
  /** = 快照时间戳，文件版本目录内唯一。 */
  id: number;
  /** 快照文件完整路径，用于读取正文。 */
  path: string;
  parentId: number | null;
  branchId: string;
  /** 渲染泳道列序。 */
  lane: number;
  timestamp: number;
  source?: string;
  summary?: string;
  patchId?: string;
};

export type BranchGraph = {
  nodes: GraphNode[];
  branches: BranchInfo[];
  laneOf: Record<string, number>;
};

function defaultMain(): BranchInfo {
  return {
    id: MAIN_BRANCH_ID,
    label: '主线',
    color: '#3E6FA3',
    baseNodeId: null,
    headNodeId: null,
  };
}

export function emptyManifest(): BranchManifest {
  return { activeBranchId: MAIN_BRANCH_ID, branches: [defaultMain()] };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizeBranch(value: unknown): BranchInfo {
  const raw = asRecord(value);
  const id = typeof raw.id === 'string' && raw.id ? raw.id : MAIN_BRANCH_ID;
  return {
    id,
    label: typeof raw.label === 'string' && raw.label ? raw.label : id,
    color: typeof raw.color === 'string' ? raw.color : '#888888',
    baseNodeId: typeof raw.baseNodeId === 'number' ? raw.baseNodeId : null,
    headNodeId: typeof raw.headNodeId === 'number' ? raw.headNodeId : null,
  };
}

export function normalizeManifest(value: unknown): BranchManifest {
  const raw = asRecord(value);
  const list = Array.isArray(raw.branches) ? raw.branches.map(normalizeBranch) : [];
  const branches = list.length ? list : [defaultMain()];
  if (!branches.some((branch) => branch.id === MAIN_BRANCH_ID)) {
    branches.unshift(defaultMain());
  }
  const activeBranchId =
    typeof raw.activeBranchId === 'string' &&
    branches.some((branch) => branch.id === raw.activeBranchId)
      ? raw.activeBranchId
      : MAIN_BRANCH_ID;
  return { activeBranchId, branches };
}

function manifestPathFor(projectPath: string, filePath: string): string | null {
  const dir = versionDirFor(projectPath, filePath);
  if (!dir) return null;
  const s = dir.includes('\\') ? '\\' : '/';
  return `${dir}${s}${MANIFEST_NAME}`;
}

/** 读取分支清单；缺失或损坏时回退到仅含主线的默认清单，不伪造分支。 */
export async function loadBranchManifest(
  projectPath: string | null,
  filePath: string,
): Promise<BranchManifest> {
  if (!projectPath) return emptyManifest();
  const path = manifestPathFor(projectPath, filePath);
  if (!path) return emptyManifest();
  try {
    return normalizeManifest(JSON.parse(await TauriFileSystem.readFile(path)));
  } catch {
    return emptyManifest();
  }
}

export async function saveBranchManifest(
  projectPath: string | null,
  filePath: string,
  manifest: BranchManifest,
): Promise<void> {
  if (!projectPath) return;
  const path = manifestPathFor(projectPath, filePath);
  if (!path) return;
  await TauriFileSystem.writeFile(projectPath, path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function getActiveBranch(manifest: BranchManifest): BranchInfo {
  return (
    manifest.branches.find((branch) => branch.id === manifest.activeBranchId) ??
    manifest.branches[0] ??
    defaultMain()
  );
}

function uniqueBranchId(manifest: BranchManifest, base: string): string {
  const existing = new Set(manifest.branches.map((branch) => branch.id));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** 从某节点开一条新分支并设为活动分支。新分支 tip 初始即分叉点。 */
export function createBranch(
  manifest: BranchManifest,
  fromNodeId: number,
  label: string,
): BranchManifest {
  const id = uniqueBranchId(manifest, `b${fromNodeId}`);
  const color = BRANCH_PALETTE[manifest.branches.length % BRANCH_PALETTE.length];
  const branch: BranchInfo = {
    id,
    label: label.trim() || `分支 ${id}`,
    color,
    baseNodeId: fromNodeId,
    headNodeId: fromNodeId,
  };
  return { activeBranchId: id, branches: [...manifest.branches, branch] };
}

export function setActiveBranch(manifest: BranchManifest, branchId: string): BranchManifest {
  if (!manifest.branches.some((branch) => branch.id === branchId)) return manifest;
  return { ...manifest, activeBranchId: branchId };
}

/** 在某分支上提交新快照后，把该分支 tip 推进到新节点。 */
export function setBranchHead(
  manifest: BranchManifest,
  branchId: string,
  headNodeId: number,
): BranchManifest {
  return {
    ...manifest,
    branches: manifest.branches.map((branch) =>
      branch.id === branchId ? { ...branch, headNodeId } : branch,
    ),
  };
}

/**
 * 把版本列表 + 分支清单组装成带泳道的 DAG。
 * 兼容旧线性快照：无 branchId 归 main，无 parentId 则取同分支上一个节点（main 首节点为根）。
 */
export function buildGraph(versions: VersionEntry[], manifest: BranchManifest): BranchGraph {
  const laneOf: Record<string, number> = {};
  manifest.branches.forEach((branch, index) => {
    laneOf[branch.id] = index;
  });
  if (laneOf[MAIN_BRANCH_ID] === undefined) laneOf[MAIN_BRANCH_ID] = 0;

  const ascending = [...versions].sort((a, b) => a.timestamp - b.timestamp);
  const lastByBranch: Record<string, number> = {};
  let lastMainId: number | null = null;

  const nodes: GraphNode[] = ascending.map((entry) => {
    const branchId = entry.branchId ?? MAIN_BRANCH_ID;
    let parentId: number | null;
    if (typeof entry.parentId === 'number') {
      parentId = entry.parentId;
    } else if (lastByBranch[branchId] !== undefined) {
      parentId = lastByBranch[branchId];
    } else {
      parentId = branchId === MAIN_BRANCH_ID ? null : lastMainId;
    }
    const lane = laneOf[branchId] ?? 0;
    lastByBranch[branchId] = entry.timestamp;
    if (branchId === MAIN_BRANCH_ID) lastMainId = entry.timestamp;
    return {
      id: entry.timestamp,
      path: entry.path,
      parentId,
      branchId,
      lane,
      timestamp: entry.timestamp,
      source: entry.source,
      summary: entry.summary,
      patchId: entry.patchId,
    };
  });

  return { nodes, branches: manifest.branches, laneOf };
}
