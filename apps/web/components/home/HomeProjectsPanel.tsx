'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { createHomeProjectAction } from './home-project-actions';
import type { HomeProjectListState } from './home-projects-api';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';

type SortMode = 'activity' | 'name';

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function HomeProjectsPanel({
  projectListState,
}: {
  readonly projectListState: HomeProjectListState;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const projects = useMemo(
    () => (projectListState.status === 'ready' ? projectListState.projects : []),
    [projectListState],
  );

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const nextProjects = query
      ? projects.filter((project) =>
          `${project.title} ${project.description}`.toLowerCase().includes(query),
        )
      : [...projects];
    return nextProjects.sort((left, right) =>
      sortMode === 'name'
        ? left.title.localeCompare(right.title, 'zh-CN')
        : right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [projects, searchQuery, sortMode]);

  function toggleSortMode() {
    setSortMode((current) => (current === 'activity' ? 'name' : 'activity'));
  }

  return (
    <section
      aria-labelledby="current-project-title"
      className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
    >
      <div className="w-full max-w-[770px] pt-[clamp(30px,7vh,58px)]">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <h1
            id="current-project-title"
            className="m-0 font-serif text-[28px] font-semibold leading-none"
          >
            Projects
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Sort by</span>
            <button
              type="button"
              onClick={toggleSortMode}
              className="rounded-lg border-0 bg-panel px-3 py-2 font-semibold text-foreground hover:bg-muted/20"
            >
              {sortMode === 'activity' ? 'Activity' : 'Name'}
            </button>
            <form action={createHomeProjectAction} className="flex items-center gap-2">
              <input
                type="text"
                name="title"
                aria-label="项目名称"
                placeholder="项目名称"
                className="h-9 w-28 rounded-lg border-0 bg-panel px-3 text-foreground outline-none placeholder:text-muted focus:ring-1 focus:ring-border"
              />
              <input
                type="hidden"
                name="description"
                value="从 StoryForge 首页创建的真实工作区。"
              />
              <button
                type="submit"
                className="rounded-lg border-0 bg-foreground px-4 py-2 font-semibold text-background hover:opacity-90"
              >
                New project
              </button>
            </form>
          </div>
        </div>

        <label className="sr-only" htmlFor="home-project-search">
          Search projects
        </label>
        <input
          id="home-project-search"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search projects..."
          className="mt-6 h-10 w-full rounded-lg border-0 bg-panel px-4 text-foreground outline-none placeholder:text-muted focus:ring-1 focus:ring-border"
        />

        {projectListState.status === 'pending' || projectListState.status === 'loading' ? (
          <div className="mt-7 grid grid-cols-1 gap-6 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="min-h-[120px] rounded-lg border border-border bg-panel px-4 py-4"
              >
                <LoadingSkeleton lines={1} className="w-1/2 opacity-70" />
                <LoadingSkeleton lines={2} className="mt-4 opacity-50" />
                <LoadingSkeleton lines={1} className="mt-5 w-1/3 opacity-30" />
              </div>
            ))}
          </div>
        ) : projectListState.status === 'error' ? (
          <div className="mt-7 flex flex-col items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-10 text-center">
            <span aria-hidden="true" className="mb-3 text-3xl">
              ⚠️
            </span>
            <h3 className="m-0 text-base font-semibold text-foreground">Failed to load projects</h3>
            <p className="mt-2 text-sm text-red-500">
              {projectListState.message || 'An unexpected error occurred while fetching projects.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-lg bg-red-500/20 px-4 py-2 text-sm font-semibold text-foreground hover:bg-red-500/30"
            >
              Try Again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex min-h-[330px] flex-col items-center justify-center text-center">
            <div aria-hidden="true" className="relative h-20 w-20 text-foreground">
              <span className="absolute left-4 top-2 h-10 w-10 rotate-[-1deg] rounded-sm border-2 border-current" />
              <span className="absolute left-3 top-3 h-5 w-5 border-b-2 border-r-2 border-current" />
              <span className="absolute left-7 top-7 h-5 w-5 border-b-2 border-r-2 border-current" />
              <span className="absolute bottom-2 right-3 h-9 w-8 rounded-b-2xl rounded-t-md border-2 border-current" />
              <span className="absolute bottom-6 right-1 h-9 w-6 rounded-full border-r-2 border-t-2 border-current" />
            </div>
            <h2 className="m-0 mt-5 text-sm font-semibold text-foreground">
              Looking to start a project?
            </h2>
            <p className="m-0 mt-4 max-w-[360px] text-sm leading-5 text-muted">
              Upload materials, set custom instructions, and organize conversations in one space.
            </p>
            <form action={createHomeProjectAction} className="mt-4 flex items-center gap-2">
              <input
                type="text"
                name="title"
                aria-label="空状态项目名称"
                placeholder="项目名称"
                className="h-9 w-32 rounded-lg border-0 bg-panel px-3 text-foreground outline-none placeholder:text-muted focus:ring-1 focus:ring-border"
              />
              <input
                type="hidden"
                name="description"
                value="从 StoryForge 首页创建的真实工作区。"
              />
              <button
                type="submit"
                className="rounded-lg border-0 bg-panel px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/20"
              >
                New project
              </button>
            </form>
          </div>
        ) : filteredProjects.length === 0 ? (
          <p className="mt-7 border border-border px-4 py-5 text-muted">没有匹配的真实项目。</p>
        ) : (
          <div className="mt-7 grid grid-cols-1 gap-6 md:grid-cols-2">
            {filteredProjects.map((project) => (
              <Link
                key={project.id}
                href={project.href}
                className="min-h-[120px] rounded-lg border border-border bg-transparent px-4 py-4 text-left no-underline hover:border-foreground/50 hover:bg-muted/10"
              >
                <strong className="block text-base text-foreground">{project.title}</strong>
                <span className="mt-4 block text-sm text-muted">{project.description}</span>
                <span className="mt-5 block text-sm text-muted/70">
                  更新于 {formatUpdatedAt(project.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
