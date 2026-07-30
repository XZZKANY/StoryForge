/**
 * 左栏全文搜索视图。搜的是正文内容（命令面板搜的是文件名，两者不重复）。
 * 结果按文件分组，点一条 → 打开该文件并跳到那一行。
 */
import { useEffect, useRef, useState } from 'react';

import { basename } from '../app/helpers';
import type { useProjectSearch } from '../app/useProjectSearch';
import { SEARCH_MIN_QUERY, type SearchHit } from '../../lib/project-search';
import { ChevronDown, ChevronRight, X } from '../icons/shell-icons';

function HitRow({ hit, onSelect }: { hit: SearchHit; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="search-hit"
      className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left text-xs text-muted hover:bg-elevated hover:text-foreground"
      title={`第 ${hit.line} 行`}
    >
      <span className="w-9 flex-shrink-0 text-right text-2xs tabular-nums text-subtle">
        {hit.line}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {hit.text.slice(0, hit.start)}
        <mark className="rounded-xs bg-agent/30 px-0.5 text-foreground">
          {hit.text.slice(hit.start, hit.end)}
        </mark>
        {hit.text.slice(hit.end)}
      </span>
    </button>
  );
}

export function SearchView({
  search,
  projectOpen,
  active,
  onOpenHit,
}: {
  search: ReturnType<typeof useProjectSearch>;
  projectOpen: boolean;
  /** 左栏当前是否正显示搜索视图。三视图 CSS 互斥但都常驻挂载，故不能用 autoFocus：
   *  那会在应用启动时就把焦点从编辑器抢走。只在真正切到搜索视图时落焦。 */
  active: boolean;
  onOpenHit: (path: string, line: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const trimmed = search.query.trim();

  return (
    <div className="flex h-full flex-col bg-background" data-testid="search-panel">
      <div className="sf-panel-header border-border">
        <span className="text-xs font-medium text-muted">搜索</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-subtle">
          <input
            type="checkbox"
            checked={search.caseSensitive}
            onChange={(event) => search.setCaseSensitive(event.target.checked)}
            data-testid="search-case-toggle"
          />
          区分大小写
        </label>
      </div>

      <div className="px-3 py-2">
        <div className="relative">
          <input
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            placeholder="在项目正文中搜索…"
            disabled={!projectOpen}
            data-testid="search-input"
            ref={inputRef}
            className="h-8 w-full rounded-md border border-border bg-surface pl-2.5 pr-7 text-sm text-foreground outline-none placeholder:text-subtle focus:border-border-strong disabled:opacity-50"
          />
          {search.query && (
            <button
              type="button"
              onClick={() => search.setQuery('')}
              title="清空"
              data-testid="search-clear"
              className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-sm text-subtle hover:bg-elevated hover:text-foreground"
            >
              <X size={11} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {!projectOpen ? (
          <p className="px-3 py-4 text-2xs leading-relaxed text-subtle">
            打开项目后可搜索正文内容。
          </p>
        ) : trimmed.length > 0 && trimmed.length < SEARCH_MIN_QUERY ? (
          <p className="px-3 py-4 text-2xs text-subtle">
            再输入 {SEARCH_MIN_QUERY - trimmed.length} 个字符开始搜索。
          </p>
        ) : search.status === 'error' ? (
          <div className="px-3 py-4">
            <p className="text-xs text-error">搜索失败</p>
            <p className="mt-1 text-2xs leading-relaxed text-subtle">{search.error}</p>
            <button
              type="button"
              onClick={search.rerun}
              className="mt-2 h-7 rounded-md border border-border-strong px-2.5 text-xs text-foreground hover:bg-elevated"
            >
              重试
            </button>
          </div>
        ) : trimmed.length < SEARCH_MIN_QUERY ? (
          <p className="px-3 py-4 text-2xs leading-relaxed text-subtle">
            搜索正文内容；文件名请用命令面板（Ctrl P）。
          </p>
        ) : search.results.length === 0 ? (
          <p className="px-3 py-4 text-2xs text-subtle" data-testid="search-empty">
            {search.status === 'searching' ? '搜索中…' : '没有匹配的内容。'}
          </p>
        ) : (
          <>
            <p className="px-3 pb-1 text-2xs text-subtle" data-testid="search-summary">
              {search.totalHits} 处 · {search.results.length} 个文件
              {search.status === 'searching' ? ' · 搜索中…' : ''}
              {search.capped ? ` · 已达上限，仅显示前 ${search.totalHits} 处` : ''}
            </p>
            {search.results.map((file) => {
              const isCollapsed = collapsed.has(file.path);
              return (
                <div key={file.path} className="px-1">
                  <button
                    type="button"
                    onClick={() => toggle(file.path)}
                    className="flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs text-foreground hover:bg-elevated"
                    title={file.path}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={13} strokeWidth={1.7} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={13} strokeWidth={1.7} aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{basename(file.path)}</span>
                    <span className="flex-shrink-0 text-2xs tabular-nums text-subtle">
                      {file.hits.length}
                      {file.truncated ? '+' : ''}
                    </span>
                  </button>
                  {!isCollapsed &&
                    file.hits.map((hit, index) => (
                      <HitRow
                        key={`${hit.line}-${hit.start}-${index}`}
                        hit={hit}
                        onSelect={() => onOpenHit(file.path, hit.line)}
                      />
                    ))}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
