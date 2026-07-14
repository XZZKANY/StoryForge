import type { PublishBook } from './types';

export function createPlaceholderBook(input: {
  title: string;
  planOpenDate?: string | null;
  platform?: string;
}): PublishBook {
  const now = new Date().toISOString();
  const slug = input.title.trim() || '空位';
  const id = `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    projectKey: id,
    title: slug.startsWith('[空位]') ? slug : `[空位] ${slug}`,
    path: `placeholder://${id}`,
    platform: input.platform ?? 'fanqie',
    status: 'idea',
    assignedAccountId: null,
    assignmentLocked: false,
    planOpenDate: input.planOpenDate ?? null,
    readyScore: 0,
    readyConfirmed: false,
    forceReadyReason: null,
    openedAt: null,
    lastLocalEditAt: null,
    dropReason: null,
    updatedAt: now,
    isPlaceholder: true,
    blurb: '',
    onlineBookId: null,
    onlineSnapshot: null,
  };
}

export function bindPlaceholderToProject(
  book: PublishBook,
  projectPath: string,
  title?: string,
): PublishBook {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return {
    ...book,
    isPlaceholder: false,
    path: normalized,
    projectKey: normalized.toLowerCase(),
    title: title?.trim() || book.title.replace(/^\[空位\]\s*/, ''),
    status: book.status === 'idea' ? 'writing' : book.status,
    updatedAt: new Date().toISOString(),
  };
}

export function isPlaceholderBook(book: Pick<PublishBook, 'isPlaceholder' | 'path'>): boolean {
  return Boolean(book.isPlaceholder) || book.path.startsWith('placeholder://');
}
