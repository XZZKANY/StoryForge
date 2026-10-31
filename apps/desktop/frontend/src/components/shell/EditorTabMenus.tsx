/** 编辑器页签行右端的两个菜单：润色当前章、「…」文件操作。 */
import { useRef, useState } from 'react';

import { listLlmProfiles } from '../../lib/desktop-llm-config';
import { MoreHorizontal, Sparkles } from '../icons/shell-icons';
import { FloatingSurface, IconButton, PlainButton } from '../ui';

export function PolishActionsMenu({
  onPolishActive,
}: {
  onPolishActive: (useMainModel: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 设置「高级」里指定了专用润色那套才有两个选项可选；没指定（默认跟随当前模型）时两项一样，只给一项。
  const [dedicated, setDedicated] = useState<string | null>(null);
  const run = (useMainModel: boolean) => {
    setOpen(false);
    onPolishActive(useMainModel);
  };
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    void listLlmProfiles()
      .then(
        (result) =>
          result?.profiles.find((profile) => profile.id === result.polishProfileId)?.name ?? null,
        () => null,
      )
      .then((name) => {
        setDedicated(name);
        setOpen(true);
      });
  };
  return (
    <div className="relative flex items-center">
      <IconButton
        ref={triggerRef}
        size="xs"
        label="润色当前章"
        icon={<Sparkles size={15} strokeWidth={1.7} />}
        data-testid="editor-polish-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      />
      {open && (
        <>
          <FloatingSurface
            role="menu"
            aria-label="操作"
            triggerRef={triggerRef}
            onDismiss={() => setOpen(false)}
            className="w-52 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown"
            data-testid="editor-polish-menu"
          >
            {dedicated ? (
              <>
                <MenuRow label={`用「${dedicated}」润色`} onClick={() => run(false)} />
                <MenuRow label="本次用当前模型" onClick={() => run(true)} />
              </>
            ) : (
              <MenuRow label="润色当前章" onClick={() => run(false)} />
            )}
          </FloatingSurface>
        </>
      )}
    </div>
  );
}

function MenuRow({ label, kbd, onClick }: { label: string; kbd?: string; onClick?: () => void }) {
  return (
    <PlainButton
      role="menuitem"
      className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs text-muted hover:bg-elevated hover:text-foreground"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {kbd && <span className="flex-shrink-0 font-mono text-3xs text-subtle">{kbd}</span>}
    </PlainButton>
  );
}

export function EditorActionsMenu({
  onSaveActive,
  onToggleHistory,
  onExportActive,
  onCloseActive,
  onCloseOthers,
  onCloseAll,
}: {
  onSaveActive?: () => void;
  onToggleHistory?: () => void;
  onExportActive?: () => void;
  /** P2-C：暴露 Ctrl+W 的菜单入口（此前仅页签行内 keydown 接管，无可发现 UI）。 */
  onCloseActive?: () => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const run = (handler?: () => void) => () => {
    setOpen(false);
    handler?.();
  };
  return (
    <div className="relative flex items-center">
      <IconButton
        ref={triggerRef}
        size="xs"
        label="文件操作：保存/历史/导出…"
        icon={<MoreHorizontal size={16} strokeWidth={1.7} />}
        data-testid="editor-more-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <>
          <FloatingSurface
            role="menu"
            aria-label="操作"
            triggerRef={triggerRef}
            onDismiss={() => setOpen(false)}
            className="w-56 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown"
            data-testid="editor-more-menu"
          >
            <MenuRow label="保存" kbd="Ctrl S" onClick={run(onSaveActive)} />
            <MenuRow label="版本历史" kbd="Ctrl Shift H" onClick={run(onToggleHistory)} />
            <div className="mx-1.5 my-1 h-px bg-border" />
            <MenuRow label="导出当前稿" onClick={run(onExportActive)} />
            <div className="mx-1.5 my-1 h-px bg-border" />
            <MenuRow label="关闭当前页签" kbd="Ctrl W" onClick={run(onCloseActive)} />
            <MenuRow label="关闭其他页签" onClick={run(onCloseOthers)} />
            <MenuRow label="关闭全部页签" onClick={run(onCloseAll)} />
          </FloatingSurface>
        </>
      )}
    </div>
  );
}
