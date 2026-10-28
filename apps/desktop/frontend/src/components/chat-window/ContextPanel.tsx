import { Button, IconButton } from '../ui';
import { emitOpenFileRequest } from '../../lib/assistant-events';
import { FileText, Layers, Search } from '../icons/shell-icons';
import { CHAT_COLUMN } from './column';
import { runContextReads } from './context-panel';
import type { AgentRun } from './types';
import { useAgentInstructions } from './useAgentInstructions';

export const CONTEXT_PANEL_ID = 'conversation-context-panel';

export function ContextPanelToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton
      type="button"
      onClick={onToggle}
      data-testid="conversation-context-toggle"
      size="xs"
      className={open ? 'relative bg-elevated' : 'relative'}
      aria-expanded={open}
      aria-controls={CONTEXT_PANEL_ID}
      label={open ? '收起上下文' : '上下文'}
      tooltip={open ? '收起上下文' : '上下文：长期规矩、这一轮读了什么'}
      icon={<Layers size={14} strokeWidth={1.6} className={open ? 'text-foreground' : undefined} />}
    />
  );
}

function BlockTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-xs font-medium text-foreground">{title}</h3>
      {hint && <span className="min-w-0 truncate text-2xs text-subtle">{hint}</span>}
    </div>
  );
}

function InstructionsBlock({ projectPath }: { projectPath: string | null }) {
  const { view, creating, create } = useAgentInstructions(projectPath);
  const openButton = (filePath: string) => (
    <Button
      size="compact"
      variant="ghost"
      onClick={() => emitOpenFileRequest(filePath)}
      data-testid="context-instructions-open"
    >
      打开编辑
    </Button>
  );
  return (
    <div className="space-y-1.5" data-testid="context-instructions">
      <BlockTitle
        title="长期规矩"
        hint=".storyforge/agent-instructions.md · 每轮对话和起草都带上"
      />
      {view.status === 'idle' && <p className="text-xs text-muted">还没打开作品。</p>}
      {view.status === 'loading' && (
        <p className="text-xs text-muted" role="status">
          正在读取…
        </p>
      )}
      {view.status === 'error' && (
        <p className="text-xs text-warning" role="alert">
          读不到长期规矩：{view.message}
        </p>
      )}
      {view.status === 'missing' && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-muted" data-testid="context-instructions-state">
            还没有。写在这里的要求，AI 每轮都会照着做。
          </p>
          <Button
            size="compact"
            variant="secondary"
            onClick={() => void create()}
            loading={creating}
            data-testid="context-instructions-create"
          >
            新建
          </Button>
        </div>
      )}
      {view.status === 'unused' && (
        <div className="flex items-center gap-2">
          <p
            className="min-w-0 flex-1 text-xs text-warning"
            data-testid="context-instructions-state"
          >
            文件在，但这一份没带上：可能是空的、太大或读不了。
          </p>
          {openButton(view.filePath)}
        </div>
      )}
      {view.status === 'active' && (
        <>
          <div className="flex items-center gap-2">
            <p
              className="min-w-0 flex-1 text-xs text-muted"
              data-testid="context-instructions-state"
            >
              {view.truncated
                ? `超长，只带最后 ${view.limit} 字（新要求写在末尾）`
                : `${view.chars} 字，每轮都带着`}
            </p>
            {openButton(view.filePath)}
          </div>
          <div
            className="space-y-0.5 rounded-md bg-elevated px-2.5 py-1.5 text-xs text-muted"
            data-testid="context-instructions-preview"
          >
            {view.preview.map((line, index) => (
              <p key={index} className="truncate">
                {line}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RunReadsBlock({ projectPath, run }: { projectPath: string | null; run: AgentRun | null }) {
  const reads = run ? runContextReads(run.steps, projectPath) : null;
  const empty = !reads || (!reads.files.length && !reads.lookups.length);
  return (
    <div className="space-y-1.5" data-testid="context-run-reads">
      <BlockTitle title="这一轮读了" />
      {empty && (
        <p className="text-xs text-muted" data-testid="context-run-reads-empty">
          {run ? '这一轮还没读文件。' : '还没开始对话。发一条消息后，这里列出 AI 读过的文件。'}
        </p>
      )}
      {reads && reads.files.length > 0 && (
        <ul className="space-y-0.5">
          {reads.files.map((file) => (
            <li key={file.path}>
              {file.filePath ? (
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-foreground transition-colors hover:bg-elevated"
                  onClick={() => emitOpenFileRequest(file.filePath!)}
                  title="在编辑器打开"
                  data-testid="context-read-file"
                >
                  <FileText size={12} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
                  <span className="min-w-0 truncate">{file.path}</span>
                </button>
              ) : (
                <span
                  className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted"
                  data-testid="context-read-file-outside"
                >
                  <FileText size={12} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
                  <span className="min-w-0 truncate">{file.path}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {reads && reads.lookups.length > 0 && (
        <ul className="space-y-0.5" data-testid="context-run-lookups">
          {reads.lookups.map((lookup) => (
            <li
              key={`${lookup.kind}:${lookup.text}`}
              className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted"
            >
              <Search size={12} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
              <span className="min-w-0 truncate">
                {lookup.kind === 'search'
                  ? `搜过『${lookup.text}』`
                  : `看过目录${lookup.text ? ` ${lookup.text}` : '（作品根目录）'}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 对话头「上下文」展开的一块：作者能看到 AI 每轮带着什么、这一轮读了什么。 */
export function ContextPanel({
  projectPath,
  run,
}: {
  projectPath: string | null;
  run: AgentRun | null;
}) {
  return (
    <section
      id={CONTEXT_PANEL_ID}
      aria-label="上下文"
      className="max-h-[40%] flex-shrink-0 overflow-y-auto border-b border-border px-5 py-3"
      data-testid="context-panel"
    >
      <div className={`${CHAT_COLUMN} space-y-3`}>
        <InstructionsBlock projectPath={projectPath} />
        <RunReadsBlock projectPath={projectPath} run={run} />
      </div>
    </section>
  );
}
