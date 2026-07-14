import type { PipelineStatus, PublishBook } from './types';

export type TransitionResult = { ok: true; next: PipelineStatus } | { ok: false; reason: string };

const FORWARD: Partial<Record<PipelineStatus, PipelineStatus>> = {
  idea: 'writing',
  writing: 'polish',
  polish: 'ready',
  ready: 'scheduled',
  scheduled: 'opened',
  opened: 'serializing',
};

/** 允许的显式迁移（含止损与回退写作）。 */
export function canTransition(
  book: Pick<PublishBook, 'status' | 'assignedAccountId' | 'openedAt'>,
  to: PipelineStatus,
): TransitionResult {
  const from = book.status;
  if (from === to) return { ok: true, next: to };

  if (to === 'dropped') {
    if (from === 'opened' || from === 'serializing' || from === 'scheduled') {
      return { ok: true, next: 'dropped' };
    }
    return { ok: false, reason: '仅已排期/已开/连载中的书可止损' };
  }

  if (from === 'dropped') {
    return { ok: false, reason: '已止损的书不可改阶段（需新建条目）' };
  }

  if (to === 'scheduled') {
    if (from !== 'ready' && from !== 'scheduled') {
      return { ok: false, reason: '进入已排期须先到 ready' };
    }
    if (!book.assignedAccountId) {
      return { ok: false, reason: 'ready→scheduled 必须已指派账号' };
    }
    return { ok: true, next: 'scheduled' };
  }

  if (to === 'opened') {
    if (from !== 'scheduled' && from !== 'opened') {
      return { ok: false, reason: '确认已开须从 scheduled 进入' };
    }
    return { ok: true, next: 'opened' };
  }

  if (to === 'serializing') {
    if (from !== 'opened' && from !== 'serializing') {
      return { ok: false, reason: '连载中须从已开进入' };
    }
    return { ok: true, next: 'serializing' };
  }

  // 写作侧弱耦合：允许在 idea/writing/polish/ready 间前后移动
  const writingSide: PipelineStatus[] = ['idea', 'writing', 'polish', 'ready'];
  if (writingSide.includes(from) && writingSide.includes(to)) {
    return { ok: true, next: to };
  }

  if (FORWARD[from] === to) {
    return { ok: true, next: to };
  }

  return { ok: false, reason: `不允许 ${from} → ${to}` };
}

export function assertTransition(
  book: Pick<PublishBook, 'status' | 'assignedAccountId' | 'openedAt'>,
  to: PipelineStatus,
): PipelineStatus {
  const result = canTransition(book, to);
  if (!result.ok) throw new Error(result.reason);
  return result.next;
}
