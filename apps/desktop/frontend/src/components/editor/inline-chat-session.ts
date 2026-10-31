import * as monaco from 'monaco-editor';

import type { RevisionLoopResult } from '../../lib/author-loop';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { intraLineChangeRange, type InlineAnchor, type LineDiffHunk } from '../../lib/inline-chat';
import {
  buildInputZoneDom,
  buildLoadingZoneDom,
  buildPendingActionsDom,
  type InlineMode,
  type IntraLineSeg,
} from './inline-chat-dom';

// 行间会话的数据形状与 Monaco 装配辅助，不含 React；会话状态与生命周期在 useInlineSession 等 hook 里。

export type WriteAcceptedSuggestion = (
  suggestion: AssistantFileSuggestion,
  path: string,
  previous: string,
  nextContent: string,
  overrides?: { summary?: string; note?: string; recoveredSettlementGuard?: () => boolean },
) => Promise<RevisionLoopResult>;

export type InlinePhase = 'input' | 'loading' | 'diff';

export type InlineSession = {
  editor: monaco.editor.IStandaloneCodeEditor;
  textModel: monaco.editor.ITextModel;
  modelVersion: number;
  projectPath: string;
  filePath: string;
  accessibleZoneHost: { node: HTMLElement; originalHidden: string | null } | null;
  mode: InlineMode;
  phase: InlinePhase;
  anchor: InlineAnchor;
  /** 生成失败时恢复作者原始输入，不重读可能已移动的选区。 */
  inputDom: ReturnType<typeof buildInputZoneDom> | null;
  zoneIds: string[];
  /** 落位动效要给绿块加 class，故除 id 外还留一份 DOM 引用。 */
  zoneDoms: HTMLElement[];
  decorations: monaco.editor.IEditorDecorationsCollection | null;
  keydownHandler: ((event: KeyboardEvent) => void) | null;
  // loading 阶段的 revise 请求控制器：Esc / 取消键 abort 掉在途请求（E16）。
  abortController: AbortController | null;
  capturedBefore: string;
  resultAfter: string;
  userInstruction: string;
  model: string;
  /** 接受后光标停靠的 1-based 行；续写要停在新段末尾而非锚定行。 */
  caretLineAfterAccept: number;
  /**
   * 已进入接受流程。落位动效把 teardown 推到 await 之后，这段时间里 zone 还挂着、
   * sessionRef 还在，接受键与 Alt+Enter 都还能再次触发——没有这道闸就会写两次盘。
   * （改前 teardown 是同步先跑的，第二次触发天然被 sessionRef 为空挡住。）
   */
  accepting: boolean;
  writing: boolean;
  /** 重试沿用同一回执身份，先核对已落盘/未知结果，绝不换 ID 重放。 */
  acceptedSuggestion: AssistantFileSuggestion | null;
  acceptedWriteOverrides?: { recoveredSettlementGuard: () => boolean };
};

export function editorLineHeight(editor: monaco.editor.IStandaloneCodeEditor): number {
  try {
    const height = editor.getOption(monaco.editor.EditorOption.lineHeight);
    return typeof height === 'number' && height > 0 ? height : 22;
  } catch {
    return 22;
  }
}

// ---- Monaco 装配辅助（zone 增删 / 高度重排）；zone DOM 的声明式构造在 inline-chat-dom.ts ----

/**
 * 续写的流式区：把逐块到达的正文即时画在落点下方，让作者看到笔在动。
 *
 * 这里显示的是**原始增量**，仅供观感——最终以 done.text 重新算插入计划再渲染成绿块。
 * 高度重排按帧节流：每个 token 都 layoutZone 会让编辑器整页抖动。
 */
export function swapZoneToStreaming(
  editor: monaco.editor.IStandaloneCodeEditor,
  session: InlineSession,
  anchorLine: number,
  onCancel: () => void,
  isActive: () => boolean,
): { append: (text: string) => void } {
  const dom = document.createElement('div');
  dom.className = 'sf-inline-diff-zone sf-inline-diff-zone--streaming';
  dom.setAttribute('role', 'group');
  dom.setAttribute('aria-label', '行间续写进行中');
  try {
    dom.style.fontFamily = editor.getOption(monaco.editor.EditorOption.fontInfo).fontFamily;
  } catch {
    /* 字体拿不到就用继承值，不值得为此中断续写。 */
  }

  const body = document.createElement('div');
  body.className = 'sf-inline-diff-line';
  body.setAttribute('aria-hidden', 'true');
  const { bar, cancel } = buildPendingActionsDom('正在续写…', onCancel);
  dom.append(body, bar);

  let zoneId = '';
  const zone: monaco.editor.IViewZone = {
    afterLineNumber: anchorLine,
    heightInPx: 60,
    domNode: dom,
  };
  editor.changeViewZones((accessor) => {
    for (const id of session.zoneIds) accessor.removeZone(id);
    zoneId = accessor.addZone(zone);
    session.zoneIds = [zoneId];
    session.zoneDoms = [dom];
  });

  // 输入 zone 已随上面的重建撤掉，焦点移到「取消」：loading 期间唯一可用的操作得让
  // 键盘/读屏摸得到（rAF 等 Monaco 把 zone 挂上再抢，否则会落空或被编辑器夺回）。
  focusWhenSettled(cancel, isActive);

  let pending = false;
  const relayout = () => {
    pending = false;
    if (!isActive()) return;
    const measured = dom.offsetHeight;
    if (measured <= 0 || measured + 8 === zone.heightInPx) return;
    zone.heightInPx = measured + 8;
    editor.changeViewZones((accessor) => accessor.layoutZone(zoneId));
  };

  return {
    append: (text: string) => {
      body.textContent = `${body.textContent ?? ''}${text}`;
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(relayout);
    },
  };
}

/** 仅在当前会话/稿件仍有效的生成失败后调用；保留原输入 DOM、文字与锚点。 */
export function restoreInputZone(session: InlineSession, isActive: () => boolean): void {
  const input = session.inputDom;
  if (!input) return;
  session.phase = 'input';
  const zone: monaco.editor.IViewZone = {
    afterLineNumber: session.anchor.endLine,
    heightInPx: 120,
    domNode: input.container,
  };
  let zoneId = '';
  session.editor.changeViewZones((accessor) => {
    for (const id of session.zoneIds) accessor.removeZone(id);
    zoneId = accessor.addZone(zone);
    session.zoneIds = [zoneId];
    session.zoneDoms = [input.container];
  });
  window.requestAnimationFrame(() => {
    if (!isActive() || !session.zoneIds.includes(zoneId)) return;
    const measured = input.container.offsetHeight;
    if (measured > 0) {
      zone.heightInPx = Math.max(100, measured + 14);
      session.editor.changeViewZones((accessor) => accessor.layoutZone(zoneId));
    }
  });
  focusWhenSettled(input.textarea, isActive);
}

export function swapZoneToLoading(
  editor: monaco.editor.IStandaloneCodeEditor,
  session: InlineSession,
  onCancel: () => void,
  isActive: () => boolean,
): void {
  const zoneId = session.zoneIds[0];
  if (!zoneId) return;
  // 简化处理：重建 zone 内容为 loading 行（保留同一 afterLineNumber）+ 取消键，长请求不再干等。
  const { dom, cancel } = buildLoadingZoneDom(onCancel);
  editor.changeViewZones((accessor) => {
    accessor.removeZone(zoneId);
    const id = accessor.addZone({
      afterLineNumber: session.anchor.endLine,
      heightInPx: 40,
      domNode: dom,
    });
    session.zoneIds = [id];
    session.zoneDoms = [dom];
  });

  // 同流式区：输入 zone 没了，焦点落到「取消」这个唯一可用操作上。
  focusWhenSettled(cancel, isActive);
}

// rAF 二次兜底：布局期 Monaco 有时会把焦点抢回编辑器（同输入框的聚焦处理）。
function focusWhenSettled(element: HTMLElement, isActive: () => boolean): void {
  const focus = () => {
    if (isActive()) element.focus({ preventScroll: true });
  };
  window.requestAnimationFrame(() => {
    focus();
    window.requestAnimationFrame(focus);
  });
}

// 单行替换（一旧行→一新行）才做句内高亮；多行 hunk / 纯增删回退整行铺色。
export function intraLineHunkSeg(
  model: monaco.editor.ITextModel,
  hunk: LineDiffHunk,
): IntraLineSeg | null {
  if (
    hunk.removedStartLine === null ||
    hunk.removedStartLine !== hunk.removedEndLine ||
    hunk.newLines.length !== 1
  ) {
    return null;
  }
  return intraLineChangeRange(model.getLineContent(hunk.removedStartLine), hunk.newLines[0]);
}
