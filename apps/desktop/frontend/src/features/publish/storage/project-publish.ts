import type { DropReason, PipelineStatus, PublishBook } from '../model';
import { TauriFileSystem } from '../../../lib/tauri-fs';
import { projectPublishJsonPath } from './paths';

/** 项目内书侧真相（.storyforge/publish.json） */
export type ProjectPublishFile = {
  version: 1;
  platform: string;
  title: string;
  assignedAccountId: string | null;
  penNameSnapshot: string | null;
  planOpenDate: string | null;
  status: PipelineStatus;
  assignmentLocked: boolean;
  readyConfirmed: boolean;
  forceReadyReason: string | null;
  readyScore: number;
  openedAt: string | null;
  dropReason: DropReason | null;
  openPackGeneratedAt: string | null;
  updatedAt: string;
  meta: {
    blurb: string;
    tags: string[];
  };
  checklist: {
    titleOk: boolean;
    blurbOk: boolean;
    coverOk: boolean;
    tagsOk: boolean;
    firstBatchOk: boolean;
  };
};

export function bookToProjectPublish(
  book: PublishBook,
  extras?: {
    penNameSnapshot?: string | null;
    meta?: ProjectPublishFile['meta'];
    checklist?: ProjectPublishFile['checklist'];
    openPackGeneratedAt?: string | null;
  },
): ProjectPublishFile {
  return {
    version: 1,
    platform: String(book.platform),
    title: book.title,
    assignedAccountId: book.assignedAccountId,
    penNameSnapshot: extras?.penNameSnapshot ?? null,
    planOpenDate: book.planOpenDate,
    status: book.status,
    assignmentLocked: book.assignmentLocked,
    readyConfirmed: book.readyConfirmed,
    forceReadyReason: book.forceReadyReason,
    readyScore: book.readyScore,
    openedAt: book.openedAt,
    dropReason: book.dropReason,
    openPackGeneratedAt: extras?.openPackGeneratedAt ?? null,
    updatedAt: book.updatedAt,
    meta: extras?.meta ?? { blurb: '', tags: [] },
    checklist: extras?.checklist ?? {
      titleOk: Boolean(book.title?.trim()),
      blurbOk: false,
      coverOk: false,
      tagsOk: false,
      firstBatchOk: book.readyScore >= 40,
    },
  };
}

export function mergeProjectIntoBook(
  book: PublishBook,
  project: ProjectPublishFile,
): PublishBook {
  const projectTime = Date.parse(project.updatedAt || '') || 0;
  const bookTime = Date.parse(book.updatedAt || '') || 0;
  // 项目文件为书侧真相：更新或不旧于 library 时覆盖关键字段
  if (projectTime < bookTime) {
    return book;
  }
  return {
    ...book,
    title: project.title || book.title,
    platform: project.platform || book.platform,
    status: project.status || book.status,
    assignedAccountId: project.assignedAccountId,
    assignmentLocked: project.assignmentLocked,
    planOpenDate: project.planOpenDate,
    readyScore: project.readyScore,
    readyConfirmed: project.readyConfirmed,
    forceReadyReason: project.forceReadyReason,
    openedAt: project.openedAt,
    dropReason: project.dropReason,
    updatedAt: project.updatedAt || book.updatedAt,
  };
}

export async function loadProjectPublish(
  projectPath: string,
): Promise<ProjectPublishFile | null> {
  const path = projectPublishJsonPath(projectPath);
  try {
    const exists = await TauriFileSystem.pathExists(path);
    if (!exists) return null;
    const raw = await TauriFileSystem.readFile(path);
    return JSON.parse(raw) as ProjectPublishFile;
  } catch {
    return null;
  }
}

export async function saveProjectPublish(
  projectPath: string,
  data: ProjectPublishFile,
): Promise<void> {
  const path = projectPublishJsonPath(projectPath);
  const raw = `${JSON.stringify(data, null, 2)}\n`;
  await TauriFileSystem.writeFile(projectPath, path, raw);
}

export async function syncBookToProject(
  book: PublishBook,
  extras?: Parameters<typeof bookToProjectPublish>[1],
): Promise<void> {
  try {
    const exists = await TauriFileSystem.pathExists(book.path);
    if (!exists) return;
    const prev = await loadProjectPublish(book.path);
    const next = bookToProjectPublish(book, {
      penNameSnapshot: extras?.penNameSnapshot ?? prev?.penNameSnapshot ?? null,
      meta: extras?.meta ?? prev?.meta,
      checklist: extras?.checklist ?? prev?.checklist,
      openPackGeneratedAt: extras?.openPackGeneratedAt ?? prev?.openPackGeneratedAt ?? null,
    });
    await saveProjectPublish(book.path, next);
  } catch {
    // 路径失效或非 Tauri：跳过，不阻断 library 写入
  }
}

export async function pullProjectIntoBook(book: PublishBook): Promise<PublishBook> {
  try {
    const project = await loadProjectPublish(book.path);
    if (!project) return book;
    return mergeProjectIntoBook(book, project);
  } catch {
    return book;
  }
}
