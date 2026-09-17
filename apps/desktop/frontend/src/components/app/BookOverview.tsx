/**
 * 作品总览：宽幅、只读的项目落点。
 *
 * 总览不替代左栏 BookProfileView 的编辑能力；它把作者打开作品时最需要的
 * 身份、进度、当前章节和下一步动作集中到主工作区。所有事实仍来自既有
 * useBookProfile / useBookContext，组件本身不读盘、不推算章节。
 */
import { useRef } from 'react';
import type { BookContextAvailability, BookContextHandle } from './useBookContext';
import { formatEstimatedChars } from '../../lib/book-context';
import type { BookOverviewChaptersHandle } from './useBookOverviewChapters';
import type { BookProfileHandle } from './useBookProfile';
import type { AgentRunOverviewSummary } from '../chat-window/types';
import { bookGoalProgress, displayBookTitle, formatWordCount } from '../../lib/book-profile';
import {
  ArrowUp,
  BookOpen,
  ChevronRight,
  FileText,
  ImagePlus,
  Library,
  RefreshCw,
} from '../icons/shell-icons';

export type BookOverviewProps = {
  projectPath: string;
  profile: BookProfileHandle;
  /** 可直接传 useBookContext 的 handle；不传时总览仍可显示档案信息。 */
  context?: BookContextHandle;
  chapters?: BookOverviewChaptersHandle;
  /** 点击「继续写作」时由壳层决定如何切换 surface 并打开文件。 */
  onContinueWriting: (relativePath?: string) => void;
  onOpenChapter?: (relativePath: string) => void;
  onOpenOutline?: (path: string, line: number) => void;
  onRefresh?: () => void;
  pendingPatchCount?: number;
  onOpenPendingPatches?: () => void;
  agentRun?: AgentRunOverviewSummary | null;
  onOpenAgentRun?: () => void;
};

function ContextStatus({
  availability,
  refreshing,
  onRefresh,
}: {
  availability: BookContextAvailability;
  refreshing: boolean;
  onRefresh?: () => void;
}) {
  if (availability === 'available') return null;
  const text =
    availability === 'loading'
      ? '正在读取手稿结构…'
      : availability === 'error'
        ? '手稿结构读取失败'
        : '打开项目后显示手稿结构';
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-xs text-muted"
      data-testid="book-overview-context-status"
    >
      <span className="min-w-0 flex-1">{text}</span>
      {availability === 'error' && onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-border-strong px-2 text-2xs text-foreground hover:bg-elevated"
          data-testid="book-overview-refresh-context"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          重试
        </button>
      ) : null}
    </div>
  );
}

export function BookOverview({
  projectPath,
  profile,
  context,
  chapters: chapterIndex,
  onContinueWriting,
  onOpenChapter,
  onOpenOutline,
  onRefresh,
  pendingPatchCount = 0,
  onOpenPendingPatches,
  agentRun = null,
  onOpenAgentRun,
}: BookOverviewProps) {
  const book = profile.profile;
  const chapterListRef = useRef<HTMLDivElement>(null);
  const title = displayBookTitle(book, projectPath);
  const snapshot = context?.snapshot ?? null;
  const chapters = chapterIndex?.chapters ?? snapshot?.chapters ?? [];
  const currentChapter =
    chapterIndex?.currentChapter ??
    chapters.find((chapter) => chapter.relativePath === snapshot?.currentRelativePath) ??
    null;
  const currentPath = currentChapter?.relativePath;
  const totalChars = profile.totals?.chars ?? null;
  const progress = totalChars === null ? null : bookGoalProgress(totalChars, book.wordGoal);
  const recentChapters = chapters;
  const outlineItems = profile.outline.slice(0, 6);

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto bg-background"
      data-testid="book-overview"
      role="region"
      aria-label="作品总览"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-6 md:px-8 md:py-8">
        <header
          className="flex items-center gap-3 animate-fade-in-up"
          data-testid="book-overview-header"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-agent/10">
            <Library size={20} strokeWidth={1.6} className="text-agent" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xs uppercase tracking-[0.18em] text-subtle">作品总览</p>
            <h1 className="truncate text-xl font-semibold text-foreground md:text-2xl">
              {title || '未命名作品'}
            </h1>
          </div>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={profile.refreshing}
              title="重新读取作品资料"
              className="interactive-press grid h-9 w-9 place-items-center rounded-lg text-muted transition-all hover:bg-elevated hover:text-foreground hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted"
              data-testid="book-overview-refresh"
            >
              <RefreshCw
                size={15}
                className={profile.refreshing ? 'animate-spin' : ''}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </header>

        {profile.loading && (
          <p role="status" className="text-sm text-muted">
            正在读取作品资料…
          </p>
        )}
        {profile.totalsError && (
          <p role="alert" className="rounded-lg border border-border p-3 text-sm text-error">
            字数统计失败：{profile.totalsError}。请重新读取作品资料。
          </p>
        )}

        <section
          className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] animate-fade-in-up"
          style={{ animationDelay: '50ms' }}
          data-testid="book-overview-hero"
        >
          <div className="card-hover flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-panel p-5 sm:flex-row md:p-6">
            <div className="group relative aspect-[3/4] w-32 flex-shrink-0 overflow-hidden rounded-lg border border-border-strong bg-elevated sm:w-40 xl:w-56 transition-transform hover:scale-[1.02]">
              {profile.coverUrl ? (
                <img
                  src={profile.coverUrl}
                  alt={`${title}封面`}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  data-testid="book-overview-cover"
                />
              ) : (
                <div
                  className="flex h-full w-full flex-col items-center justify-center gap-2 text-subtle transition-colors group-hover:text-muted"
                  data-testid="book-overview-cover-empty"
                >
                  <ImagePlus size={24} strokeWidth={1.4} aria-hidden="true" />
                  <span className="text-2xs">暂无封面</span>
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap gap-1.5">
                {book.tags.length > 0 ? (
                  book.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-elevated px-2.5 py-1 text-2xs text-muted transition-colors hover:bg-border hover:text-foreground"
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
                  <p
                    className="mt-2 truncate text-2xs text-subtle"
                    title={currentChapter.relativePath}
                  >
                    从第 {currentChapter.ordinal} 章 · {currentChapter.name} 继续
                  </p>
                ) : (
                  <p className="mt-2 text-2xs text-subtle">
                    没有可继续的当前章节，请在下方选择章节。
                  </p>
                )}
              </div>
            </div>
          </div>

          <div
            className="card-hover rounded-xl border border-border bg-panel p-5 md:p-6"
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
              {book.wordGoal > 0 ? (
                <span className="pb-1 text-xs text-subtle">/ {formatWordCount(book.wordGoal)}</span>
              ) : null}
            </div>
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
                {book.wordGoal > 0 ? '等待字数统计' : '尚未设置全书字数目标'}
              </p>
            )}
            <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-4">
              <div className="rounded-lg bg-elevated/50 p-3">
                <dt className="text-2xs text-subtle">正文</dt>
                <dd className="mt-1 text-sm font-medium text-foreground">
                  {chapterIndex?.status === 'available'
                    ? `${chapters.length} 章`
                    : chapterIndex?.status === 'loading'
                      ? '读取中…'
                      : '—'}
                </dd>
              </div>
              <div className="rounded-lg bg-elevated/50 p-3">
                <dt className="text-2xs text-subtle">大纲条目</dt>
                <dd className="mt-1 text-sm font-medium text-foreground">{profile.outline.length || '—'}</dd>
              </div>
            </dl>
          </div>
        </section>

        {pendingPatchCount > 0 && onOpenPendingPatches ? (
          <button
            type="button"
            onClick={onOpenPendingPatches}
            className="card-hover flex w-full items-center gap-3 rounded-xl border border-agent/40 bg-agent/10 px-4 py-3.5 text-left shadow-sm hover:bg-agent/15 hover:shadow-md"
            data-testid="book-overview-pending-patches"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-agent/20">
              <FileText size={18} className="text-agent" aria-hidden="true" />
            </div>
            <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
              有 {pendingPatchCount} 个待确认修改
            </span>
            <ChevronRight size={16} className="text-muted" aria-hidden="true" />
          </button>
        ) : null}

        {agentRun && onOpenAgentRun ? (
          <button
            type="button"
            onClick={onOpenAgentRun}
            className="card-hover flex w-full items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3.5 text-left shadow-sm hover:bg-warning/15 hover:shadow-md"
            data-testid="book-overview-agent-run"
          >
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-warning/20">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  agentRun.status === 'running' ? 'animate-pulse bg-agent' : 'bg-warning'
                }`}
                aria-hidden="true"
              />
            </div>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">
                {agentRun.status === 'running'
                  ? 'Agent 正在工作'
                  : agentRun.status === 'paused'
                    ? 'Agent 已暂停'
                    : agentRun.status === 'completed'
                      ? 'Agent 本轮已完成'
                      : agentRun.status === 'stopped'
                        ? 'Agent 已由你停止'
                        : agentRun.status === 'failed' || agentRun.status === 'session_error'
                          ? 'Agent 会话需要处理'
                          : agentRun.status === 'waiting_permission'
                            ? 'Agent 等待权限确认'
                            : agentRun.status === 'waiting_brief'
                              ? 'Agent 等待章节选择'
                              : agentRun.status === 'waiting_patch'
                                ? 'Agent 等待修改确认'
                                : 'Agent 等待你的确认'}
              </span>
              <span className="mt-1 block truncate text-2xs text-muted" title={agentRun.goal}>
                {agentRun.goal || '打开工作台查看当前进度'}
              </span>
            </span>
            <ChevronRight
              size={16}
              className="mt-1 flex-shrink-0 text-muted"
              aria-hidden="true"
            />
          </button>
        ) : null}

        {!chapterIndex ? (
          <ContextStatus
            availability={context?.availability ?? 'unavailable'}
            refreshing={context?.refreshing ?? false}
            onRefresh={context?.refresh ?? onRefresh}
          />
        ) : null}
        {chapterIndex?.status === 'error' ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-error/40 bg-error/5 px-3 py-2 text-xs text-error"
            role="alert"
          >
            <span className="min-w-0 flex-1">
              章节索引读取失败：{chapterIndex.error ?? '未知错误'}
            </span>
            <button
              type="button"
              onClick={chapterIndex.refresh}
              className="rounded-md border border-error/40 px-2 py-1 text-2xs hover:bg-error/10"
            >
              重试
            </button>
          </div>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-2 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div
            ref={chapterListRef}
            tabIndex={-1}
            aria-label="章节列表"
            className="card-hover rounded-xl border border-border bg-panel focus-visible:outline focus-visible:outline-agent"
            data-testid="book-overview-recent-chapters"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium text-foreground">章节 · 阅读顺序</h2>
              <span className="rounded-full bg-elevated px-2 py-0.5 text-2xs text-subtle">
                {chapterIndex?.status === 'available'
                  ? `${chapters.length} 章`
                  : chapterIndex?.status === 'loading'
                    ? '读取中…'
                    : '未读取'}
              </span>
            </div>
            {recentChapters.length > 0 ? (
              <ul className="divide-y divide-border">
                {recentChapters.map((chapter) => (
                  <li key={chapter.relativePath} className="stagger-item">
                    <button
                      type="button"
                      disabled={!onOpenChapter}
                      onClick={() => onOpenChapter?.(chapter.relativePath)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated disabled:cursor-default"
                      data-testid="book-overview-chapter-row"
                    >
                      <span className="flex h-7 w-8 flex-shrink-0 items-center justify-center rounded-md bg-elevated font-mono text-2xs text-subtle transition-colors group-hover:bg-agent/10 group-hover:text-agent">
                        {String(chapter.ordinal).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted transition-colors group-hover:text-foreground">
                        {chapter.name}
                      </span>
                      <span className="text-2xs text-subtle">
                        {chapter.estimatedChars === null
                          ? '字数未知'
                          : formatEstimatedChars(chapter.estimatedChars)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
                  <FileText size={20} className="text-subtle" aria-hidden="true" />
                </div>
                <p className="text-xs text-subtle">
                  {chapterIndex?.status === 'loading'
                    ? '正在读取章节索引…'
                    : chapterIndex?.status === 'available'
                      ? '还没有检测到正文章节，可进入写作工作台新建文件。'
                      : chapterIndex?.status === 'error'
                        ? `章节索引读取失败：${chapterIndex.error ?? '未知错误'}`
                        : '章节尚未读取完成；加载失败时请重试。'}
                </p>
              </div>
            )}
          </div>

          <div
            className="card-hover rounded-xl border border-border bg-panel"
            data-testid="book-overview-outline"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium text-foreground">大纲速览</h2>
              <span className="rounded-full bg-elevated px-2 py-0.5 text-2xs text-subtle">
                {profile.outline.length ? `${profile.outline.length} 条` : '未读取'}
              </span>
            </div>
            {outlineItems.length > 0 ? (
              <ul className="divide-y divide-border">
                {outlineItems.map((entry) => (
                  <li key={`${entry.path}:${entry.line}`} className="stagger-item">
                    <button
                      type="button"
                      disabled={!onOpenOutline}
                      onClick={() => onOpenOutline?.(entry.path, entry.line)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated disabled:cursor-default"
                      data-testid="book-overview-outline-row"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-muted transition-colors group-hover:text-foreground">
                        {entry.text}
                      </span>
                      <ChevronRight
                        size={14}
                        className="flex-shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
                  <BookOpen size={20} className="text-subtle" aria-hidden="true" />
                </div>
                <p className="text-xs text-subtle">还没有可展示的大纲标题。</p>
              </div>
            )}
          </div>
        </section>

        <p className="flex items-center gap-2 text-2xs text-subtle">
          <FileText size={12} aria-hidden="true" />
          资料来自项目文件与确定性索引；总览不会自动写盘。
        </p>
      </div>
    </div>
  );
}
