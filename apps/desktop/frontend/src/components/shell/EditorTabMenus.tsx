/** 编辑器页签行右端的两个菜单：润色当前章、「…」文件操作。 */
import { useRef, useState } from 'react';

import { listLlmProfiles } from '../../lib/desktop-llm-config';
import { MoreHorizontal, Sparkles } from '../icons/shell-icons';
import { IconButton, MenuItem, MenuSeparator, MenuSurface } from '../ui';

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
          <MenuSurface
            aria-label="操作"
            triggerRef={triggerRef}
            onDismiss={() => setOpen(false)}
            className="w-52"
            data-testid="editor-polish-menu"
          >
            {dedicated ? (
              <>
                <MenuItem onClick={() => run(false)}>用「{dedicated}」润色</MenuItem>
                <MenuItem onClick={() => run(true)}>本次用当前模型</MenuItem>
              </>
            ) : (
              <MenuItem onClick={() => run(false)}>润色当前章</MenuItem>
            )}
          </MenuSurface>
        </>
      )}
    </div>
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
          <MenuSurface
            aria-label="操作"
            triggerRef={triggerRef}
            onDismiss={() => setOpen(false)}
            className="w-56"
            data-testid="editor-more-menu"
          >
            <MenuItem shortcut="Ctrl S" onClick={run(onSaveActive)}>
              保存
            </MenuItem>
            <MenuItem shortcut="Ctrl Shift H" onClick={run(onToggleHistory)}>
              版本历史
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={run(onExportActive)}>导出当前稿</MenuItem>
            <MenuSeparator />
            <MenuItem shortcut="Ctrl W" onClick={run(onCloseActive)}>
              关闭当前页签
            </MenuItem>
            <MenuItem onClick={run(onCloseOthers)}>关闭其他页签</MenuItem>
            <MenuItem onClick={run(onCloseAll)}>关闭全部页签</MenuItem>
          </MenuSurface>
        </>
      )}
    </div>
  );
}
