import { Button } from '../ui';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { RevisionBatchScheduler } from './useRevisionBatch';

export function RevisionBatchPanel({
  scheduler,
  permissionProfile,
}: {
  scheduler: RevisionBatchScheduler;
  permissionProfile: AgentPermissionProfile;
}) {
  const view = scheduler.view;
  if (!view) return null;
  return (
    <section
      className="mx-3 my-2 rounded-lg border border-agent/40 bg-panel p-3 text-xs"
      data-testid="revision-batch-panel"
      aria-label="连续修改"
    >
      <div className="font-semibold text-foreground">
        连续修改{view.request ? '第 ' + view.request.from + '–' + view.request.to + ' 章' : ''}
      </div>
      {view.request && (
        <p className="mt-1 whitespace-pre-wrap text-muted">统一要求：{view.request.instruction}</p>
      )}
      <p className="mt-2 text-foreground" role="status">
        {view.message}
      </p>
      {view.chapters.length > 0 && (
        <>
          <p className="mt-1 text-muted">
            已保存 {view.completed}/{view.chapters.length} 章 · 人物按需读取，世界规则全文读取
          </p>
          <ul className="mt-2 max-h-32 overflow-auto text-muted">
            {view.chapters.map((chapter, index) => (
              <li key={chapter.relativePath}>
                {index < view.completed ? '✓ ' : chapter.ordinal === view.current ? '→ ' : ''}
                {chapter.name}
              </li>
            ))}
          </ul>
        </>
      )}
      {view.phase === 'confirming' && (
        <p className="mt-2 text-muted">
          {permissionProfile === 'auto' || permissionProfile === 'full'
            ? '按当前自动档逐章保存，写入前保留快照。'
            : '每章在对比里接受并保存后，才修改下一章。'}{' '}
          拒绝、失败或停止都会暂停后续章节。
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {view.phase === 'confirming' && (
          <Button variant="primary" onClick={scheduler.start} data-testid="revision-batch-start">
            开始连续修改
          </Button>
        )}
        {scheduler.occupied ? (
          <Button onClick={scheduler.stop} data-testid="revision-batch-stop">
            停止连续修改
          </Button>
        ) : (
          <Button onClick={scheduler.close}>
            {view.phase === 'confirming' || view.phase === 'loading' ? '取消' : '关闭'}
          </Button>
        )}
      </div>
    </section>
  );
}
