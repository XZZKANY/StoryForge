'use client';

import { useMemo, useState } from 'react';

const localProjectsStorageKey = 'storyforge-home-projects';

type HomeProject = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly updatedAt: string;
};

type SortMode = 'activity' | 'name';

function readLocalProjects(): readonly HomeProject[] {
  try {
    const raw = window.localStorage.getItem(localProjectsStorageKey);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is HomeProject => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Record<string, unknown>;
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.title === 'string' &&
          typeof candidate.description === 'string' &&
          typeof candidate.updatedAt === 'string'
        );
      })
      .map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        updatedAt: item.updatedAt,
      }));
  } catch {
    return [];
  }
}

function writeLocalProjects(projects: readonly HomeProject[]) {
  window.localStorage.setItem(localProjectsStorageKey, JSON.stringify(projects));
}

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

export function HomeProjectsPanel() {
  const [projects, setProjects] = useState<readonly HomeProject[]>(() => readLocalProjects());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('activity');

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

  function persistProjects(nextProjects: readonly HomeProject[]) {
    setProjects([...nextProjects]);
    writeLocalProjects(nextProjects);
  }

  function createProject() {
    const now = new Date().toISOString();
    const nextProject: HomeProject = {
      id: `local-${Date.now()}`,
      title: `本地项目 ${projects.length + 1}`,
      description: '从 New project 创建后，可继续补充作品目标与 Blueprint。',
      updatedAt: now,
    };
    const nextProjects = [nextProject, ...projects];
    persistProjects(nextProjects);
  }

  function toggleSortMode() {
    setSortMode((current) => (current === 'activity' ? 'name' : 'activity'));
  }

  return (
    <section
      aria-labelledby="current-project-title"
      className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
    >
      <div className="w-full max-w-[770px] pt-[clamp(30px,7vh,58px)]">
        <div className="flex items-center justify-between gap-6">
          <h1
            id="current-project-title"
            className="m-0 font-serif text-[28px] font-semibold leading-none"
          >
            Projects
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[#aaa39a]">Sort by</span>
            <button
              type="button"
              onClick={toggleSortMode}
              className="rounded-lg border-0 bg-[#34332f] px-3 py-2 font-semibold text-[#f5ead8] hover:bg-[#3f3e39]"
            >
              {sortMode === 'activity' ? 'Activity' : 'Name'}
            </button>
            <button
              type="button"
              onClick={createProject}
              className="rounded-lg border-0 bg-[#f8f3eb] px-4 py-2 font-semibold text-[#171715] hover:bg-white"
            >
              New project
            </button>
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
          className="mt-6 h-10 w-full rounded-lg border-0 bg-[#30302d] px-4 text-[#e8decb] outline-none placeholder:text-[#9d968d] focus:ring-1 focus:ring-[#5a5851]"
        />

        {projects.length === 0 ? (
          <div className="flex min-h-[330px] flex-col items-center justify-center text-center">
            <div aria-hidden="true" className="relative h-20 w-20 text-[#f4eadb]">
              <span className="absolute left-4 top-2 h-10 w-10 rotate-[-1deg] rounded-sm border-2 border-current" />
              <span className="absolute left-3 top-3 h-5 w-5 border-b-2 border-r-2 border-current" />
              <span className="absolute left-7 top-7 h-5 w-5 border-b-2 border-r-2 border-current" />
              <span className="absolute bottom-2 right-3 h-9 w-8 rounded-b-2xl rounded-t-md border-2 border-current" />
              <span className="absolute bottom-6 right-1 h-9 w-6 rounded-full border-r-2 border-t-2 border-current" />
            </div>
            <h2 className="m-0 mt-5 text-sm font-semibold text-[#f4eadb]">
              Looking to start a project?
            </h2>
            <p className="m-0 mt-4 max-w-[360px] text-sm leading-5 text-[#f0e6d7]">
              Upload materials, set custom instructions, and organize conversations in one space.
            </p>
            <button
              type="button"
              onClick={createProject}
              className="mt-4 rounded-lg border-0 bg-[#34332f] px-4 py-2 text-sm font-semibold text-[#f8f3eb] hover:bg-[#41403a]"
            >
              New project
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <p className="mt-7 border border-[#34332f] px-4 py-5 text-[#cfc5b7]">
            没有匹配的本地项目。
          </p>
        ) : (
          <div className="mt-7 grid grid-cols-2 gap-6">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="min-h-[120px] rounded-lg border border-[#34332f] bg-transparent px-4 py-4 text-left hover:border-[#5a564e] hover:bg-[#1d1d1a]"
              >
                <strong className="block text-base text-[#f4eadb]">{project.title}</strong>
                <span className="mt-4 block text-sm text-[#d8cab8]">{project.description}</span>
                <span className="mt-5 block text-sm text-[#9f978d]">
                  更新于 {formatUpdatedAt(project.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
