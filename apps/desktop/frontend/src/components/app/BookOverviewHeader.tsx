/**
 * 作品总览的标题行：书名和去处在同一行。进写作台、编辑作品资料原先是标题上方单独一行的
 * 小字链接（作者 10-16：「进写作台的入口是右上角一行小字」），现在做成按钮跟书名并排；
 * 窗口窄时整组按钮换到书名下面一行，不挤书名。
 */
import { ChevronRight, Library, Pencil, RefreshCw } from '../icons/shell-icons';
import { Button, IconButton, Spinner } from '../ui';

export function BookOverviewHeader({
  title,
  refreshing,
  onRefresh,
  onEditProfile,
  onEnterWritingDesk,
}: {
  title: string;
  refreshing: boolean;
  onRefresh?: () => void;
  onEditProfile?: () => void;
  onEnterWritingDesk?: () => void;
}) {
  return (
    <header
      className="flex flex-wrap items-center gap-x-3 gap-y-2 animate-fade-in-up"
      data-testid="book-overview-header"
    >
      <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-elevated">
          <Library size={20} strokeWidth={1.6} className="text-muted" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xs uppercase tracking-[0.18em] text-subtle">作品总览</p>
          <h1 className="truncate text-xl font-semibold text-foreground md:text-2xl" title={title}>
            {title || '未命名作品'}
          </h1>
        </div>
      </div>
      <div
        className="ml-auto flex flex-shrink-0 items-center gap-1.5"
        data-testid="book-overview-actions"
      >
        {onRefresh ? (
          <IconButton
            size="md"
            label="重新读取作品资料"
            icon={<Spinner icon={RefreshCw} spinning={refreshing} size={15} />}
            onClick={onRefresh}
            disabled={refreshing}
            data-testid="book-overview-refresh"
          />
        ) : null}
        {onEditProfile ? (
          <Button
            size="md"
            variant="ghost"
            leadingIcon={<Pencil size={14} strokeWidth={1.7} />}
            onClick={onEditProfile}
            data-testid="edit-book-profile"
          >
            编辑作品资料
          </Button>
        ) : null}
        {onEnterWritingDesk ? (
          <Button
            size="md"
            variant="secondary"
            trailingIcon={<ChevronRight size={14} strokeWidth={1.7} />}
            onClick={onEnterWritingDesk}
            data-testid="open-writing-workspace"
          >
            写作工作台
          </Button>
        ) : null}
      </div>
    </header>
  );
}
