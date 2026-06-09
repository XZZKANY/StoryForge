'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  MessageSquare,
  FolderOpen,
  PenTool,
  Database,
  Package,
  FlaskConical,
  Globe,
  Settings,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

import { ThemeToggle } from './ThemeToggle';
import { CollapsibleNavItem } from './CollapsibleNavItem';
import { StudioProjectsList } from './StudioProjectsList';
import { RecentItemsList } from './RecentItemsList';
import type { RecentItem } from './recent-items-store';

type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly description?: string;
};

const primaryNavItems: readonly NavItem[] = [
  { href: '/', label: '助手对话', icon: MessageSquare, description: '与 AI 助手对话' },
  { href: '/?view=projects', label: '我的项目', icon: FolderOpen, description: '项目管理' },
  { href: '/studio', label: '创作工作台', icon: PenTool, description: '作品创作与批准' },
  { href: '/retrieval', label: '检索中心', icon: Database, description: '资料源与证据' },
  { href: '/artifacts', label: '产物库', icon: Package, description: '制品治理' },
  { href: '/evaluations', label: '质量评测', icon: FlaskConical, description: '生成质量诊断' },
  { href: '/worldbuilding', label: '世界观', icon: Globe, description: '世界观图谱' },
  { href: '/runs', label: '运行与设置', icon: Settings, description: 'JobRun 与配置' },
] as const;

export function UnifiedSidebar({
  initialRecentItems = [],
}: {
  readonly initialRecentItems?: readonly RecentItem[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isRecentOpen, setIsRecentOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);

  return (
    <aside
      aria-label="StoryForge 主导航"
      className="sticky top-0 flex h-screen min-h-screen flex-col overflow-hidden border-r border-[#34332f] bg-[#171715] px-4 pb-6 pt-4"
    >
      {/* Logo + New Project */}
      <div className="flex h-9 items-center justify-between">
        <Link
          href="/"
          className="font-serif text-[clamp(21px,1.55vw,26px)] font-semibold leading-none !text-[#f4eadb] no-underline"
        >
          StoryForge
        </Link>
        <button
          type="button"
          aria-label="新建项目"
          className="grid h-7 w-7 place-items-center rounded-lg bg-[#2d2d2a] text-lg !text-[#f4eadb] hover:bg-[#383832]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Primary Navigation */}
      <nav aria-label="StoryForge 主导航" className="mt-[clamp(24px,3vh,34px)]">
        <ul className="!m-0 !grid !grid-cols-1 !gap-[clamp(7px,1vh,10px)] !p-0">
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            const isProjectsView =
              item.href === '/?view=projects' &&
              pathname === '/' &&
              searchParams.get('view') === 'projects';
            const isAssistantView =
              item.href === '/' && pathname === '/' && searchParams.get('view') !== 'projects';
            const isActive =
              isProjectsView ||
              isAssistantView ||
              (item.href !== '/' &&
                !item.href.includes('?') &&
                (pathname === item.href || pathname.startsWith(item.href + '/')));

            // Studio 项目有特殊的折叠逻辑
            if (item.href === '/studio') {
              return (
                <CollapsibleNavItem
                  key={item.href}
                  icon={<Icon className="h-4 w-4" />}
                  label={item.label}
                  href={item.href}
                  isActive={isActive}
                  description={item.description}
                  defaultOpen={isActive}
                >
                  <StudioProjectsList />
                </CollapsibleNavItem>
              );
            }

            return (
              <li
                key={item.href}
                className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
              >
                <Link
                  href={item.href}
                  title={item.description}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group flex min-h-[clamp(36px,4.4vh,42px)] items-center gap-3 rounded-lg px-2 text-[clamp(13px,0.9vw,15px)] no-underline hover:bg-[#252522] ${
                    isActive ? 'bg-[#2c2b27] !text-[#f8efe2]' : '!text-[#e7dfd3]'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${
                      isActive
                        ? 'border-[#6f675a] bg-[#3a3832] text-[#f6ead7]'
                        : 'border-[#3d3b36] text-[#cfc5b8]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Recent Items - Collapsible */}
      <section
        aria-labelledby="recent-title"
        className="mt-[clamp(24px,3vh,34px)] min-h-0 !border-0 !bg-transparent !p-0 !shadow-none"
      >
        <button
          type="button"
          onClick={() => setIsRecentOpen(!isRecentOpen)}
          aria-expanded={isRecentOpen}
          className="flex w-full items-center justify-between text-xs font-normal text-[#89827a] hover:text-[#a69e92]"
        >
          <h2 id="recent-title" className="text-xs font-normal">
            最近记录
          </h2>
          <ChevronRight
            className={`h-3 w-3 transition-transform ${isRecentOpen ? 'rotate-90' : ''}`}
          />
        </button>
        {isRecentOpen && <RecentItemsList initialItems={initialRecentItems} />}
      </section>

      {/* Account Menu - Bottom */}
      <section
        className="relative !mb-0 !mt-auto !rounded-none !border-0 !border-t !border-[#34332f] !bg-transparent !p-0 pt-4 !shadow-none"
        aria-label="账号和工作区菜单"
      >
        {isAccountMenuOpen && (
          <div
            id="account-menu"
            role="menu"
            className="absolute bottom-[76px] left-0 right-0 z-10 rounded-xl border border-[#4b4943] bg-[#353530] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
          >
            <p className="m-0 px-3 pb-2 pt-1 text-xs text-[#aaa39a]">StoryForge 本地工作区</p>
            <ul className="!m-0 !grid !grid-cols-1 !gap-1 !p-0">
              <li className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
                <Link
                  href="/settings"
                  role="menuitem"
                  className="block rounded-lg px-3 py-2 text-sm font-semibold !text-[#f0e6d7] no-underline hover:bg-[#44423b]"
                >
                  设置
                </Link>
              </li>
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-xl border border-[#34332f] bg-[#20201e] p-2 hover:bg-[#252522]">
          <button
            type="button"
            aria-controls="account-menu"
            aria-expanded={isAccountMenuOpen}
            onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left"
          >
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#d9d2c5] font-bold text-[#141412]">
              SF
            </div>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-sm font-bold text-[#e8decb]">StoryForge 本地</p>
              <p className="m-0 text-xs text-[#c69a6a]">Provider 未检测</p>
            </div>
          </button>
          <ThemeToggle />
        </div>
      </section>
    </aside>
  );
}
