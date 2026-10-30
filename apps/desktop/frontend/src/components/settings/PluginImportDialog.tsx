import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Button, DialogSurface } from '../ui';
import { ChevronDown, ChevronRight } from '../icons/shell-icons';
import type { PluginDescription, PluginEntry, PluginManifest } from '../../lib/api/plugins';
import type { SkippedPluginFile } from '../../lib/plugin-library';
import { pluginInstallBlocker, type PluginImportPreview } from './usePlugins';

/** 「v版本 · 作者」，跟在插件名后面；没有清单时为空。 */
export function pluginMeta(manifest: PluginManifest | null): string {
  if (!manifest) return '';
  return [`v${manifest.version}`, manifest.author].filter(Boolean).join(' · ');
}

function entryDiff(before: readonly PluginEntry[], after: readonly PluginEntry[]): string {
  const old = new Map(before.map((entry) => [entry.name, entry.sha256]));
  const next = new Map(after.map((entry) => [entry.name, entry.sha256]));
  const added = [...next.keys()].filter((name) => !old.has(name)).length;
  const removed = [...old.keys()].filter((name) => !next.has(name)).length;
  const changed = [...next].filter(([name, sha]) => old.has(name) && old.get(name) !== sha).length;
  return `新增 ${added}、去掉 ${removed}、改动 ${changed}`;
}

/** 同名插件已装时，安装会替换掉的内容：技能 / 写法按名字对齐、按 sha256 比改动。 */
export function replacementSummary(installed: PluginDescription, incoming: PluginDescription) {
  const version = installed.manifest ? ` v${installed.manifest.version}` : '';
  const instructions =
    (installed.instructions?.sha256 ?? null) === (incoming.instructions?.sha256 ?? null)
      ? '不变'
      : '改动';
  return `已装同名插件${version}，安装后会替换它（旧的进回收夹）：技能 ${entryDiff(installed.skills, incoming.skills)}；写法 ${entryDiff(installed.styles, incoming.styles)}；指令 ${instructions}`;
}

function Group({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-1" data-testid={testId}>
      <h3 className="text-xs font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function EntryRow({ label, hint, body }: { label: string; hint: string | null; body: string }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-elevated"
        data-testid="plugin-entry"
      >
        <Chevron
          size={12}
          strokeWidth={1.7}
          className="flex-shrink-0 text-subtle"
          aria-hidden="true"
        />
        <span className="flex-shrink-0 text-foreground">{label}</span>
        {hint && <span className="min-w-0 truncate text-subtle">— {hint}</span>}
      </button>
      {open && (
        <div
          className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border px-2.5 py-1.5 text-xs text-muted"
          data-testid="plugin-entry-body"
        >
          {body}
        </div>
      )}
    </li>
  );
}

function EntryList({ entries }: { entries: readonly PluginEntry[] }) {
  if (!entries.length) return null;
  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <EntryRow key={entry.path} label={entry.name} hint={entry.when || null} body={entry.body} />
      ))}
    </ul>
  );
}

/** 插件里有什么：技能、写法、指令片段三组，每项点开看全文。设置页卡片「查看」与导入预览共用。 */
export function PluginContents({ description }: { description: PluginDescription }) {
  const { instructions } = description;
  return (
    <div className="space-y-3">
      <Group title={`技能（${description.skills.length}）`} testId="plugin-skills">
        <EntryList entries={description.skills} />
      </Group>
      <Group title={`写法（${description.styles.length}）`} testId="plugin-styles">
        <EntryList entries={description.styles} />
      </Group>
      <Group title={`指令片段（${instructions ? '有' : '无'}）`} testId="plugin-instructions">
        {instructions && (
          <ul>
            <EntryRow
              label={instructions.path}
              hint={instructions.truncated ? '超过 4000 字的部分不会用' : null}
              body={instructions.text}
            />
          </ul>
        )}
      </Group>
    </div>
  );
}

export function PluginProblems({ problems }: { problems: readonly string[] }) {
  if (!problems.length) return null;
  return (
    <section className="space-y-1" data-testid="plugin-problems">
      <h3 className="text-xs font-medium text-warning">问题（{problems.length}）</h3>
      <ul className="space-y-0.5">
        {problems.map((problem, index) => (
          <li key={index} className="break-words text-xs text-warning">
            {problem}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SkippedFiles({ skipped }: { skipped: readonly SkippedPluginFile[] }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  if (!skipped.length) return null;
  return (
    <section className="space-y-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-sm text-xs font-medium text-foreground hover:text-foreground"
        data-testid="plugin-import-skipped-toggle"
      >
        <Chevron size={12} strokeWidth={1.7} className="text-subtle" aria-hidden="true" />
        跳过的文件（{skipped.length}）
      </button>
      {open && (
        <ul className="space-y-0.5 pl-4" data-testid="plugin-import-skipped">
          {skipped.map((file) => (
            <li key={file.path} className="break-all text-xs text-muted">
              {file.path} — {file.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 从文件夹导入的预览：看清里面有什么、会替换什么，再决定装不装。 */
export function PluginImportDialog({
  preview,
  installed,
  installing,
  onCancel,
  onInstall,
}: {
  preview: PluginImportPreview;
  installed: readonly PluginDescription[];
  installing: boolean;
  onCancel: () => void;
  onInstall: () => void;
}) {
  const headingId = useId();
  const installRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { description, staged } = preview;
  const { manifest } = description;
  const blocker = pluginInstallBlocker(description);
  // 宿主按清单里的名字装进同名文件夹；Windows 上文件夹名不分大小写。
  const replaced = manifest
    ? (installed.find((plugin) => plugin.id.toLowerCase() === manifest.name.toLowerCase()) ?? null)
    : null;
  const title = manifest ? manifest.displayName || manifest.name : '未命名插件';
  const meta = pluginMeta(manifest);
  const close = () => {
    if (!installing) onCancel();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 animate-fade-in"
      role="presentation"
      data-modal-backdrop=""
    >
      <DialogSurface
        onClose={close}
        initialFocusRef={blocker ? cancelRef : installRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-busy={installing}
        data-testid="plugin-import-dialog"
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-border bg-panel p-6 shadow-dialog animate-slide-up-fade"
      >
        <h2 id={headingId} className="text-lg font-semibold text-foreground">
          导入插件
        </h2>
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
          <header className="space-y-1" data-testid="plugin-import-head">
            <p className="break-words text-sm">
              <span className="font-medium text-foreground">{title}</span>
              {meta && <span className="text-xs text-muted"> · {meta}</span>}
            </p>
            {manifest?.description && (
              <p className="break-words text-xs leading-5 text-muted">{manifest.description}</p>
            )}
            {manifest?.format === 'codex' && (
              <p className="text-2xs text-subtle" data-testid="plugin-import-codex">
                Codex 插件：只用其中的技能
              </p>
            )}
          </header>
          <PluginContents description={description} />
          <SkippedFiles skipped={staged.skipped} />
          <PluginProblems problems={description.problems} />
          {replaced && (
            <p
              className="rounded-md bg-background px-3 py-2 text-xs leading-5 text-muted"
              data-testid="plugin-import-replace"
            >
              {replacementSummary(replaced, description)}
            </p>
          )}
        </div>
        {blocker && (
          <p className="mt-4 text-xs text-warning" data-testid="plugin-import-blocker">
            {blocker}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <Button
            ref={cancelRef}
            size="md"
            variant="secondary"
            className="text-sm"
            disabled={installing}
            onClick={close}
            data-testid="plugin-import-cancel"
          >
            取消
          </Button>
          <Button
            ref={installRef}
            size="md"
            variant="primary"
            className="text-sm font-medium"
            disabled={blocker !== null}
            loading={installing}
            onClick={onInstall}
            data-testid="plugin-import-install"
          >
            {installing ? '安装中…' : '安装'}
          </Button>
        </div>
      </DialogSurface>
    </div>,
    document.body,
  );
}
