import type { BookProfileHandle } from '../app/useBookProfile';
import type { OutlineEntry } from '../../lib/outline-index';
import { PlainButton } from '../ui';

export type OutlineGroup = { relativePath: string; path: string; items: OutlineEntry[] };

// 作品视图「大纲」分区的内容：按文件分组列出大纲标题，点一条跳过去。
export function BookOutlineBody({
  handle,
  outlineGroups,
  onOpenOutline,
}: {
  handle: BookProfileHandle;
  outlineGroups: OutlineGroup[];
  onOpenOutline: (path: string, line: number) => void;
}) {
  return handle.outlineLoading ? (
    <p className="px-3 py-3 text-2xs text-subtle" role="status">
      正在读取大纲…
    </p>
  ) : handle.outlineError ? (
    <p className="px-3 py-3 text-2xs text-error" role="alert">
      大纲读取失败：{handle.outlineError}。请点击顶部刷新重试。
    </p>
  ) : outlineGroups.length === 0 ? (
    <p className="px-3 text-3xs leading-relaxed text-subtle">
      「大纲」目录下还没有带标题的文档。写下 `## 第三幕` 一类的标题，这里就能一键跳过去。
    </p>
  ) : (
    <div data-testid="book-outline-list">
      {outlineGroups.map((group) => (
        <div key={group.relativePath} className="pb-1">
          <PlainButton
            className="flex h-6 w-full items-center px-3 text-left text-3xs text-subtle hover:text-foreground"
            onClick={() => onOpenOutline(group.path, 0)}
            title={group.relativePath}
          >
            <span className="min-w-0 truncate">{group.relativePath}</span>
          </PlainButton>
          <ul>
            {group.items.map((item) => (
              <li key={`${item.relativePath}:${item.line}`}>
                <PlainButton
                  className="flex h-6 w-full items-center text-left text-2xs text-muted hover:bg-elevated hover:text-foreground"
                  style={{ paddingLeft: `${12 + (item.level - 1) * 10}px` }}
                  onClick={() => onOpenOutline(item.path, item.line)}
                  title={`${item.relativePath} · 第 ${item.line + 1} 行`}
                  data-testid="book-outline-row"
                >
                  <span className="min-w-0 truncate pr-2">{item.text}</span>
                </PlainButton>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {handle.outlineDropped > 0 && (
        <p className="px-3 pt-1 text-3xs leading-relaxed text-subtle">
          另有 <span className="text-foreground">{handle.outlineDropped}</span> 条标题没列出来。
        </p>
      )}
    </div>
  );
}
