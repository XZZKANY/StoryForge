/**
 * 欢迎页（v3 原型：启动 / 上手 / 最近 两栏）+ 关闭后的空起始态。
 * 从 App.tsx 抽出。
 */
import { useState, type ReactNode } from 'react';
import { basename } from './helpers';
import {
  ArrowUp,
  BookOpen,
  Command,
  FilePlus,
  FolderOpen,
  Info,
  Keyboard,
  Sparkles,
  X,
} from '../icons/shell-icons';

// v3 原型欢迎页：VS Code 式「启动 / 上手」两栏 tab，保留一句话开新书 composer。
// 复用现成 handler（开项目 / 新建 / 命令面板 / 样例项目 / 设置 / 发送即开书），
// 只新做欢迎页签开关、两栏布局、引导卡与最近内联。
export function WelcomeWorkspace({
  onOpenProject,
  onNewFile,
  onOpenPalette,
  onCreateSampleProject,
  onOpenSettings,
  onShowShortcuts,
  onShowAbout,
  onClose,
  recentProjects,
  onSelectRecent,
  showOnStartup,
  onToggleShowOnStartup,
  composerValue,
  onComposerChange,
  onComposerSend,
}: {
  onOpenProject: () => void;
  onNewFile: () => void;
  onOpenPalette: () => void;
  onCreateSampleProject: () => void;
  onOpenSettings: () => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
  onClose: () => void;
  recentProjects: string[];
  onSelectRecent: (projectPath: string) => void;
  showOnStartup: boolean;
  onToggleShowOnStartup: (value: boolean) => void;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onComposerSend: () => void;
}) {
  const RECENT_CAP = 5;
  const [recentExpanded, setRecentExpanded] = useState(false);
  const shownRecents = recentExpanded ? recentProjects : recentProjects.slice(0, RECENT_CAP);
  const canSend = composerValue.trim().length > 0;

  return (
    <section
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="welcome-workspace"
    >
      {/* 可关的「欢迎」页签（关了露出空 workbench，命令面板「显示欢迎页」可重开）。 */}
      <div
        className="flex h-shell-row flex-none items-stretch border-b border-border bg-panel"
        data-testid="welcome-tabbar"
      >
        <div className="relative -mb-px flex items-center gap-2 border-b border-r border-b-background border-r-border/50 bg-background pl-3.5 pr-3 text-xs font-semibold text-foreground shadow-[inset_0_2px_0_rgb(var(--agent))]">
          <Sparkles size={13} strokeWidth={1.7} aria-hidden="true" className="text-agent" />
          <span>欢迎</span>
          <button
            type="button"
            className="icon-button grid h-[18px] w-[18px] place-items-center rounded text-subtle hover:bg-elevated hover:text-foreground"
            onClick={onClose}
            title="关闭欢迎页"
            data-testid="welcome-close"
          >
            <X size={11} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-12 pt-8 md:px-14 md:pb-5 md:pt-11">
        <div className="mx-auto grid w-[min(920px,100%)] grid-cols-1 gap-x-14 gap-y-2 md:grid-cols-2">
          <div className="col-span-full mb-[22px] flex items-center gap-3.5">
            <span className="relative grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-[10px] bg-elevated text-base font-bold text-foreground">
              S
              <img
                src="/brand-logo.jpg"
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            </span>
            <div>
              <h1 className="text-[26px] font-medium leading-tight tracking-[0.01em] text-foreground">
                StoryForge
              </h1>
              <p className="mt-[3px] text-[12.5px] text-subtle">
                可验证的长篇创作流水线 · 一句话就能开新书
              </p>
            </div>
          </div>

          {/* 启动 */}
          <div className="min-w-0">
            <h2 className="mb-3 text-[15px] font-medium text-foreground">启动</h2>
            <div className="mb-2.5 flex items-center gap-1.5 rounded-[10px] border border-border bg-surface py-1 pl-3 pr-1 shadow-[0_2px_10px_rgba(0,0,0,0.12)] focus-within:border-agent/60">
              <input
                className="h-[30px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
                placeholder="一句话开新书：写下念头，回车即建项目骨架…"
                aria-label="一句话开新书"
                data-testid="welcome-composer-input"
                value={composerValue}
                onChange={(event) => onComposerChange(event.target.value)}
                onKeyDown={(event) => {
                  // IME 组字期间不发送：拼音选字上屏的 Enter 不应误触发送。
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === 'Enter' && !event.shiftKey && canSend) {
                    event.preventDefault();
                    onComposerSend();
                  }
                }}
              />
              <button
                type="button"
                className="grid h-[30px] w-[30px] flex-none place-items-center rounded-lg bg-elevated text-muted transition-colors hover:bg-agent hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="发送即开书"
                data-testid="welcome-composer-send"
                disabled={!canSend}
                onClick={() => {
                  if (canSend) onComposerSend();
                }}
              >
                <ArrowUp size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <WAction
              icon={<FolderOpen size={16} strokeWidth={1.6} aria-hidden="true" />}
              label="打开项目…"
              kbd="Ctrl O"
              onClick={onOpenProject}
              testId="welcome-primary-action"
            />
            <WAction
              icon={<FilePlus size={16} strokeWidth={1.6} aria-hidden="true" />}
              label="新建文件…"
              onClick={onNewFile}
            />
            <WAction
              icon={<Command size={16} strokeWidth={1.6} aria-hidden="true" />}
              label="命令面板…"
              kbd="Ctrl P"
              onClick={onOpenPalette}
            />

            <h2 className="mb-3 mt-[26px] text-[15px] font-medium text-foreground">最近</h2>
            {recentProjects.length === 0 ? (
              <p className="px-2 text-[12px] text-subtle">
                还没有最近项目 · 打开项目后会出现在这里
              </p>
            ) : (
              <>
                {shownRecents.map((projectPath) => (
                  <button
                    key={projectPath}
                    type="button"
                    className="flex w-full items-baseline gap-2.5 rounded-[7px] px-2 py-1.5 text-left hover:bg-elevated"
                    onClick={() => onSelectRecent(projectPath)}
                    title={projectPath}
                  >
                    <span className="flex-none text-[13px] text-agent">
                      {basename(projectPath)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle">
                      {projectPath}
                    </span>
                  </button>
                ))}
                {!recentExpanded && recentProjects.length > RECENT_CAP && (
                  <button
                    type="button"
                    className="ml-2 mt-0.5 px-1 py-1.5 text-[12px] text-agent hover:underline"
                    onClick={() => setRecentExpanded(true)}
                  >
                    更多…
                  </button>
                )}
              </>
            )}
          </div>

          {/* 上手 */}
          <div className="min-w-0">
            <h2 className="mb-3 text-[15px] font-medium text-foreground">上手</h2>
            <WGuide
              icon={<Sparkles size={20} strokeWidth={1.6} aria-hidden="true" />}
              iconAgent
              title="配置模型服务，连接真实 LLM"
              desc="BYO-key，llm-provider.json 写盘换模型即生效"
              onClick={onOpenSettings}
            />
            <WGuide
              icon={<BookOpen size={20} strokeWidth={1.6} aria-hidden="true" />}
              title="打开样例项目「雪夜斩」"
              desc="看一个已有 canon / 章节 / 观测的完整项目长什么样"
              onClick={onCreateSampleProject}
            />
            <WGuide
              icon={<Keyboard size={20} strokeWidth={1.6} aria-hidden="true" />}
              title="快捷键速查"
              desc="全部沿袭 VS Code，Ctrl+C/A/V 不拦截"
              onClick={onShowShortcuts}
            />
            <WGuide
              icon={<Info size={20} strokeWidth={1.6} aria-hidden="true" />}
              title="了解 StoryForge"
              desc="先做诊断控制台，再做生成器：读证据 → 评审 → 修复 → 批准"
              onClick={onShowAbout}
            />
          </div>
        </div>

        <label className="mx-auto mt-[26px] flex w-[min(920px,100%)] cursor-pointer items-center gap-2 text-[12px] text-muted">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-agent"
            data-testid="welcome-startup-toggle"
            checked={showOnStartup}
            onChange={(event) => onToggleShowOnStartup(event.target.checked)}
          />
          <span>启动时显示欢迎页</span>
        </label>
      </div>
    </section>
  );
}

function WAction({
  icon,
  label,
  kbd,
  onClick,
  testId,
}: {
  icon: ReactNode;
  label: string;
  kbd?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="flex h-[34px] w-full items-center gap-2.5 rounded-[7px] px-2 text-left text-[13px] text-agent hover:bg-elevated"
      onClick={onClick}
      data-testid={testId}
    >
      <span className="flex-none text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {kbd && (
        <kbd className="flex-none rounded border border-border px-1.5 font-mono text-[10px] text-subtle">
          {kbd}
        </kbd>
      )}
    </button>
  );
}

function WGuide({
  icon,
  iconAgent = false,
  title,
  desc,
  onClick,
}: {
  icon: ReactNode;
  iconAgent?: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mb-2 flex w-full items-start gap-3 rounded-[10px] border border-border bg-panel px-3.5 py-3 text-left transition-colors hover:border-border-strong/70 hover:bg-elevated"
      onClick={onClick}
    >
      <span className={`mt-px flex-none ${iconAgent ? 'text-agent' : 'text-muted'}`}>{icon}</span>
      <span className="min-w-0">
        <b className="block text-[13px] font-medium text-foreground">{title}</b>
        <small className="mt-[3px] block text-[11.5px] leading-relaxed text-subtle">{desc}</small>
      </span>
    </button>
  );
}

/** 欢迎页已关闭时的空起始态（VS Code 式：命令面板可再开欢迎页）。 */
export function WelcomeDismissed({
  onReopenWelcome,
  onOpenProject,
}: {
  onReopenWelcome: () => void;
  onOpenProject: () => void;
}) {
  return (
    <section
      className="flex h-full min-w-0 flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      data-testid="welcome-dismissed"
    >
      <p className="max-w-sm text-sm leading-relaxed text-subtle">
        欢迎页已关闭。命令面板（
        <kbd className="rounded border border-border px-1 font-mono text-[11px]">Ctrl Shift P</kbd>
        ）里「显示欢迎页」可重新打开。
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-elevated"
          onClick={onReopenWelcome}
        >
          显示欢迎页
        </button>
        <button
          type="button"
          className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground transition-colors hover:opacity-90"
          onClick={onOpenProject}
        >
          打开项目
        </button>
      </div>
    </section>
  );
}
