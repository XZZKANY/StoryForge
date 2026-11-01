import type { ReactNode } from 'react';

import { emitOpenFileRequest } from '../../lib/assistant-events';
import { resolveProjectRelativePath } from '../../lib/project-context';
import { Button, PlainButton } from '../ui';
import { ContextPanel } from './ContextPanel';
import type { AgentRun } from './types';
import type { WriteBatchProgress } from './write-batch-run';
import type { WriteBatchProgressChapter } from './write-batch-run';

const CHAPTER_STATE_LABEL: Record<WriteBatchProgressChapter['state'], string> = {
  pending: '待写',
  written: '已写进',
  stopped_here: '停在这里',
  skipped_written: '已有正文',
  after_trial: '试写后再写',
  undone: '已撤销',
};

function ChapterRow({
  chapter,
  writing,
  projectPath,
}: {
  chapter: WriteBatchProgressChapter;
  writing: boolean;
  projectPath: string | null;
}) {
  const name = `第 ${chapter.ordinal} 章${chapter.title ? `《${chapter.title}》` : ''}`;
  const openable = chapter.state === 'written' || chapter.state === 'skipped_written';
  const label = writing
    ? '正在写'
    : chapter.state === 'written' && chapter.chars !== null
      ? `${chapter.chars} 字`
      : CHAPTER_STATE_LABEL[chapter.state];
  const mark = writing ? (
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-agent" />
  ) : chapter.state === 'written' ? (
    <span className="text-success">✓</span>
  ) : chapter.state === 'stopped_here' ? (
    <span className="text-warning">■</span>
  ) : (
    <span className="text-subtle">○</span>
  );
  const body = (
    <>
      <span aria-hidden="true" className="flex w-3 flex-shrink-0 justify-center text-3xs">
        {mark}
      </span>
      <span className={`min-w-0 flex-1 truncate ${writing ? 'text-foreground' : ''}`}>{name}</span>
      <span className={`flex-shrink-0 ${writing ? 'text-agent' : 'text-subtle'}`}>{label}</span>
    </>
  );
  const rowClass = 'flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs';
  const filePath =
    openable && projectPath ? resolveProjectRelativePath(projectPath, chapter.targetPath) : null;
  return (
    <li data-testid="side-rail-chapter" data-state={writing ? 'writing' : chapter.state}>
      {filePath ? (
        <PlainButton
          className={`${rowClass} text-left text-muted transition-colors hover:bg-elevated hover:text-foreground`}
          title={`打开 ${chapter.targetPath}`}
          onClick={() => emitOpenFileRequest(filePath)}
        >
          {body}
        </PlainButton>
      ) : (
        <div className={`${rowClass} text-muted`} title={chapter.targetPath}>
          {body}
        </div>
      )}
    </li>
  );
}

/** 侧栏里的批量写章：写到第几章、用了多少，每章去向一行（引擎记录里的），写进了的点开看。 */
function WriteBatchRailSection({
  projectPath,
  progress,
  onStop,
}: {
  projectPath: string | null;
  progress: WriteBatchProgress;
  onStop: () => void;
}) {
  const position =
    progress.ordinal !== null
      ? `第 ${progress.ordinal} 章（${progress.index} / ${progress.total}）`
      : '准备中';
  const usage =
    progress.used !== null
      ? `已用 ${progress.used}${progress.cap !== null ? ` / 上限 ${progress.cap}` : ''}`
      : null;
  const finished = progress.ordinal !== null ? Math.max(progress.index - 1, 0) : 0;
  const ratio = progress.total > 0 ? finished / progress.total : 0;
  return (
    <section
      aria-label="批量写章"
      className="space-y-2 px-3 py-2.5"
      data-testid="write-batch-progress"
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-xs font-medium text-foreground">批量写章</h3>
        <Button
          size="compact"
          variant="ghost"
          onClick={onStop}
          disabled={progress.stopping}
          data-testid="write-batch-stop"
        >
          {progress.stopping ? '正在停…' : '停止'}
        </Button>
      </div>
      <div className="space-y-1">
        <div className="flex items-baseline gap-2 text-xs" role="status">
          <span className="flex-shrink-0 text-muted" data-testid="side-rail-write-batch-position">
            {position}
          </span>
          {usage && <span className="min-w-0 truncate text-subtle">{usage}</span>}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
          <div
            className="h-full rounded-full bg-agent transition-[width]"
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      </div>
      {progress.chapters.length > 0 && (
        <ol className="-mx-1.5 space-y-px" aria-label="这一批每章的去向">
          {progress.chapters.map((chapter) => (
            <ChapterRow
              key={chapter.ordinal}
              chapter={chapter}
              writing={chapter.ordinal === progress.ordinal && chapter.state === 'pending'}
              projectPath={projectPath}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * 对话占满中右且够宽时贴在对话右边的侧栏：这一批写到哪、这一轮带了哪些参考资料、AI 每轮带着什么。
 * 窄的时候这些回到输入框顶边的小条和对话头的「上下文」浮窗，内容是同一份。
 */
export function ChatSideRail({
  projectPath,
  run,
  writeBatch,
  onStopWriteBatch,
  references,
  onOpenSettings,
}: {
  projectPath: string | null;
  run: AgentRun | null;
  /** 批量写章进行中才给。 */
  writeBatch: WriteBatchProgress | null;
  onStopWriteBatch: () => void;
  /** 参考资料那一块（ContextSummaryPanel）；它自己决定出不出。 */
  references: ReactNode;
  onOpenSettings?: () => void;
}) {
  return (
    <aside
      aria-label="对话侧栏"
      data-testid="chat-side-rail"
      className="mb-3 mr-3 flex w-72 flex-shrink-0 flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border bg-background"
    >
      {writeBatch && (
        <WriteBatchRailSection
          projectPath={projectPath}
          progress={writeBatch}
          onStop={onStopWriteBatch}
        />
      )}
      {references}
      <ContextPanel
        projectPath={projectPath}
        run={run}
        onOpenSettings={onOpenSettings}
        scrollClassName=""
      />
    </aside>
  );
}
