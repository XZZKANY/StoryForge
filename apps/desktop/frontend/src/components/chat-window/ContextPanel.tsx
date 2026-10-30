import { invokedSkillNames } from '@storyforge/project-core';
import { useRef, useState } from 'react';

import { Button, FloatingSurface, IconButton } from '../ui';
import { emitOpenFileRequest } from '../../lib/assistant-events';
import { FileText, Layers, Search } from '../icons/shell-icons';
import { runContextReads, skillsUsedThisRun } from './context-panel';
import { PluginsBlock } from './PluginsBlock';
import type { AgentRun } from './types';
import { useAgentInstructions } from './useAgentInstructions';
import {
  SKILL_TEMPLATES,
  useConversationSkills,
  type SkillTemplate,
} from './useConversationSkills';

export const CONTEXT_PANEL_ID = 'conversation-context-panel';

/** 对话头「上下文」按钮：点开是按钮右下方的小浮窗，盖在对话上、不挤消息；点外面或 Esc 收起。 */
export function ContextPanelToggle({
  projectPath,
  run,
  onOpenSettings,
}: {
  projectPath: string | null;
  run: AgentRun | null;
  onOpenSettings?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        data-testid="conversation-context-toggle"
        size="xs"
        className={open ? 'relative bg-elevated' : 'relative'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? CONTEXT_PANEL_ID : undefined}
        label={open ? '收起上下文' : '上下文'}
        tooltip={open ? '收起上下文' : '上下文：长期规矩、技能、这一轮读了什么'}
        icon={
          <Layers size={14} strokeWidth={1.6} className={open ? 'text-foreground' : undefined} />
        }
      />
      {open && (
        <FloatingSurface
          id={CONTEXT_PANEL_ID}
          aria-label="上下文"
          triggerRef={triggerRef}
          align="end"
          onDismiss={() => setOpen(false)}
          className="w-[22rem] animate-fade-in rounded-lg border border-border bg-surface shadow-dropdown"
        >
          <ContextPanel
            projectPath={projectPath}
            run={run}
            onOpenSettings={
              onOpenSettings &&
              (() => {
                setOpen(false);
                onOpenSettings();
              })
            }
          />
        </FloatingSurface>
      )}
    </>
  );
}

function BlockTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-medium text-foreground">{title}</h3>
      {hint && (
        <p className="truncate text-2xs text-subtle" title={hint}>
          {hint}
        </p>
      )}
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
    <div className="space-y-1.5 px-3 py-2.5" data-testid="context-instructions">
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

function NewSkillButton({
  creating,
  onCreate,
}: {
  creating: boolean;
  onCreate: (skill: SkillTemplate) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={triggerRef}
        size="compact"
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        loading={creating}
        data-testid="context-skills-create"
      >
        新建
      </Button>
      {open && (
        <FloatingSurface
          role="menu"
          aria-label="按模板新建技能"
          triggerRef={triggerRef}
          align="end"
          onDismiss={() => setOpen(false)}
          className="w-64 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown"
          data-testid="context-skills-templates"
        >
          {SKILL_TEMPLATES.map((skill) => (
            <button
              key={skill.name}
              role="menuitem"
              type="button"
              className="flex w-full flex-col items-start rounded-sm px-2.5 py-1.5 text-left hover:bg-elevated"
              onClick={() => {
                setOpen(false);
                onCreate(skill);
              }}
              data-testid="context-skill-template"
            >
              <span className="text-xs text-foreground">{skill.name}</span>
              <span className="w-full truncate text-2xs text-subtle">{skill.when}</span>
            </button>
          ))}
        </FloatingSurface>
      )}
    </>
  );
}

const SKILL_TAG_CLASS =
  'flex-shrink-0 rounded-sm border border-border px-1.5 py-px text-3xs leading-4 text-muted';

function SkillsBlock({ projectPath, run }: { projectPath: string | null; run: AgentRun | null }) {
  const { view, creating, create } = useConversationSkills(projectPath);
  const used = skillsUsedThisRun(
    run?.steps ?? null,
    projectPath,
    view.status === 'ready' ? view.skills : [],
  );
  const invoked = new Set(
    run && view.status === 'ready'
      ? invokedSkillNames(
          run.goal,
          view.skills.map((skill) => skill.name),
        )
      : [],
  );
  const newButton = <NewSkillButton creating={creating} onCreate={(skill) => void create(skill)} />;
  return (
    <div className="space-y-1.5 px-3 py-2.5" data-testid="context-skills">
      <BlockTitle title="技能" hint="技能/ · 每轮带目录，用得上才读全文；消息开头打 / 点名" />
      {view.status === 'idle' && <p className="text-xs text-muted">还没打开作品。</p>}
      {view.status === 'loading' && (
        <p className="text-xs text-muted" role="status">
          正在读取…
        </p>
      )}
      {view.status === 'error' && (
        <p className="text-xs text-warning" role="alert">
          读不到技能：{view.message}
        </p>
      )}
      {view.status === 'ready' && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-muted" data-testid="context-skills-state">
            {view.skills.length
              ? `共 ${view.skills.length} 份`
              : '还没有。把这本书的流程、口径写成技能，AI 用得上时会照做。'}
          </p>
          {newButton}
        </div>
      )}
      {view.status === 'ready' && view.skills.length > 0 && (
        <ul className="space-y-0.5">
          {view.skills.map((skill) => {
            const row = (
              <>
                <FileText size={12} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
                <span className="flex-shrink-0 text-foreground">{skill.name}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-subtle">{skill.when}</span>
                {skill.plugin !== null && (
                  <span className={SKILL_TAG_CLASS} data-testid="context-skill-plugin">
                    插件 {skill.plugin}
                  </span>
                )}
                {invoked.has(skill.name) ? (
                  <span className={SKILL_TAG_CLASS} data-testid="context-skill-invoked">
                    这一轮点名
                  </span>
                ) : (
                  used.has(skill.name) && (
                    <span className={SKILL_TAG_CLASS} data-testid="context-skill-used">
                      这一轮用了
                    </span>
                  )
                )}
              </>
            );
            return (
              <li key={`${skill.plugin ?? ''}:${skill.path}`}>
                {skill.filePath === null ? (
                  <div
                    className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs"
                    title={`插件「${skill.plugin}」：${skill.path}`}
                    data-testid="context-skill"
                  >
                    {row}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-elevated"
                    onClick={() => emitOpenFileRequest(skill.filePath!)}
                    title={`在编辑器打开 ${skill.path}`}
                    data-testid="context-skill"
                  >
                    {row}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RunReadsBlock({ projectPath, run }: { projectPath: string | null; run: AgentRun | null }) {
  const reads = run ? runContextReads(run.steps, projectPath) : null;
  const empty = !reads || (!reads.files.length && !reads.lookups.length);
  return (
    <div className="space-y-1.5 px-3 py-2.5" data-testid="context-run-reads">
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

/** 「上下文」浮窗里的内容：作者能看到 AI 每轮带着什么、有哪些技能、这一轮读了什么。 */
export function ContextPanel({
  projectPath,
  run,
  onOpenSettings,
}: {
  projectPath: string | null;
  run: AgentRun | null;
  onOpenSettings?: () => void;
}) {
  return (
    <div
      className="max-h-[min(70vh,36rem)] divide-y divide-border overflow-y-auto"
      data-testid="context-panel"
    >
      <InstructionsBlock projectPath={projectPath} />
      <SkillsBlock projectPath={projectPath} run={run} />
      <PluginsBlock
        projectPath={projectPath}
        title={<BlockTitle title="插件" hint="本机插件库 · 勾选这本书要用的" />}
        onOpenSettings={onOpenSettings}
      />
      <RunReadsBlock projectPath={projectPath} run={run} />
    </div>
  );
}
