/**
 * 左侧导航栏：项目库列表、会话管理、设置入口。
 * 从 App.tsx 抽出。
 */
import { useState, useCallback } from 'react';
import { HomeStoryIcon, ProjectIcon } from '../StoryIcons';
import type { AppSettings } from '../../lib/user-settings';
import { describeProviderConnection, getProviderPreset } from '../../lib/provider-config';
import { basename } from './helpers';
import {
  ChevronRightIcon,
  FolderPlusIcon,
  MessagePlusIcon,
  SettingsIcon,
  SparkleIcon,
  StoryStructureIcon,
  TaskIcon,
} from './icons';

function SidebarButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="sf-sidebar-row group text-[#E2E2E2] hover:bg-[#222222]">
      <span className="icon-badge text-[#9A9A9A] group-hover:text-white">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function IconToolButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: (
    event: React.MouseEvent<HTMLSpanElement> | React.KeyboardEvent<HTMLSpanElement>,
  ) => void;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="sf-icon-button text-[#888888] hover:bg-[#303030] hover:text-white"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onClick(event);
      }}
      title={title}
    >
      {children}
    </span>
  );
}

function ProviderSettingsCard({
  settings,
  onOpenSettings,
}: {
  settings: AppSettings;
  onOpenSettings: () => void;
}) {
  const providerPreset = getProviderPreset(settings.provider.kind);
  const providerConnection = describeProviderConnection(settings.provider);
  const modelLabel = settings.provider.model.trim();
  const subtitle = modelLabel
    ? `${providerConnection.label} · ${modelLabel}`
    : `${providerConnection.label} · ${providerPreset.label}`;

  return (
    <button
      className="group flex w-full items-center gap-2 rounded-xl border border-[#303030] bg-[#1B1B1B] px-2 py-2 text-left transition-colors hover:border-[#3E3E3E] hover:bg-[#222222]"
      onClick={onOpenSettings}
      data-testid="settings-entry-card"
      title="打开设置"
    >
      <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-[#E8E1D7] text-[12px] font-semibold text-[#111111]">
        SF
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-[#EDEDED]">本地创作环境</div>
        <div className="truncate text-[12px] text-[#A8A8A8]">{subtitle}</div>
      </div>
      <span className="flex h-7 w-5 flex-shrink-0 items-center justify-center text-[#777777] transition-colors group-hover:text-[#BDBDBD]">
        <SettingsIcon />
      </span>
    </button>
  );
}

export function CodexSidebar({
  projects,
  activeProject,
  settings,
  projectAssistantSessions,
  onSelectProject,
  onOpenProject,
  onInitializeProject,
  onOpenSettings,
}: {
  projects: string[];
  activeProject: string | null;
  settings: AppSettings;
  projectAssistantSessions: Record<string, number>;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void;
  onInitializeProject: (projectPath?: string) => void;
  onOpenSettings: () => void;
}) {
  const [projectLibraryExpanded, setProjectLibraryExpanded] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  const toggleProjectSessions = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <div className="h-full flex flex-col text-[13px]">
      <div className="h-9 px-3 flex items-center gap-4 text-[#999999]">
        <button className="hover:text-white" title="侧边栏">
          ▣
        </button>
        <button className="hover:text-white" title="搜索">
          ⌕
        </button>
        <span className="ml-auto text-[#666666]">‹</span>
        <span className="text-[#666666]">›</span>
      </div>

      <div className="space-y-1 px-2">
        <SidebarButton icon={<TaskIcon />} label="自动任务" />
        <SidebarButton icon={<SparkleIcon />} label="个性化" />
      </div>

      <div className="group mt-6 flex h-[var(--sf-row-height)] items-center px-3 text-xs text-[#777777]">
        <span className="min-w-0 flex-1 truncate">项目库</span>
        <button
          className="sf-icon-button text-[#777777] opacity-0 transition-opacity hover:bg-[#252525] hover:text-[#DCDCDC] group-hover:opacity-100"
          onClick={() => setProjectLibraryExpanded((expanded) => !expanded)}
          title={projectLibraryExpanded ? '收起项目库' : '展开项目库'}
          data-testid="toggle-project-library"
          aria-expanded={projectLibraryExpanded}
        >
          <span
            className={
              projectLibraryExpanded ? 'rotate-90 transition-transform' : 'transition-transform'
            }
          >
            <ChevronRightIcon />
          </span>
        </button>
        <button
          id="open-project-btn"
          className="sf-icon-button text-[#777777] opacity-0 transition-opacity hover:bg-[#252525] hover:text-[#DCDCDC] group-hover:opacity-100"
          onClick={onOpenProject}
          title="添加项目"
          data-testid="add-project-btn"
        >
          <FolderPlusIcon />
        </button>
      </div>
      <div
        className={projectLibraryExpanded ? 'mt-2 space-y-1 px-2' : 'hidden'}
        data-testid="project-library-list"
      >
        {projects.length > 0 ? (
          projects.slice(0, 5).map((project) => {
            const path = project;
            const label =
              project.includes('\\') || project.includes('/') ? basename(project) : project;
            const isActive = activeProject === path;
            const isExpanded = expandedProjects.has(path);
            const sessionId = projectAssistantSessions[path];
            const sessions: Array<{ id: number; title: string }> = sessionId
              ? [{ id: sessionId, title: '最近创作会话' }]
              : [];
            return (
              <div key={project}>
                <button
                  onClick={() => {
                    if (project.includes('\\') || project.includes('/')) onSelectProject(path);
                  }}
                  className={`sf-sidebar-row group ${
                    isActive ? 'text-white' : 'text-[#CFCFCF] hover:bg-[#222222]'
                  }`}
                  title={path}
                >
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[#A8A8A8] transition-colors group-hover:text-[#DCDCDC] ${
                      isActive ? 'bg-[#2A2A2A] text-[#DCDCDC]' : ''
                    }`}
                  >
                    <ProjectIcon />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <IconToolButton
                      title={isExpanded ? '收起会话' : '展开会话'}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleProjectSessions(path);
                      }}
                    >
                      <span
                        className={
                          isExpanded ? 'rotate-90 transition-transform' : 'transition-transform'
                        }
                      >
                        <ChevronRightIcon />
                      </span>
                    </IconToolButton>
                    <IconToolButton
                      title="新建会话"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectProject(path);
                      }}
                    >
                      <MessagePlusIcon />
                    </IconToolButton>
                    <IconToolButton
                      title="初始化小说项目结构"
                      onClick={(event) => {
                        event.stopPropagation();
                        onInitializeProject(path);
                      }}
                    >
                      <StoryStructureIcon />
                    </IconToolButton>
                  </span>
                </button>
                {isExpanded && (
                  <div
                    className="mb-1 ml-10 mr-2 py-1"
                    data-testid="project-session-list"
                    data-project-path={path}
                  >
                    {sessions.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-[#777777]">暂无会话</div>
                    ) : (
                      sessions.map((session) => (
                        <button
                          key={session.id}
                          className="flex h-7 w-full items-center rounded px-2 text-left text-xs text-[#BDBDBD] hover:bg-[#222222] hover:text-white"
                          onClick={() => onSelectProject(path)}
                          title={`Assistant 会话 #${session.id}`}
                        >
                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <button
            className="w-full rounded-md border border-dashed border-[#303030] px-3 py-2 text-left text-xs text-[#777777] hover:border-[#3A3A3A] hover:text-[#BDBDBD]"
            onClick={onOpenProject}
          >
            暂无项目
          </button>
        )}
        <SidebarButton icon={<HomeStoryIcon />} label="首页" />
      </div>

      <div className="mt-auto p-2">
        <ProviderSettingsCard settings={settings} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}
