/**
 * 项目仪表盘：打开项目后的落地页，占据整个中间区。
 *
 * 设计立场：给每本书一个「门面」，新建项目后先在这里填世界观与大纲，
 * 不是直接扔到编辑器里摸黑。仪表盘汇总：
 *   - 封面大图 + 书名 + 简介（可编辑）
 *   - 进度统计（章数 / 字数 / 目标进度条）
 *   - 世界观概览（canon 实体前 10 条）
 *   - 大纲快速预览（折叠卡片，点击跳转）
 *   - 行动区：[开始写作] [查看设定] 两个主按钮
 *
 * 与左栏"作品"视图的区别：
 *   - 左栏是写作途中的快捷入口（小而密集）
 *   - 仪表盘是立项阶段的全貌展示（大而舒展）
 */
import type { BookProfileHandle } from './useBookProfile';
import type { BookContextHandle } from './useBookContext';
import { bookGoalProgress, displayBookTitle, formatWordCount } from '../../lib/book-profile';
import { ArrowUp, BookOpen, Pencil, Radar, Sparkles } from '../icons/shell-icons';

export function ProjectDashboard({
  projectPath,
  bookProfile,
  bookContext,
  onStartWriting,
  onViewSettings,
}: {
  projectPath: string;
  bookProfile: BookProfileHandle;
  bookContext: BookContextHandle;
  onStartWriting: () => void;
  onViewSettings: () => void;
}) {
  const { profile, coverUrl, totals, totalsError } = bookProfile;
  const { entities } = bookContext;

  const totalChars = totals?.chars ?? null;
  const bookProgress = totalChars === null ? null : bookGoalProgress(totalChars, profile.wordGoal);
  const progressPercent = bookProgress ? Math.round(bookProgress * 100) : 0;

  // canon 实体前 10 条，世界观快速预览
  const topEntities = entities.slice(0, 10);
  const hasMoreEntities = entities.length > 10;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-testid="project-dashboard"
    >
      {/* 顶栏：项目名 */}
      <header className="flex h-shell-row flex-shrink-0 items-center border-b border-border bg-panel px-4">
        <Sparkles size={15} strokeWidth={1.7} className="mr-2 text-agent" />
        <span className="text-sm font-semibold text-foreground">
          {displayBookTitle(profile, projectPath)}
        </span>
      </header>

      {/* 滚动区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 py-8">
          {/* 英雄区：封面 + 书名 + 简介 */}
          <section className="mb-8 flex gap-6">
            {/* 封面大图 */}
            <div className="flex-shrink-0">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt="封面"
                  className="h-64 w-48 rounded-lg border border-border object-cover shadow-lg"
                  data-testid="dashboard-cover"
                />
              ) : (
                <div
                  className="flex h-64 w-48 flex-col items-center justify-center rounded-lg border border-border bg-panel text-subtle shadow-lg"
                  data-testid="dashboard-cover-placeholder"
                >
                  <BookOpen size={32} strokeWidth={1.5} className="mb-2" />
                  <span className="text-xs">暂无封面</span>
                </div>
              )}
            </div>

            {/* 书名 + 简介 + 题材 */}
            <div className="flex min-w-0 flex-1 flex-col">
              <h1 className="mb-3 text-3xl font-bold text-foreground" data-testid="dashboard-title">
                {profile.title || displayBookTitle(profile, projectPath)}
              </h1>

              {profile.tags.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {profile.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-elevated px-3 py-1 text-xs text-muted"
                      data-testid="dashboard-tag"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <p
                className="mb-6 text-sm leading-relaxed text-muted"
                data-testid="dashboard-synopsis"
              >
                {profile.synopsis || '这本书还没有简介。点击左栏"作品"视图可以编辑。'}
              </p>

              {/* 行动按钮 */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onStartWriting}
                  className="flex items-center gap-2 rounded-lg bg-agent px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:bg-agent/90 hover:shadow-lg"
                  data-testid="dashboard-start-writing"
                >
                  <Pencil size={16} strokeWidth={2} />
                  <span>开始写作</span>
                  <ArrowUp size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={onViewSettings}
                  className="flex items-center gap-2 rounded-lg border border-border bg-panel px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:bg-elevated"
                  data-testid="dashboard-view-settings"
                >
                  <Radar size={16} strokeWidth={2} />
                  <span>查看设定</span>
                </button>
              </div>
            </div>
          </section>

          {/* 统计卡片区 */}
          <section className="mb-8 grid grid-cols-3 gap-4">
            {/* 章节数 */}
            <div className="rounded-lg border border-border bg-panel p-4 shadow-sm">
              <div className="mb-1 text-xs text-subtle">章节</div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {totalsError ? '—' : (totals?.chapters ?? '...')}
              </div>
            </div>

            {/* 总字数 */}
            <div className="rounded-lg border border-border bg-panel p-4 shadow-sm">
              <div className="mb-1 text-xs text-subtle">字数</div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {totalsError ? '—' : totalChars === null ? '...' : formatWordCount(totalChars)}
              </div>
            </div>

            {/* 目标进度 */}
            <div className="rounded-lg border border-border bg-panel p-4 shadow-sm">
              <div className="mb-1 text-xs text-subtle">目标进度</div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {profile.wordGoal > 0 && bookProgress !== null ? `${progressPercent}%` : '未设'}
              </div>
              {profile.wordGoal > 0 && bookProgress !== null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-agent transition-[width] duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </div>
          </section>

          {/* 世界观概览 */}
          {topEntities.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
                <Radar size={18} strokeWidth={2} className="text-agent" />
                <span>世界观</span>
                <span className="text-xs font-normal text-subtle">
                  （{entities.length} 个实体）
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {topEntities.map(
                  (entity: { id: string; canonical_name: string; aliases: string[] }) => (
                    <div
                      key={entity.id}
                      className="rounded-lg border border-border bg-panel p-3 shadow-sm transition-colors hover:bg-elevated"
                      data-testid="dashboard-entity"
                    >
                      <div className="mb-1 text-sm font-medium text-foreground">
                        {entity.canonical_name}
                      </div>
                      {entity.aliases.length > 0 && (
                        <div className="text-xs text-subtle">
                          别名：{entity.aliases.slice(0, 3).join('、')}
                          {entity.aliases.length > 3 && '…'}
                        </div>
                      )}
                    </div>
                  ),
                )}
              </div>
              {hasMoreEntities && (
                <p className="mt-3 text-xs text-subtle">
                  另有 {entities.length - 10} 个实体。点击"查看设定"查看完整世界观。
                </p>
              )}
            </section>
          )}

          {/* 空状态引导 */}
          {topEntities.length === 0 && (
            <section className="rounded-lg border border-border bg-panel p-8 text-center shadow-sm">
              <Radar size={48} strokeWidth={1.5} className="mx-auto mb-4 text-subtle" />
              <h3 className="mb-2 text-lg font-semibold text-foreground">还没有世界观设定</h3>
              <p className="mb-4 text-sm leading-relaxed text-muted">
                新建项目后，可以先和 Agent 聊一聊这本书的世界观、人物与故事走向。
                <br />
                Agent 会帮你把设定记录在 `.storyforge/canon.json` 里。
              </p>
              <button
                type="button"
                onClick={onStartWriting}
                className="inline-flex items-center gap-2 rounded-lg bg-agent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-agent/90"
              >
                <span>开始与 Agent 对话</span>
                <ArrowUp size={14} strokeWidth={2} />
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
