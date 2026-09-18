import type { RefObject } from 'react';
import type { ManuscriptChapter } from '../../lib/book-context';
import { bookGoalProgress, formatWordCount } from '../../lib/book-profile';
import type { BookProfileHandle } from './useBookProfile';
import type { BookOverviewChaptersHandle } from './useBookOverviewChapters';
import { ArrowUp, BookOpen, ChevronRight } from '../icons/shell-icons';

/**
 * 载入中的骨架屏：镜像 hero 两卡（封面+简介 / 写作进度）的形状，
 * 让加载结束时的布局不发生跳动，比一行裸「正在读取…」更贴近成品观感。
 * 骨架块是装饰（aria-hidden），真正语义由外层的 aria-busy + 隐藏「正在读取」承载。
 */
function BookOverviewSkeleton() {
  return (
    <div
      className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]"
      data-testid="book-overview-skeleton"
      aria-hidden="true"
    >
      {/* 左卡：封面 + 简介 + 主按钮 */}
      <div className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-panel p-5 sm:flex-row md:p-6">
        <div className="skeleton aspect-[3/4] w-32 flex-shrink-0 rounded-lg sm:w-40 xl:w-56" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="skeleton h-5 w-2/5" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-11/12" />
          <div className="skeleton h-4 w-3/5" />
          <div className="skeleton mt-auto h-11 w-36 rounded-lg" />
        </div>
      </div>
      {/* 右卡：写作进度 */}
      <div className="min-h-[300px] rounded-xl border border-border bg-panel p-5 md:p-6">
        <div className="skeleton h-5 w-24" />
        <div className="skeleton mt-5 h-9 w-32" />
        <div className="skeleton mt-4 h-2.5 w-full rounded-full" />
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <div className="skeleton h-14 rounded-lg" />
          <div className="skeleton h-14 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function BookOverviewHero({
  profile,
  title,
  currentChapter,
  chapterIndex,
  chapterCount,
  chapterListRef,
  onContinueWriting,
  onRefresh = profile.refresh,
}: {
  profile: BookProfileHandle;
  title: string;
  currentChapter: Pick<ManuscriptChapter, 'relativePath' | 'ordinal' | 'name'> | null;
  chapterIndex?: BookOverviewChaptersHandle;
  chapterCount: number;
  chapterListRef: RefObject<HTMLDivElement | null>;
  onContinueWriting: (relativePath?: string) => void;
  onRefresh?: () => void;
}) {
  const book = profile.profile;
  const currentPath = currentChapter?.relativePath;
  const totalChars = profile.totals?.chars ?? null;
  const staleTotals = Boolean(profile.totalsError || profile.refreshing);
  const progress =
    totalChars === null || staleTotals || profile.profileError
      ? null
      : bookGoalProgress(totalChars, book.wordGoal);
  if (profile.loading) return <BookOverviewSkeleton />;
  return (
    <section
      className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] animate-fade-in-up"
      style={{ animationDelay: '50ms' }}
      data-testid="book-overview-hero"
    >
      <div className="card-hover flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-panel p-5 sm:flex-row md:p-6">
        <div className="relative aspect-[3/4] w-32 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-background sm:w-40 xl:w-56">
          {profile.coverUrl && !profile.profileError ? (
            <img
              src={profile.coverUrl}
              alt={`${title}封面`}
              className="h-full w-full object-cover"
              data-testid="book-overview-cover"
            />
          ) : (
            <div
              className="flex h-full w-full flex-col items-center justify-center gap-3 px-3 text-center text-subtle"
              data-testid="book-overview-cover-empty"
            >
              <BookOpen size={24} strokeWidth={1.4} aria-hidden="true" />
              <span className="text-xs">{profile.profileError ? '封面未读取' : '暂无封面'}</span>
              {!profile.profileError && (
                <span className="text-2xs leading-5">
                  通过「编辑作品资料」
                  <br />
                  添加封面
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {profile.profileError ? (
            <div
              role="alert"
              className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs text-error"
            >
              <p className="break-words">作品资料读取失败：{profile.profileError}</p>
              <button
                type="button"
                onClick={onRefresh}
                disabled={profile.refreshing}
                className="mt-2 rounded-md border border-error/40 px-2 py-1 hover:bg-error/10 disabled:opacity-50"
                data-testid="book-overview-retry-profile"
              >
                重新读取资料
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {book.tags.length > 0 ? (
                  book.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-elevated px-2.5 py-1 text-2xs text-muted"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-subtle">尚未添加题材标签</span>
                )}
              </div>
              <p
                className="mt-4 line-clamp-4 text-sm leading-6 text-muted"
                data-testid="book-overview-synopsis"
              >
                {book.synopsis.trim() ||
                  '还没有简介。通过上方「编辑作品资料」补充这本书的核心设定。'}
              </p>
            </>
          )}
          <div className="mt-auto pt-5">
            <button
              type="button"
              onClick={() => {
                if (currentPath) onContinueWriting(currentPath);
                else {
                  chapterListRef.current?.scrollIntoView?.({ block: 'nearest' });
                  chapterListRef.current?.focus();
                }
              }}
              className="interactive-press inline-flex h-11 items-center gap-2 rounded-lg bg-agent px-5 text-sm font-medium text-agent-foreground shadow-md transition-all hover:brightness-110 hover:shadow-lg active:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="book-overview-continue"
            >
              <ArrowUp size={16} strokeWidth={1.8} aria-hidden="true" />
              {currentPath ? '继续写作' : '选择章节开始'}
              <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {currentChapter ? (
              <p className="mt-2 truncate text-2xs text-subtle" title={currentChapter.relativePath}>
                从第 {currentChapter.ordinal} 章 · {currentChapter.name} 继续
              </p>
            ) : (
              <p className="mt-2 text-2xs text-subtle">没有可继续的当前章节，请在下方选择章节。</p>
            )}
          </div>
        </div>
      </div>

      <div
        className="card-hover min-h-[300px] rounded-xl border border-border bg-panel p-5 md:p-6"
        data-testid="book-overview-progress"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">写作进度</h2>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-agent/10">
            <BookOpen size={16} className="text-agent" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-5 flex items-end gap-2">
          <strong className="text-4xl font-semibold tracking-tight text-foreground">
            {totalChars === null ? '—' : formatWordCount(totalChars)}
          </strong>
          {book.wordGoal > 0 && !profile.profileError ? (
            <span className="pb-1 text-xs text-subtle">/ {formatWordCount(book.wordGoal)}</span>
          ) : null}
        </div>
        {staleTotals && totalChars !== null && (
          <p className="mt-2 text-xs text-muted">
            上次统计{profile.refreshing ? ' · 正在更新…' : ' · 重新读取后更新'}
          </p>
        )}
        {progress !== null ? (
          <>
            <div
              className="mt-4 h-2.5 overflow-hidden rounded-full bg-elevated"
              aria-label={`已完成 ${Math.round(progress * 100)}%`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-agent to-agent/70 transition-all duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
                data-testid="book-overview-progress-bar"
              />
            </div>
            <p className="mt-2 text-2xs text-subtle">已完成 {Math.round(progress * 100)}%</p>
          </>
        ) : (
          <p className="mt-4 text-xs text-subtle">
            {profile.totalsError
              ? '字数暂时无法更新'
              : profile.profileError
                ? '目标未读取'
                : profile.refreshing
                  ? '正在更新写作进度…'
                  : book.wordGoal > 0
                    ? '等待字数统计'
                    : '尚未设置全书字数目标'}
          </p>
        )}
        <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <div className="rounded-lg bg-elevated/50 p-3">
            <dt className="text-2xs text-subtle">正文</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {chapterIndex?.status === 'available'
                ? `${chapterCount} 章`
                : chapterIndex?.status === 'loading'
                  ? '读取中…'
                  : '—'}
            </dd>
          </div>
          <div className="rounded-lg bg-elevated/50 p-3">
            <dt className="text-2xs text-subtle">大纲条目</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {profile.outlineLoading
                ? '读取中…'
                : profile.outlineError
                  ? '读取失败'
                  : profile.outline.length}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
