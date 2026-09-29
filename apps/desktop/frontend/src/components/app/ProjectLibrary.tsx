import { Button, Input, InputShell } from '../ui';

import { useId, useState } from 'react';
import { ChevronRight, BookOpen, FolderOpen, Plus, Search } from '../icons/shell-icons';
import { basename } from './helpers';

type ProjectLibraryProps = {
  projects: string[];
  activeProject: string | null;
  openingProject?: string | null;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSelectProject: (path: string) => void;
  onResumeProject: () => void;
  onOpenSettings: () => void;
};

/** 作品入口不是可关闭的引导页；这里仅投影真实最近目录，不读取或伪造作品统计。 */
export function ProjectLibrary({
  projects,
  activeProject,
  openingProject,
  onNewProject,
  onOpenProject,
  onSelectProject,
  onResumeProject,
  onOpenSettings,
}: ProjectLibraryProps) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const matching = projects.filter((path) =>
    path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto bg-background px-6 py-8 [scrollbar-gutter:stable] sm:px-10 sm:py-12"
      data-testid="project-library"
      aria-label="作品库"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">作品库</h1>
            <p className="mt-2 text-sm text-muted">选择作品，继续写作。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-testid="library-open-project"
              onClick={onOpenProject}
              size="lg"
              variant="ghost"
              className="inline-flex items-center gap-2 text-sm"
            >
              <FolderOpen size={16} aria-hidden="true" />
              打开本地作品
            </Button>
            <Button
              type="button"
              data-testid="library-new-project"
              onClick={onNewProject}
              size="lg"
              variant="primary"
              className="inline-flex items-center gap-2 text-sm font-medium"
            >
              <Plus size={16} aria-hidden="true" />
              新建作品
            </Button>
          </div>
        </header>
        {activeProject && (
          <button
            type="button"
            data-testid="library-resume-project"
            onClick={onResumeProject}
            className="flex w-full items-center gap-4 rounded-lg bg-panel px-5 py-4 text-left transition-colors hover:bg-elevated"
          >
            <BookOpen size={22} className="shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted">当前作品</span>
              <span className="mt-1 block truncate text-sm font-medium text-foreground">
                {basename(activeProject)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-sm text-accent">
              继续写作
              <ChevronRight size={16} aria-hidden="true" />
            </span>
          </button>
        )}
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">
              最近作品
              <span className="ml-2 text-xs font-normal text-subtle">{projects.length}</span>
            </h2>
            {projects.length > 0 && (
              <InputShell className="w-60 max-w-full bg-panel text-muted">
                <label htmlFor={searchId}>
                  <Search size={14} aria-hidden="true" />
                </label>
                <Input
                  id={searchId}
                  type="search"
                  aria-label="搜索作品"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称或位置"
                />
              </InputShell>
            )}
          </div>
          <p
            role="status"
            aria-live="polite"
            className={openingProject ? 'mb-3 text-xs text-muted' : 'sr-only'}
          >
            {openingProject ? `正在打开「${basename(openingProject)}」…` : ''}
          </p>
          {matching.length > 0 ? (
            <ul className="space-y-2">
              {matching.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    data-project-path={path}
                    title={path}
                    onClick={() => {
                      if (openingProject) return;
                      onSelectProject(path);
                    }}
                    disabled={openingProject === path}
                    className="group flex w-full items-center gap-4 rounded-lg bg-panel px-5 py-4 text-left transition-colors hover:bg-elevated disabled:opacity-60"
                  >
                    <BookOpen size={20} aria-hidden="true" className="shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {basename(path)}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">{path}</span>
                    </span>
                    {path === activeProject && (
                      <span className="shrink-0 text-xs text-muted">已打开</span>
                    )}
                    <ChevronRight
                      size={15}
                      aria-hidden="true"
                      className="shrink-0 text-subtle group-hover:text-foreground"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg bg-panel px-6 py-16 text-center">
              <p className="text-sm text-foreground">
                {projects.length ? '没有匹配的作品' : '还没有最近作品'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {projects.length
                  ? '试试其他名称，或打开本地作品。'
                  : '新建一本作品，或打开已有的作品文件夹。'}
              </p>
            </div>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 pt-5 text-xs text-muted">
          <span>作品保存在本地文件夹中</span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-md px-2 py-1 hover:bg-elevated hover:text-foreground"
          >
            设置
          </button>
        </footer>
      </div>
    </section>
  );
}
