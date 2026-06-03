import Link from 'next/link';

import { ArtifactsPageContent } from '../../app/artifacts/page-content';
import { AssistantConversation } from './AssistantConversation';
import { HomeProjectsPanel } from './HomeProjectsPanel';
import { HomeSidebar } from './HomeSidebar';
import { homeNavItems, type HomeRecentItem } from './home-data';
import { createHomeViewHref, type HomeSearchParams, type HomeView } from './home-view';

export async function HomeShell({
  activeView = 'assistant',
  recentItems = [],
  searchParams = {},
}: {
  readonly activeView?: HomeView;
  readonly recentItems?: readonly HomeRecentItem[];
  readonly searchParams?: HomeSearchParams;
}) {
  const isAssistantView = activeView === 'assistant';

  return (
    <div className="min-h-screen bg-stone-950 text-[#e8decb] md:grid md:grid-cols-[288px_minmax(0,1fr)]">
      <HomeSidebar activeView={activeView} recentItems={recentItems} />
      <main
        aria-labelledby="home-assistant-title"
        className="!m-0 flex min-h-screen !w-full flex-col overflow-x-hidden bg-[#171715] !p-0"
      >
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:hidden">
          <nav aria-label="移动端主导航" className="flex flex-wrap gap-2 md:hidden">
            {homeNavItems.map((item) => (
              <Link
                key={item.label}
                href={createHomeViewHref(item.view)}
                className="rounded-lg border border-[#3d3b36] px-3 py-2 text-sm !text-[#f4eadb] no-underline"
              >
                {item.label.split(' ')[0]}
              </Link>
            ))}
          </nav>
        </div>

        {isAssistantView ? (
          <AssistantConversation searchParams={searchParams} />
        ) : (
          <div className="mx-auto w-full max-w-none px-6 pb-14 pt-4 text-[#e8decb] [&_a]:text-[#d7b98a] [&_button]:transition [&_dd]:m-0 [&_dd]:text-[#d8cab8] [&_dl]:grid [&_dl]:gap-2 [&_dt]:text-[#9f978d] [&_h1]:font-serif [&_h1]:text-[28px] [&_h1]:font-semibold [&_h1]:leading-none [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:my-2 [&_p]:text-[#b7afa4] [&_section]:!m-0 [&_section]:!rounded-none [&_section]:!border-0 [&_section]:!bg-transparent [&_section]:!p-0 [&_section]:!shadow-none [&_ul]:pl-5">
            {activeView === 'projects' ? <HomeProjectsPanel /> : null}
            {activeView === 'artifacts' ? (
              <section
                aria-labelledby="current-artifacts-title"
                className="w-full max-w-[770px] pt-[clamp(30px,7vh,58px)]"
              >
                <p className="m-0 text-sm font-semibold uppercase tracking-wide text-[#a69e92]">
                  Artifacts 当前项目产物库
                </p>
                <h1 id="current-artifacts-title" className="m-0 mt-3">
                  Artifacts
                </h1>
                <p>
                  这里聚合当前项目正文、导出文件、审计报告和版本追溯；没有真实产物时保持空状态，不展示占位记录。
                </p>
                <section aria-labelledby="artifact-list-title">
                  <h2 id="artifact-list-title">产物列表</h2>
                  <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr_1fr] gap-4 border-y border-[#34332f] py-2 text-xs font-semibold uppercase text-[#8f877d]">
                    <span>名称</span>
                    <span>类型</span>
                    <span>版本</span>
                    <span>关联项目</span>
                  </div>
                  <p>真实产物由下方 Artifacts 读取；没有 API 数据时只显示错误或空状态。</p>
                </section>
                <ArtifactsPageContent variant="home" />
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
