/**
 * 左栏「作品」视图：一本书的立项档案 + 写作途中要随手够到的三样东西。
 *
 * 此前一本书在 IDE 里的全部身份就是它的目录名。书名、简介、题材、这本书的字数目标，
 * 作者立项时想写下的那几行没有地方放；写到一半想核对大纲、记一条突然冒出来的点子，
 * 都要先离开正文去文件树里翻。这个视图按写作顺序把这些收在一处：
 *   档案（是什么书）→ 进度（写到哪了）→ 大纲（这一章该发生什么）→ 速记（别忘了）。
 *
 * 档案落 `.storyforge/book.json`，速记落项目根 `灵感.md`，都是作者可直接打开手改的文件；
 * 章数与字数一律现算不落盘。视图本身不判定任何东西。
 */
import { useMemo, useState } from 'react';

import type { BookProfileHandle } from '../app/useBookProfile';
import {
  bookGoalProgress,
  displayBookTitle,
  formatWordCount,
  normalizeTags,
  type BookProfile,
} from '../../lib/book-profile';
import { readDailyProgress } from '../../lib/daily-progress';
import type { OutlineEntry } from '../../lib/outline-index';
import { Check, FileText, ImagePlus, Library, Plus, RefreshCw, X } from '../icons/shell-icons';
import { PanelSection } from './PanelSection';

/** 文本字段留在本地 draft：每敲一个字就写盘既无必要，也会把 `.storyforge/` 刷成日志。 */
type Draft = { title: string; synopsis: string; wordGoal: string };

function toDraft(profile: BookProfile): Draft {
  return {
    title: profile.title,
    synopsis: profile.synopsis,
    wordGoal: profile.wordGoal ? String(profile.wordGoal) : '',
  };
}

function Section(props: Omit<Parameters<typeof PanelSection>[0], 'prefix'>) {
  return <PanelSection {...props} prefix="book" />;
}

function GoalBar({ progress, testid }: { progress: number; testid: string }) {
  return (
    <div className="mt-1 h-1 overflow-hidden rounded-full bg-elevated">
      <div
        className="h-full rounded-full bg-agent transition-[width] duration-300"
        style={{ width: `${Math.round(progress * 100)}%` }}
        data-testid={testid}
        data-progress={Math.round(progress * 100)}
      />
    </div>
  );
}

function StatRow({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-px text-2xs text-muted">
      <span>{label}</span>
      <span className="truncate tabular-nums text-foreground" data-testid={testid}>
        {value}
      </span>
    </div>
  );
}

export function BookProfileView({
  projectPath,
  handle,
  dailyWordGoal,
  onOpenOutline,
  onBackToExplorer,
}: {
  projectPath: string;
  handle: BookProfileHandle;
  dailyWordGoal: number;
  onOpenOutline: (path: string, line: number) => void;
  onBackToExplorer: () => void;
}) {
  // 档案还在读盘时 profile 仍是空档案：此刻放行编辑，读完会把作者刚敲的字覆盖掉；
  // 更糟的是点封面会拿这份空档案写回磁盘，把已有的书名简介清空。故读盘期间整个档案区停用。
  const { profile } = handle;
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const [tagDraft, setTagDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');

  // 档案换了一份（切项目 / 点刷新重读磁盘）就把编辑框拉回磁盘上的值。渲染期调整而不是
  // effect：后者会多跑一轮，那一轮里编辑框显示的还是上一本书的简介。
  const [syncedProfile, setSyncedProfile] = useState(profile);
  if (syncedProfile !== profile) {
    setSyncedProfile(profile);
    setDraft(toDraft(profile));
  }

  /**
   * 「此刻的档案」＝ 已落盘的档案 + draft 里还没提交的编辑框内容。
   * 作者书名敲到一半去点封面 / 加题材，那半个书名必须跟着一起走，不能因此丢掉。
   */
  const merged = (patch: Partial<BookProfile> = {}): BookProfile => {
    const parsedGoal = Number.parseInt(draft.wordGoal.replace(/[^\d]/g, ''), 10);
    return {
      ...profile,
      title: draft.title.trim(),
      synopsis: draft.synopsis,
      wordGoal: Number.isFinite(parsedGoal) && parsedGoal > 0 ? parsedGoal : 0,
      ...patch,
    };
  };

  const commit = (patch: Partial<BookProfile> = {}) => void handle.save(merged(patch));

  const addTag = () => {
    const tags = normalizeTags([...profile.tags, tagDraft]);
    setTagDraft('');
    if (tags.length !== profile.tags.length) commit({ tags });
  };

  const addNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    setNoteDraft('');
    void handle.addNote(text);
  };

  const daily = readDailyProgress(projectPath);
  const dailyProgress = bookGoalProgress(daily.chars, dailyWordGoal);
  const totalChars = handle.totals?.chars ?? null;
  const bookProgress = totalChars === null ? null : bookGoalProgress(totalChars, profile.wordGoal);

  // 大纲按文件分组：一本书的大纲常散在总纲 / 分卷几份文件里，混成一条流就读不出归属。
  const outlineGroups = useMemo(() => {
    const groups = new Map<string, { relativePath: string; path: string; items: OutlineEntry[] }>();
    for (const entry of handle.outline) {
      const group = groups.get(entry.relativePath);
      if (group) group.items.push(entry);
      else
        groups.set(entry.relativePath, {
          relativePath: entry.relativePath,
          path: entry.path,
          items: [entry],
        });
    }
    return [...groups.values()];
  }, [handle.outline]);

  const openNotes = handle.notes.filter((note) => !note.done).length;

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid="book-profile-view"
    >
      <header
        className="flex h-shell-row flex-shrink-0 items-center gap-2 border-b border-border bg-panel px-3 pr-2"
        data-testid="book-profile-header"
      >
        <Library size={14} strokeWidth={1.7} className="flex-shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">作品</span>
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="重新读取档案与进度"
          onClick={handle.refresh}
          data-testid="book-profile-refresh"
        >
          <RefreshCw
            size={14}
            strokeWidth={1.6}
            className={handle.refreshing ? 'animate-spin' : ''}
          />
        </button>
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="回到资源管理器 · Ctrl+Shift+E"
          onClick={onBackToExplorer}
          data-testid="book-profile-back-to-explorer"
        >
          <FileText size={14} strokeWidth={1.6} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex gap-2.5 p-3">
          <button
            type="button"
            disabled={handle.loading}
            className="group relative h-24 w-[72px] flex-shrink-0 overflow-hidden rounded-sm border border-border bg-panel transition-colors hover:border-muted disabled:opacity-60"
            title={profile.cover ? '更换封面' : '添加封面'}
            onClick={() => {
              // 先提交再选图：作者若在文件对话框里按了取消，没提交的编辑也已经保住。
              commit();
              void handle.pickCover(merged());
            }}
            data-testid="book-cover-slot"
            data-has-cover={handle.coverUrl ? 'true' : 'false'}
          >
            {handle.coverUrl ? (
              <img
                src={handle.coverUrl}
                alt="封面"
                className="h-full w-full object-cover"
                data-testid="book-cover-image"
              />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-subtle group-hover:text-muted">
                <ImagePlus size={16} strokeWidth={1.6} />
                <span className="text-3xs">封面</span>
              </span>
            )}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              value={draft.title}
              disabled={handle.loading}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              onBlur={() => commit()}
              placeholder={displayBookTitle(profile, projectPath)}
              className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted hover:border-border focus:border-accent"
              data-testid="book-title-input"
            />
            <div className="flex flex-wrap gap-1">
              {profile.tags.map((tag) => (
                <span
                  key={tag}
                  className="group inline-flex items-center gap-0.5 rounded-sm bg-elevated px-1.5 py-0.5 text-3xs text-muted"
                  data-testid="book-tag"
                >
                  {tag}
                  <button
                    type="button"
                    className="text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    title={`移除题材 ${tag}`}
                    aria-label={`移除题材 ${tag}`}
                    onClick={() => commit({ tags: profile.tags.filter((item) => item !== tag) })}
                  >
                    <X size={10} strokeWidth={2} />
                  </button>
                </span>
              ))}
              {profile.tags.length < 8 && (
                <span className="inline-flex items-center">
                  <Plus size={10} strokeWidth={2} className="mr-0.5 text-subtle" />
                  <input
                    value={tagDraft}
                    disabled={handle.loading}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onBlur={addTag}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="题材"
                    className="w-12 rounded-sm border border-transparent bg-transparent text-3xs text-foreground outline-none placeholder:text-subtle hover:border-border focus:w-16 focus:border-accent"
                    data-testid="book-tag-input"
                  />
                </span>
              )}
            </div>
          </div>
        </div>

        <Section title="简介" testid="synopsis" defaultOpen>
          <textarea
            value={draft.synopsis}
            disabled={handle.loading}
            onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
            onBlur={() => commit()}
            rows={4}
            placeholder="这本书讲什么？写给未来的自己，也写给每次都要重新读懂它的模型。"
            className="mx-3 w-[calc(100%-1.5rem)] resize-none rounded-sm border border-border bg-panel px-2 py-1.5 text-2xs leading-relaxed text-foreground outline-none placeholder:text-subtle focus:border-accent"
            data-testid="book-synopsis-input"
          />
        </Section>

        <Section title="进度" testid="progress" defaultOpen>
          <div className="px-3">
            {handle.totalsError ? (
              <p className="text-3xs leading-relaxed text-error">统计失败：{handle.totalsError}</p>
            ) : totalChars === null ? (
              <p className="text-3xs text-subtle">正在统计全书字数…</p>
            ) : (
              <>
                <StatRow
                  label="全书"
                  value={`${handle.totals?.chapters ?? 0} 章 · ${formatWordCount(totalChars)}`}
                  testid="book-total-chars"
                />
                {handle.totals && handle.totals.unreadable > 0 && (
                  <p className="text-3xs text-error">
                    {handle.totals.unreadable} 个文件读取失败，未计入总和。
                  </p>
                )}
              </>
            )}

            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-2xs text-muted">
              <span>全书目标</span>
              <input
                value={draft.wordGoal}
                disabled={handle.loading}
                onChange={(event) => setDraft({ ...draft, wordGoal: event.target.value })}
                onBlur={() => commit()}
                inputMode="numeric"
                placeholder="未设"
                className="w-20 rounded-sm border border-transparent bg-transparent px-1 text-right text-2xs tabular-nums text-foreground outline-none placeholder:text-subtle hover:border-border focus:border-accent"
                data-testid="book-word-goal-input"
              />
            </div>
            {bookProgress !== null && <GoalBar progress={bookProgress} testid="book-goal-bar" />}

            <div className="mt-2.5 border-t border-border pt-2">
              <StatRow
                label="今日已存"
                value={`${daily.chars >= 0 ? '+' : ''}${daily.chars.toLocaleString('zh-CN')} 字`}
                testid="book-daily-chars"
              />
              {dailyProgress !== null && (
                <>
                  <StatRow label="日更目标" value={`${dailyWordGoal.toLocaleString('zh-CN')} 字`} />
                  <GoalBar progress={dailyProgress} testid="book-daily-goal-bar" />
                </>
              )}
              <p className="mt-1 text-3xs leading-relaxed text-subtle">
                只算已保存的净增量，未保存的草稿不计入。
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="大纲"
          meta={handle.outline.length > 0 ? String(handle.outline.length) : undefined}
          testid="outline"
          defaultOpen
        >
          {outlineGroups.length === 0 ? (
            <p className="px-3 text-3xs leading-relaxed text-subtle">
              「大纲」目录下还没有带标题的文档。写下 `## 第三幕` 一类的标题，这里就能一键跳过去。
            </p>
          ) : (
            <div data-testid="book-outline-list">
              {outlineGroups.map((group) => (
                <div key={group.relativePath} className="pb-1">
                  <button
                    type="button"
                    className="flex h-6 w-full items-center px-3 text-left text-3xs text-subtle hover:text-foreground"
                    onClick={() => onOpenOutline(group.path, 0)}
                    title={group.relativePath}
                  >
                    <span className="min-w-0 truncate">{group.relativePath}</span>
                  </button>
                  <ul>
                    {group.items.map((item) => (
                      <li key={`${item.relativePath}:${item.line}`}>
                        <button
                          type="button"
                          className="flex h-6 w-full items-center text-left text-2xs text-muted hover:bg-elevated hover:text-foreground"
                          style={{ paddingLeft: `${12 + (item.level - 1) * 10}px` }}
                          onClick={() => onOpenOutline(item.path, item.line)}
                          title={`${item.relativePath} · 第 ${item.line + 1} 行`}
                          data-testid="book-outline-row"
                        >
                          <span className="min-w-0 truncate pr-2">{item.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {handle.outlineDropped > 0 && (
                <p className="px-3 pt-1 text-3xs leading-relaxed text-subtle">
                  另有 <span className="text-foreground">{handle.outlineDropped}</span>{' '}
                  条标题没列出来。
                </p>
              )}
            </div>
          )}
        </Section>

        <Section
          title="灵感速记"
          meta={openNotes > 0 ? String(openNotes) : undefined}
          testid="notes"
          defaultOpen
        >
          <div className="px-3">
            <input
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addNote();
                }
              }}
              placeholder="记一条，回车存进 灵感.md"
              className="w-full rounded-sm border border-border bg-panel px-2 py-1 text-2xs text-foreground outline-none placeholder:text-subtle focus:border-accent"
              data-testid="book-note-input"
            />
          </div>
          {handle.notes.length > 0 && (
            <ul className="mt-1" data-testid="book-note-list">
              {handle.notes.map((note) => (
                <li
                  key={note.line}
                  className="group flex items-start gap-1.5 px-3 py-0.5 hover:bg-elevated"
                  data-testid="book-note-row"
                  data-done={note.done}
                >
                  <button
                    type="button"
                    className={`mt-[3px] grid h-3 w-3 flex-shrink-0 place-items-center rounded-xs border ${
                      note.done ? 'border-muted text-muted' : 'border-border text-transparent'
                    } hover:border-muted`}
                    title={note.done ? '标记为未完成' : '标记为已完成'}
                    aria-label={note.done ? '标记为未完成' : '标记为已完成'}
                    onClick={() => void handle.toggleNote(note)}
                  >
                    <Check size={9} strokeWidth={3} />
                  </button>
                  <span
                    className={`min-w-0 flex-1 break-words text-2xs leading-snug ${
                      note.done ? 'text-subtle line-through' : 'text-muted'
                    }`}
                  >
                    {note.text}
                  </span>
                  <button
                    type="button"
                    className="mt-[2px] flex-shrink-0 text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    title="删除这条"
                    aria-label={`删除速记 ${note.text}`}
                    onClick={() => void handle.removeNote(note)}
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
