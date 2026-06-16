'use client';

import {
  Bot,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  File,
  FileText,
  Folder,
  FolderOpen,
  GitPullRequestDraft,
  History,
  Layers3,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  Search,
  Settings2,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type VariantKey = 'default' | 'ai-focus' | 'file-focus';

const variants: readonly {
  readonly key: VariantKey;
  readonly label: string;
  readonly description: string;
}[] = [
  { key: 'default', label: '三栏工作台', description: '项目入口、AI 交互、文件工作区并排' },
  { key: 'ai-focus', label: 'AI 聚焦', description: '中间协商创作，右侧保留文件预览' },
  { key: 'file-focus', label: '文件聚焦', description: '右侧展开项目文件，中间缩为助手线索' },
];

const projects = [
  ['雾港回声', '长篇 / 修订中'],
  ['雪线以北', '新书 / 大纲期'],
  ['第七封来信', '短篇 / 待审'],
] as const;

const fileGroups = [
  {
    title: '大纲',
    icon: BookOpen,
    files: [
      ['总纲.md', '三幕结构 / 37 节点'],
      ['第02章节点.md', '当前打开'],
      ['反转表.md', '6 个反转'],
    ],
  },
  {
    title: '人物',
    icon: UsersRound,
    files: [
      ['周眠.md', '主角 / 记忆缺口'],
      ['林砚.md', '协作者 / 隐瞒线索'],
      ['沈确.md', '嫌疑人 / 身份裂缝'],
    ],
  },
  {
    title: '设定',
    icon: Settings2,
    files: [
      ['雾港.md', '场景规则'],
      ['旧电台.md', '核心异常物'],
      ['潮汐塔.md', '终局地点'],
    ],
  },
  {
    title: '正文',
    icon: FileText,
    files: [
      ['第01章.md', '已审'],
      ['第02章.md', '修订中'],
      ['第03章.md', '草稿'],
    ],
  },
] as const;

const openTabs = ['第02章节点.md', '旧电台.md', '周眠.md'] as const;

const chatTurns = [
  {
    role: '你',
    text: '我点开《雾港回声》，右边先看第 02 章和大纲。你帮我判断这章是不是过早解释旧电台。',
  },
  {
    role: 'StoryForge',
    text: '当前问题不是信息太少，而是解释位置太早。建议保留“未来火警”证据，把机制解释后移到第 4 章。',
  },
  {
    role: '你',
    text: '那右边文件里，先改第02章节点.md，再让我确认正文要不要同步改。',
  },
] as const;

const filePreview = [
  ['文件', '大纲/第02章节点.md'],
  ['状态', '修订中'],
  ['关联', '正文/第02章.md、设定/旧电台.md'],
] as const;

const outlineNodes = [
  ['2.1', '周眠回到雾港，发现旧宅被重新上锁'],
  ['2.2', '林砚递来十年前的失踪剪报'],
  ['2.3', '旧电台播放未来火警，冲突升级'],
  ['2.4', '沈确第一次撒谎，埋下身份裂缝'],
] as const;

export function StoryForgeWorkbenchPrototype({
  initialVariant,
}: {
  readonly initialVariant?: string;
}) {
  const [variant, setVariant] = useState<VariantKey>(() => coerceVariant(initialVariant));
  const variantMeta = variants.find((item) => item.key === variant) ?? variants[0];

  const layoutClass = useMemo(() => {
    if (variant === 'ai-focus') {
      return 'grid-cols-[14rem_minmax(38rem,1fr)_24rem]';
    }
    if (variant === 'file-focus') {
      return 'grid-cols-[13rem_20rem_minmax(42rem,1fr)]';
    }
    return 'grid-cols-[14rem_minmax(28rem,0.95fr)_minmax(38rem,1.15fr)]';
  }, [variant]);

  const selectVariant = (nextVariant: VariantKey) => {
    setVariant(nextVariant);
    const url = new URL(window.location.href);
    url.searchParams.set('prototype', 'storyforge-ui');
    url.searchParams.set('variant', nextVariant);
    window.history.replaceState(null, '', url);
  };

  const cycleVariant = (direction: 1 | -1) => {
    const currentIndex = variants.findIndex((item) => item.key === variant);
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    selectVariant(variants[nextIndex].key);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') cycleVariant(-1);
      if (event.key === 'ArrowRight') cycleVariant(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [variant]);

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen flex-col bg-[#111315] text-[#f0f2f2]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#2a2d30] bg-[#14171a] px-3 text-xs text-[#9ca3a8]">
        <div className="flex items-center gap-3">
          <button
            className="grid h-7 w-7 place-items-center rounded hover:bg-[#24282b]"
            type="button"
            aria-label="折叠侧栏"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
          <span>StoryForge</span>
          <span>/</span>
          <span className="text-[#d8dcde]">项目</span>
          <span>/</span>
          <span className="text-[#d8dcde]">雾港回声</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded border border-[#32363a] px-2 py-1 text-[#d8dcde]">
            {variantMeta.label}
          </span>
          <button
            className="grid h-7 w-7 place-items-center rounded hover:bg-[#24282b]"
            type="button"
            aria-label="搜索"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className={`grid min-h-0 flex-1 ${layoutClass} transition-[grid-template-columns] duration-300`}
      >
        <ProjectPanel />
        <AiInteractionPanel variant={variant} />
        <FileWorkspace variant={variant} />
      </div>

      <PrototypeSwitcher
        current={variant}
        description={variantMeta.description}
        onCycle={cycleVariant}
      />
    </div>
  );
}

function ProjectPanel() {
  return (
    <aside className="min-h-0 border-r border-[#2a2d30] bg-[#171b1f]">
      <div className="flex h-10 items-center justify-between border-b border-[#2a2d30] px-3 text-xs text-[#aeb4b9]">
        <button className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[#24282b]" type="button">
          <span className="text-sm font-medium text-[#c8ced2]">项目</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-center gap-1">
          <button className="grid h-7 w-7 place-items-center rounded hover:bg-[#24282b]" type="button">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button className="grid h-7 w-7 place-items-center rounded hover:bg-[#24282b]" type="button">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          <button className="grid h-7 w-7 place-items-center rounded hover:bg-[#24282b]" type="button">
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-2 overflow-auto p-2">
        {projects.map(([name, meta], index) => (
          <button
            key={name}
            type="button"
            className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
              index === 0 ? 'bg-[#263039] text-[#f4f6f7]' : 'text-[#c6cbcf] hover:bg-[#22272b]'
            }`}
          >
            <Folder className="h-4 w-4 shrink-0 text-[#87909a]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{name}</span>
              <span className="block truncate text-[11px] text-[#7e858b]">{meta}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function AiInteractionPanel({ variant }: { readonly variant: VariantKey }) {
  const compact = variant === 'file-focus';
  return (
    <section className="min-h-0 border-r border-[#2a2d30] bg-[#111315]">
      <div className="flex h-10 items-center justify-between border-b border-[#2a2d30] px-3 text-xs text-[#aeb4b9]">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4" />
          <span>AI 交互</span>
        </div>
        <div className="flex items-center gap-2">
          <Columns3 className="h-3.5 w-3.5" />
          <span>{compact ? '线索' : '协作'}</span>
        </div>
      </div>

      <div className="flex h-[calc(100vh-5.25rem)] flex-col">
        {!compact ? (
          <div className="border-b border-[#2a2d30] bg-[#15191c] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#7e858b]">上下文</span>
              {['雾港回声', '大纲/第02章节点.md', '人物/周眠.md', '设定/旧电台.md'].map(
                (item) => (
                  <span
                    key={item}
                    className="rounded border border-[#30363b] bg-[#1b2024] px-2 py-1 text-[#cbd1d5]"
                  >
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {compact ? (
            <CompactAiRail />
          ) : (
            <>
              <div className="mb-4 rounded-md border border-[#2f3438] bg-[#181c20] p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#f0f2f2]">
                  <Sparkles className="h-4 w-4 text-[#e3b261]" />
                  《雾港回声》项目会话
                </div>
                <p className="text-sm leading-6 text-[#bbc2c7]">
                  当前上下文：右侧打开了大纲/第02章节点.md，可随时引用人物和设定文件。
                </p>
              </div>
              <div className="space-y-3">
                {chatTurns.map((turn) => (
                  <div
                    key={turn.text}
                    className={`rounded-md border p-3 ${
                      turn.role === '你'
                        ? 'border-[#31363a] bg-[#15191d]'
                        : 'border-[#3a3328] bg-[#201b14]'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#aeb4b9]">
                      {turn.role === '你' ? (
                        <UserRound className="h-3.5 w-3.5" />
                      ) : (
                        <Bot className="h-3.5 w-3.5" />
                      )}
                      {turn.role}
                    </div>
                    <p className="text-sm leading-6 text-[#e0e4e6]">{turn.text}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-md border border-[#31363a] bg-[#181c20] p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#e4c17a]">
                  <GitPullRequestDraft className="h-3.5 w-3.5" />
                  建议写入
                </div>
                <p className="text-sm leading-6 text-[#c8ced2]">
                  更新右侧文件：第02章节点.md，把旧电台机制解释后移，只保留异常证据。
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded bg-[#e3b261] px-3 py-1.5 text-xs font-semibold text-[#1a1408]"
                    type="button"
                  >
                    应用到文件
                  </button>
                  <button
                    className="rounded border border-[#3a3f44] px-3 py-1.5 text-xs text-[#d5dade]"
                    type="button"
                  >
                    只生成建议
                  </button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ['审查当前文件', '检查结构漏洞'],
                  ['同步到正文', '生成可确认补丁'],
                  ['打开关联文件', '补齐人物设定'],
                ].map(([title, subtitle]) => (
                  <button
                    key={title}
                    className="rounded-md border border-[#30363b] bg-[#161a1e] p-3 text-left hover:bg-[#1e2429]"
                    type="button"
                  >
                    <span className="block text-xs font-semibold text-[#d7dcdf]">{title}</span>
                    <span className="mt-1 block text-[11px] text-[#7e858b]">{subtitle}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="border-t border-[#2a2d30] p-3">
          <div className="flex items-center gap-2 rounded-md border border-[#353a3f] bg-[#1b1f23] px-3 py-2">
            <Sparkles className="h-4 w-4 shrink-0 text-[#e3b261]" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-[#f0f2f2] outline-none placeholder:text-[#6f777d]"
              placeholder={compact ? '问 AI...' : '和 StoryForge 讨论当前项目或右侧文件...'}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function CompactAiRail() {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-[#3a3328] bg-[#201b14] p-3">
        <div className="mb-2 text-xs font-semibold text-[#e3b261]">当前建议</div>
        <p className="text-sm leading-6 text-[#d6d0c5]">第02章节点：机制解释后移。</p>
      </div>
      {['引用：旧电台.md', '关联：周眠.md', '同步：第02章.md'].map((item) => (
        <div
          key={item}
          className="rounded border border-[#2f3438] bg-[#181c20] px-3 py-2 text-sm text-[#c9ced2]"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function FileWorkspace({ variant }: { readonly variant: VariantKey }) {
  const compact = variant === 'ai-focus';
  return (
    <section className="min-h-0 bg-[#151719]">
      <div className="flex h-10 items-center justify-between border-b border-[#2a2d30] px-3 text-xs text-[#aeb4b9]">
        <div className="flex items-center gap-2">
          <File className="h-4 w-4" />
          <span>文件浏览器</span>
        </div>
        <div className="flex items-center gap-2">
          <span>{compact ? '预览' : '雾港回声'}</span>
          <button className="grid h-7 w-7 place-items-center rounded hover:bg-[#24282b]" type="button">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div
        className={`grid h-[calc(100vh-5.25rem)] min-h-0 ${
          compact ? 'grid-cols-1' : 'grid-cols-[16.5rem_minmax(0,1fr)]'
        }`}
      >
        {!compact ? <ProjectFileTree /> : null}
        <FileViewer compact={compact} />
      </div>
    </section>
  );
}

function ProjectFileTree() {
  return (
    <aside className="min-h-0 overflow-auto border-r border-[#2a2d30] bg-[#171b1f] p-3">
      <div className="mb-3 flex items-center justify-between text-xs text-[#7e858b]">
        <span>《雾港回声》</span>
        <div className="flex items-center gap-1">
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-[#24282b]" type="button">
            <Search className="h-3.5 w-3.5" />
          </button>
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-[#24282b]" type="button">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-[#24282b]" type="button">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mb-3 rounded border border-[#2f3438] bg-[#111518] px-2 py-1.5 text-xs text-[#7e858b]">
        搜索文件、人物、设定
      </div>
      <div className="space-y-3">
        {fileGroups.map((group) => {
          const Icon = group.icon;
          return (
            <div key={group.title}>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#747b81]">
                <ChevronDown className="h-3 w-3" />
                <Icon className="h-3.5 w-3.5" />
                {group.title}
              </div>
              <div className="space-y-1 pl-3">
                {group.files.map(([name, meta]) => (
                  <button
                    key={name}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      name === '第02章节点.md'
                        ? 'bg-[#263039] text-[#f4f6f7]'
                        : 'text-[#c6cbcf] hover:bg-[#22272b]'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[#87909a]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{name}</span>
                      <span className="block truncate text-[11px] text-[#7e858b]">{meta}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function FileViewer({ compact }: { readonly compact: boolean }) {
  return (
    <article className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[#131516]">
      {!compact ? (
        <div className="flex h-10 items-center overflow-hidden border-b border-[#2a2d30] bg-[#181c20] text-xs">
          {openTabs.map((tab, index) => (
            <button
              key={tab}
              type="button"
              className={`flex h-full max-w-44 items-center gap-2 border-r border-[#2a2d30] px-3 ${
                index === 0
                  ? 'bg-[#131516] text-[#f0f2f2]'
                  : 'text-[#9aa2a8] hover:bg-[#20252a]'
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{tab}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 overflow-auto px-7 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="mb-2 text-xs text-[#8a9298]">大纲 / 第02章节点.md</p>
            <h1 className="m-0 text-2xl font-semibold leading-tight text-[#f4f6f7]">
              第 02 章：旧电台
            </h1>
          </div>
          <span className="rounded bg-[#263039] px-2 py-1 text-xs text-[#cfe3f4]">打开中</span>
        </div>

        {!compact ? (
          <dl className="mb-6 grid grid-cols-3 gap-2">
            {filePreview.map(([label, value]) => (
              <div key={label} className="rounded border border-[#2f3438] bg-[#191d20] p-3">
                <dt className="text-[11px] text-[#7e858b]">{label}</dt>
                <dd className="mt-1 text-xs font-medium text-[#d7dcdf]">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="space-y-3">
          {outlineNodes.slice(0, compact ? 2 : outlineNodes.length).map(([id, text], index) => (
            <div
              key={id}
              className={`rounded-md border p-3 ${
                index === 2
                  ? 'border-[#4d412e] bg-[#241f16] text-[#f1dfb7]'
                  : 'border-[#2f3438] bg-[#1b1f23] text-[#cbd1d5]'
              }`}
            >
              <div className="mb-1 text-xs font-semibold text-[#e3b261]">{id}</div>
              <p className="m-0 text-sm leading-6">{text}</p>
            </div>
          ))}
        </div>

        {!compact ? (
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_12rem] gap-3">
            <div className="rounded-md border border-[#4d412e] bg-[#211c14] p-4">
              <div className="mb-2 text-xs font-semibold text-[#e3b261]">AI 文件旁注</div>
              <p className="text-sm leading-6 text-[#d7caae]">
                这个文件负责章级结构，不直接写正文。AI 的建议可以先落在这里，再决定是否同步到正文/第02章.md。
              </p>
            </div>
            <div className="space-y-2">
              {[
                [Layers3, '关联文件', '2 个'],
                [History, '版本记录', 'v18'],
              ].map(([Icon, title, value]) => {
                const IconComponent = Icon as typeof Layers3;
                return (
                  <div key={title as string} className="rounded border border-[#2f3438] bg-[#191d20] p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-[#8a9298]">
                      <IconComponent className="h-3.5 w-3.5" />
                      {title as string}
                    </div>
                    <div className="text-sm font-semibold text-[#d7dcdf]">{value as string}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
      </div>
    </article>
  );
}

function PrototypeSwitcher({
  current,
  description,
  onCycle,
}: {
  readonly current: VariantKey;
  readonly description: string;
  readonly onCycle: (direction: 1 | -1) => void;
}) {
  const currentIndex = variants.findIndex((item) => item.key === current);
  const label = variants[currentIndex]?.label ?? current;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#3b4146] bg-[#0d0f10] px-3 py-2 text-xs text-[#d7dcdf] shadow-2xl shadow-black/50">
      <button
        type="button"
        className="grid h-8 w-8 place-items-center rounded-full hover:bg-[#24282b]"
        onClick={() => onCycle(-1)}
        aria-label="上一个原型"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="min-w-56 text-center">
        <div className="font-semibold">{label}</div>
        <div className="text-[11px] text-[#8b9399]">{description}</div>
      </div>
      <button
        type="button"
        className="grid h-8 w-8 place-items-center rounded-full hover:bg-[#24282b]"
        onClick={() => onCycle(1)}
        aria-label="下一个原型"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function coerceVariant(value: string | undefined): VariantKey {
  if (value === 'ai-focus' || value === 'file-focus' || value === 'default') {
    return value;
  }
  if (value === 'editor-focus') return 'file-focus';
  return 'default';
}
