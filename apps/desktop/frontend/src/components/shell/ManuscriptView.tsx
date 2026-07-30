/**
 * 左栏「手稿」视图：按阅读序列出正文章节，并把**模型这轮拿到的作品底座**摊开给作者看。
 *
 * 两件此前只有模型知道、作者看不见的事：
 * 1. 阅读序——资源管理器按文件夹排，回答不了「我写到第几章、全书多长」；
 * 2. 底座配额——骨架索引上限 12 份、实体名单上限 20 位，超了**静默截断**。
 *    #235 的教训是「整类被丢了而作者不知道」，所以这里一律把丢掉的条数写成数字。
 *
 * 视图是纯展示：数据全部来自 `useBookContext`，字数一律是后端估算值（带「约」字，
 * 与 prompt 同源），精确字数在状态栏。
 */
import { BookOpen, FileText, RefreshCw } from '../icons/shell-icons';
import {
  droppedCount,
  formatEstimatedChars,
  type BookContextSnapshot,
  type RosterEntry,
} from '../../lib/book-context';
import type { BookContextAvailability } from '../app/useBookContext';
import { PanelSection } from './PanelSection';

function rosterSpanLabel(entry: RosterEntry): string {
  if (entry.missing) return '正文中尚未登场';
  if (entry.firstChapter === null || entry.lastChapter === null) return '出场章次未统计';
  return entry.firstChapter === entry.lastChapter
    ? `仅第 ${entry.firstChapter} 章在场`
    : `第 ${entry.firstChapter}–${entry.lastChapter} 章在场`;
}

/** 手稿视图的分区一律 `manuscript-` 前缀，testid 与抽出公共组件前保持一致。 */
function Section(props: Omit<Parameters<typeof PanelSection>[0], 'prefix'>) {
  return <PanelSection {...props} prefix="manuscript" />;
}

/** 被截断时把丢掉的条数说清楚；没截断就不占版面。 */
function DroppedNote({ total, shown, unit }: { total: number; shown: number; unit: string }) {
  const dropped = droppedCount(total, shown);
  if (dropped === 0) return null;
  return (
    <p
      className="px-3 pt-1 text-3xs leading-relaxed text-subtle"
      data-testid="manuscript-dropped-note"
    >
      模型只拿到前 {shown} {unit}，另有 <span className="text-foreground">{dropped}</span> {unit}
      没进这一轮。
    </p>
  );
}

export function ManuscriptView({
  snapshot,
  availability,
  refreshing,
  onRefresh,
  onOpenChapter,
  onBackToExplorer,
}: {
  snapshot: BookContextSnapshot | null;
  availability: BookContextAvailability;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenChapter: (relativePath: string) => void;
  onBackToExplorer: () => void;
}) {
  const busy = refreshing || availability === 'loading';
  const scale = snapshot
    ? `${snapshot.totalChapters} 章 · ${formatEstimatedChars(snapshot.totalEstimatedChars)}`
    : '';

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid="manuscript-view"
    >
      <header
        className="flex h-shell-row flex-shrink-0 items-center gap-2 border-b border-border bg-panel px-3 pr-2"
        data-testid="manuscript-header"
      >
        <BookOpen size={14} strokeWidth={1.7} className="flex-shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">手稿</span>
        {scale && (
          <span
            className="flex-shrink-0 font-mono text-3xs text-subtle"
            data-testid="manuscript-scale"
          >
            {scale}
          </span>
        )}
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="重新读取（确定性 · 无 LLM）"
          onClick={onRefresh}
          data-testid="manuscript-refresh"
        >
          <RefreshCw size={14} strokeWidth={1.6} className={busy ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="回到资源管理器 · Ctrl+Shift+E"
          onClick={onBackToExplorer}
          data-testid="manuscript-back-to-explorer"
        >
          <FileText size={14} strokeWidth={1.6} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {availability !== 'available' || !snapshot ? (
          <p className="px-4 py-4 text-2xs leading-relaxed text-subtle">
            {availability === 'loading'
              ? '正在读取手稿结构。'
              : availability === 'error'
                ? '读取失败，请点上方刷新重试。'
                : '打开一个项目后，这里显示按阅读序排列的章节。'}
          </p>
        ) : (
          <>
            {snapshot.chapters.length === 0 ? (
              <p className="px-4 py-4 text-2xs leading-relaxed text-subtle">
                还没有正文章节。正文放在「正文 / draft / chapters」一类目录下才计入阅读序。
              </p>
            ) : (
              <ul data-testid="manuscript-chapter-list">
                {snapshot.chapters.map((chapter) => {
                  const current = chapter.relativePath === snapshot.currentRelativePath;
                  return (
                    <li key={chapter.relativePath}>
                      <button
                        type="button"
                        className={`flex h-7 w-full items-center gap-2 px-2 text-left text-xs hover:bg-elevated ${
                          current
                            ? 'bg-elevated text-foreground'
                            : 'text-muted hover:text-foreground'
                        }`}
                        onClick={() => onOpenChapter(chapter.relativePath)}
                        title={chapter.relativePath}
                        data-testid="manuscript-chapter-row"
                        data-current={current}
                      >
                        <span className="w-6 flex-shrink-0 text-right font-mono text-3xs text-subtle">
                          {chapter.ordinal}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{chapter.name}</span>
                        <span className="flex-shrink-0 font-mono text-3xs text-subtle">
                          {formatEstimatedChars(chapter.estimatedChars)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <Section
              title="骨架索引"
              meta={`${snapshot.skeleton.length}/${snapshot.skeletonTotal}`}
              testid="skeleton"
            >
              {snapshot.skeleton.length === 0 ? (
                <p className="px-3 text-3xs leading-relaxed text-subtle">
                  没有大纲 / 人物 / 设定一类的非正文文档。
                </p>
              ) : (
                <ul>
                  {snapshot.skeleton.map((entry) => (
                    <li
                      key={entry.relativePath}
                      className="flex h-6 items-center gap-2 px-3 text-2xs text-muted"
                    >
                      <span className="min-w-0 flex-1 truncate" title={entry.relativePath}>
                        {entry.relativePath}
                      </span>
                      <span className="flex-shrink-0 font-mono text-3xs text-subtle">
                        {formatEstimatedChars(entry.estimatedChars)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <DroppedNote
                total={snapshot.skeletonTotal}
                shown={snapshot.skeleton.length}
                unit="份"
              />
            </Section>

            <Section
              title="模型拿到的实体名单"
              meta={`${snapshot.roster.length}/${snapshot.rosterDeclaredTotal}`}
              testid="roster"
            >
              {snapshot.roster.length === 0 ? (
                <p className="px-3 text-3xs leading-relaxed text-subtle">
                  canon.json
                  尚未声明实体。观测镜里的实体信号是另一回事——这里只反映底座这一轮带了谁。
                </p>
              ) : (
                <ul>
                  {snapshot.roster.map((entry) => (
                    <li key={entry.canonicalName} className="px-3 py-0.5 text-2xs">
                      <div className="flex items-baseline gap-1.5">
                        <span className="min-w-0 truncate text-foreground">
                          {entry.canonicalName}
                        </span>
                        {entry.aliases.length > 0 && (
                          <span className="min-w-0 truncate text-3xs text-subtle">
                            又称 {entry.aliases.join(' / ')}
                          </span>
                        )}
                      </div>
                      <div className="text-3xs text-subtle">{rosterSpanLabel(entry)}</div>
                    </li>
                  ))}
                </ul>
              )}
              <DroppedNote
                total={snapshot.rosterDeclaredTotal}
                shown={snapshot.roster.length}
                unit="位"
              />
            </Section>

            <Section
              title="模型这轮收到的原文"
              meta={snapshot.promptBlock ? `${snapshot.promptBlock.length} 字` : '空'}
              testid="prompt"
            >
              {snapshot.promptBlock ? (
                <pre
                  className="mx-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-panel p-2 text-3xs leading-relaxed text-muted"
                  data-testid="manuscript-prompt-block"
                >
                  {snapshot.promptBlock}
                </pre>
              ) : (
                <p className="px-3 text-3xs leading-relaxed text-subtle">
                  这一轮没有可报的全书事实，底座不占 system 位。
                </p>
              )}
              {snapshot.previousChapter && (
                <p className="px-3 pt-1.5 text-3xs leading-relaxed text-subtle">
                  含上一章结尾 · {snapshot.previousChapter.relativePath}
                </p>
              )}
              {snapshot.dossierRelativePath && (
                <p className="px-3 pt-1 text-3xs leading-relaxed text-subtle">
                  已指向事实卡 · {snapshot.dossierRelativePath}
                </p>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
