/**
 * 最左侧项目列表
 * 展示所有最近打开的项目，支持快速切换
 */

import { memo, useCallback } from 'react';

type ProjectListProps = {
  projects: string[];
  activeProject: string | null;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void;
};

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

const ProjectItem = memo(function ProjectItem({
  project,
  isActive,
  onSelect,
}: {
  project: string;
  isActive: boolean;
  onSelect: (path: string) => void;
}) {
  const name = basename(project);
  const handleClick = useCallback(() => {
    onSelect(project);
  }, [project, onSelect]);

  return (
    <button
      onClick={handleClick}
      className={`
        w-full px-3 py-2 text-left text-sm transition-colors
        flex items-center gap-2 group
        ${isActive ? 'bg-[#37373D] text-white' : 'text-[#CCCCCC] hover:bg-[#2D2D30]'}
      `}
      title={project}
    >
      <div className="w-5 h-5 rounded flex items-center justify-center bg-[#37373D] text-[#CCCCCC] text-xs flex-shrink-0">
        {name[0]?.toUpperCase() ?? 'P'}
      </div>
      <span className="truncate flex-1">{name}</span>
    </button>
  );
});

export function ProjectList({
  projects,
  activeProject,
  onSelectProject,
  onOpenProject,
}: ProjectListProps) {
  return (
    <div className="h-full flex flex-col bg-[#1E1E1E]">
      {/* 标题栏 */}
      <div className="h-[36px] px-3 border-b border-[#2D2D30] flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-[#CCCCCC]">项目</span>
        <button
          onClick={onOpenProject}
          className="w-5 h-5 rounded hover:bg-[#2D2D30] flex items-center justify-center text-[#CCCCCC] hover:text-white transition-colors"
          title="打开项目"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {projects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-[#858585] mb-3">暂无项目</p>
            <button
              onClick={onOpenProject}
              className="text-xs text-[#4A9EFF] hover:underline"
            >
              打开项目
            </button>
          </div>
        ) : (
          projects.map((project) => (
            <ProjectItem
              key={project}
              project={project}
              isActive={project === activeProject}
              onSelect={onSelectProject}
            />
          ))
        )}
      </div>
    </div>
  );
}
