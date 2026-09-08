import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useKnowledgeInbox } from '../../src/components/app/useKnowledgeInbox';
import { KnowledgeInboxView } from '../../src/components/shell/KnowledgeInboxView';
import '../../src/index.css';

// 仅由 Playwright 拦截 API 的开发夹具，不读取真实项目或执行知识写回。
function Fixture() {
  const [projectRoot, setProjectRoot] = useState<string | null>('D:/uiux-isolated-fixture');
  const handle = useKnowledgeInbox(projectRoot);
  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <h1 className="mb-4 text-sm">UI/UX 验收夹具 · API 拦截 · 无真实项目/写回</h1>
      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => setProjectRoot('D:/uiux-isolated-fixture')}>
          切换到项目 A
        </button>
        <button type="button" onClick={() => setProjectRoot('D:/uiux-isolated-fixture-B')}>
          切换到项目 B
        </button>
        <button type="button" onClick={() => setProjectRoot(null)}>
          关闭项目
        </button>
      </div>
      <p data-testid="fixture-project-root">{projectRoot ?? '已关闭项目'}</p>
      <div
        className="flex flex-col border border-border bg-panel"
        style={{ height: 680, width: '100%', maxWidth: 380 }}
      >
        <KnowledgeInboxView handle={handle} />
      </div>
      <button type="button" className="mt-4 rounded border border-border p-2">
        外部焦点测试入口
      </button>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(
  Reflect.get(window, '__STORYFORGE_UIUX_FIXTURE__') === true ? (
    <Fixture />
  ) : (
    <p>请通过隔离的 Playwright 验收脚本打开；直接访问不会启动 API 请求。</p>
  ),
);
