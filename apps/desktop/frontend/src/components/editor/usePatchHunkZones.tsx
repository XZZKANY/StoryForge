import { useEffect, useMemo, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type * as monaco from 'monaco-editor';
import type { PatchHunkZone } from '../../lib/patch-hunks';

// Monaco 内联 diff 画删除行的 zone 不带 ordinal（按 10000 排）；同一行之后，接受键排在删除行下面。
const PATCH_HUNK_ZONE_ORDINAL = 10001;
// 一排 compact 键（24px）加上下各 3px；键多到折行时按实测高度撑开。
const PATCH_HUNK_ZONE_MIN_HEIGHT = 30;

const noSubscription = () => () => {};

function createZoneDom(): HTMLDivElement {
  const dom = document.createElement('div');
  dom.className = 'sf-patch-hunk-zone';
  // 原生拦截：Monaco 的鼠标处理挂在编辑器 DOM 的 pointerdown 上，React 合成事件拦不住；
  // 放过去它会抢焦点、吞掉点击。
  const stop = (event: Event) => event.stopPropagation();
  dom.addEventListener('mousedown', stop);
  dom.addEventListener('pointerdown', stop);
  return dom;
}

/**
 * 在对比区新稿侧每处改动下方挂一条矮 view zone，把 renderZone 的内容经 portal 渲染进去。
 * zones 换了、面板收起（enabled=false）或卸载时摘掉旧 zone；差异重算后按同一批位置重挂。
 */
export function usePatchHunkZones({
  diffEditorRef,
  zones,
  enabled,
  renderZone,
}: {
  diffEditorRef: RefObject<monaco.editor.IStandaloneDiffEditor | null>;
  zones: readonly PatchHunkZone[];
  enabled: boolean;
  renderZone: (zone: PatchHunkZone) => ReactNode;
}): ReactNode {
  const hosts = useMemo(() => zones.map((zone) => ({ zone, dom: createZoneDom() })), [zones]);
  // portal 只在客户端挂：服务端渲染（静态快照）不支持 portal，也没有 diff 编辑器可挂。
  const onClient = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  useEffect(() => {
    const diffEditor = diffEditorRef.current;
    if (!enabled || !diffEditor || hosts.length === 0) return;
    const editor = diffEditor.getModifiedEditor();
    let placed: Array<{ id: string; viewZone: monaco.editor.IViewZone; dom: HTMLElement }> = [];
    let frame = 0;
    const measure = () => {
      editor.changeViewZones((accessor) => {
        for (const entry of placed) {
          const content = entry.dom.firstElementChild;
          const height = content instanceof HTMLElement ? content.offsetHeight : 0;
          if (height <= 0) continue;
          const next = Math.max(PATCH_HUNK_ZONE_MIN_HEIGHT, height);
          if (next === entry.viewZone.heightInPx) continue;
          entry.viewZone.heightInPx = next;
          accessor.layoutZone(entry.id);
        }
      });
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const place = () => {
      editor.changeViewZones((accessor) => {
        const measured = new Map(placed.map((entry) => [entry.dom, entry.viewZone.heightInPx]));
        for (const entry of placed) accessor.removeZone(entry.id);
        placed = hosts.map(({ zone, dom }) => {
          const viewZone: monaco.editor.IViewZone = {
            afterLineNumber: zone.afterLineNumber,
            heightInPx: measured.get(dom) ?? PATCH_HUNK_ZONE_MIN_HEIGHT,
            ordinal: PATCH_HUNK_ZONE_ORDINAL,
            domNode: dom,
          };
          return { id: accessor.addZone(viewZone), viewZone, dom };
        });
      });
      scheduleMeasure();
    };
    place();
    const diffSubscription = diffEditor.onDidUpdateDiff(place);
    const layoutSubscription = editor.onDidLayoutChange(scheduleMeasure);
    return () => {
      cancelAnimationFrame(frame);
      diffSubscription.dispose();
      layoutSubscription.dispose();
      // 卸载时 diff 编辑器可能已先一步销毁，那时 Monaco 的 changeViewZones 是空操作。
      editor.changeViewZones((accessor) => {
        for (const entry of placed) accessor.removeZone(entry.id);
      });
      placed = [];
    };
  }, [diffEditorRef, enabled, hosts]);

  if (!enabled || !onClient) return null;
  return hosts.map(({ zone, dom }) =>
    createPortal(renderZone(zone), dom, `zone-${zone.afterLineNumber}`),
  );
}
