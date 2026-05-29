'use client';

import type { Diagnostic } from '../../../../../packages/shared/src/diagnostic';
import { ContextInspector, type ContextSnapshot } from '../views/ContextInspector';
import { DiffViewer } from '../views/DiffViewer';
import { JudgeRepairWorkbench } from '../workflows/JudgeRepairWorkbench';
export type EditorAreaProps = {
  readonly tabs: readonly string[];
  readonly activeTabId?: string;
  readonly popoutUrl?: string;
  readonly inspectorId?: string;
  readonly contextSnapshot?: ContextSnapshot;
  readonly contextSnapshotEvictedAt?: string;
  readonly sceneId?: number;
  readonly sceneContent?: string;
  readonly diagnostics?: readonly Diagnostic[];
};

const legacyLabels: Record<string, { title: string; href: string; summary: string }> = {
  'legacy:studio': {
    title: 'Studio 创作工作台',
    href: '/studio',
    summary: '审阅、修复和批准写回链路已在 IDE 内访问。',
  },
  'legacy:retrieval': {
    title: 'Retrieval 证据检索',
    href: '/retrieval',
    summary: '资料检索入口已在 IDE 内访问。',
  },
  'legacy:runs': {
    title: 'Runs 运行诊断',
    href: '/runs',
    summary: '运行诊断入口已在 IDE 内访问。',
  },
  'legacy:artifacts': {
    title: 'Artifacts 工件与导出',
    href: '/artifacts',
    summary: '工件和导出入口已在 IDE 内访问。',
  },
  'legacy:evaluations': {
    title: 'Evaluations 评测系统',
    href: '/evaluations',
    summary: '评测诊断入口已在 IDE 内访问。',
  },
};

export function EditorArea({
  tabs,
  activeTabId,
  popoutUrl,
  inspectorId,
  contextSnapshot,
  contextSnapshotEvictedAt,
  sceneId,
  sceneContent,
  diagnostics = [],
}: EditorAreaProps) {
  const active = activeTabId ?? tabs[0] ?? 'legacy:studio';
  const legacy = legacyLabels[active];
  return (
    <main
      aria-label="Editor Area"
      className="min-h-[32rem] bg-stone-950 p-4 text-stone-100"
      data-active-inspector-id={inspectorId ?? undefined}
    >
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
      {inspectorId ? (
        <ContextInspector snapshot={contextSnapshot} evictedAt={contextSnapshotEvictedAt} />
      ) : sceneId !== undefined ? (
        <section data-active-scene-id={sceneId}>
          <JudgeRepairWorkbench
            content={sceneContent ?? ''}
            diagnostics={diagnostics}
            judgeRunArgs={{ scene_id: sceneId, content: sceneContent ?? '' }}
          />
        </section>
      ) : legacy ? (
        <section
          className="rounded-xl border border-stone-800 bg-stone-900 p-6"
          data-legacy-view={active}
          data-legacy-route={legacy.href}
        >
          <p className="text-xs uppercase tracking-wide text-stone-500">Legacy view in IDE</p>
          <h2 className="mt-1 text-xl font-semibold">{legacy.title}</h2>
          <p className="mt-2 text-sm text-stone-300">{legacy.summary}</p>
          <p className="mt-2 text-sm text-stone-400">
            P0 将旧页面作为 IDE 子视图挂载；保留旧路由链接用于兼容期回放。
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
