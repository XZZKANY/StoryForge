'use client';

import { DiffViewer } from '../views/DiffViewer';
export type EditorAreaProps = {
  readonly tabs: readonly string[];
  readonly activeTabId?: string;
  readonly popoutUrl?: string;
};

const legacyLabels: Record<string, { title: string; href: string }> = {
  'legacy:studio': { title: 'Studio 创作工作台', href: '/studio' },
  'legacy:retrieval': { title: 'Retrieval 证据检索', href: '/retrieval' },
  'legacy:runs': { title: 'Runs 运行诊断', href: '/runs' },
  'legacy:artifacts': { title: 'Artifacts 工件与导出', href: '/artifacts' },
  'legacy:evaluations': { title: 'Evaluations 评测系统', href: '/evaluations' },
};

export function EditorArea({ tabs, activeTabId, popoutUrl }: EditorAreaProps) {
  const active = activeTabId ?? tabs[0] ?? 'legacy:studio';
  const legacy = legacyLabels[active];
  return (
    <main aria-label="Editor Area" className="min-h-[32rem] bg-stone-950 p-4 text-stone-100">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-stone-800 pb-2 text-sm">
        <div className="flex gap-2">
          {tabs.length === 0 ? (
            <span>欢迎</span>
          ) : (
            tabs.map((tab) => (
              <span key={tab} className="rounded bg-stone-800 px-2 py-1">
                {tab}
              </span>
            ))
          )}
        </div>
        {popoutUrl ? (
          <a
            className="rounded border border-sky-700 px-2 py-1 text-sky-200"
            href={popoutUrl}
            target="_blank"
            rel="noreferrer"
          >
            拆到新窗口
          </a>
        ) : null}
      </div>
      {legacy ? (
        <section className="rounded-xl border border-stone-800 bg-stone-900 p-6">
          <h2 className="text-xl font-semibold">{legacy.title}</h2>
          <p className="mt-2 text-sm text-stone-300">
            旧页面已纳入 IDE 工作台入口，P0 使用无 iframe 占位卡片保留原路由访问。
          </p>
          <a
            className="mt-4 inline-block rounded bg-sky-600 px-3 py-2 text-sm font-semibold text-white"
            href={legacy.href}
          >
            打开旧页面
          </a>
        </section>
      ) : active === 'diff' ? (
        <DiffViewer before="修复前内容" after="修复后内容" />
      ) : (
        <section className="rounded-xl border border-stone-800 bg-stone-900 p-6">
          编辑器或占位视图：{active}
        </section>
      )}
    </main>
  );
}
