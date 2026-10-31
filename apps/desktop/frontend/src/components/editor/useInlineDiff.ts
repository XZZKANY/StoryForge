import { useCallback } from 'react';
import * as monaco from 'monaco-editor';

import { createRemoteFileSuggestion } from '../../lib/assistant-suggestions';
import {
  isInlineEditStale,
  planAnchoredInlineDiff,
  type AnchoredInlineDiff,
} from '../../lib/inline-chat';
import { buildDiffZoneDom, type InlineDiffActions } from './inline-chat-dom';
import { editorLineHeight, intraLineHunkSeg } from './inline-chat-session';
import type { InlineSessionState, UseInlineChatParams } from './useInlineSession';

// diff 阶段：把计划画成红标旧行 + 绿块新行 + 动作条；接受时收敛到同一套守卫写回。

export function useInlineDiff(
  { editorRef, filePathRef, writeAcceptedSuggestion }: UseInlineChatParams,
  {
    sessionRef,
    sessionIdRef,
    matchesSessionTarget,
    isSessionActive,
    teardown,
    flashStatus,
    qualifySession,
    playAcceptSettle,
  }: InlineSessionState,
) {
  const applyAccepted = useCallback(async () => {
    const editor = editorRef.current;
    const session = sessionRef.current;
    const path = filePathRef.current;
    if (!editor || !session || session.phase !== 'diff' || !path) return;
    if (session.accepting) return;
    if (!qualifySession(session)) return;
    session.accepting = true;

    const isContinue = session.mode === 'continue';
    const bailIfStale = () => {
      if (!isInlineEditStale(session.capturedBefore, editor.getValue())) return false;
      teardown();
      flashStatus(
        isContinue
          ? '文件已变化，续写已取消，请重新发起 Ctrl+Shift+K'
          : '文件已变化，行间修订已取消，请重新发起 Ctrl+K',
      );
      return true;
    };
    if (bailIfStale()) return;

    const suggestion = (session.acceptedSuggestion ??= createRemoteFileSuggestion({
      filePath: path,
      before: session.capturedBefore,
      after: session.resultAfter,
      summary: isContinue
        ? `光标处续写：${session.userInstruction || '接着往下写'}`
        : `行间修订：${session.userInstruction || '按指令润色锚定文本'}`,
      model: session.model,
      userIntent: session.userInstruction || (isContinue ? '光标处续写' : '行间对话修订'),
      assistantSessionId: sessionIdRef.current,
    }));
    const previous = session.capturedBefore;
    const next = session.resultAfter;
    const anchorLine = session.caretLineAfterAccept;

    await playAcceptSettle(session);
    // 落位这段时间里 Esc / 切文件可能已经把会话收掉，作者也可能又敲了字——
    // 所以写回前把两件事都再验一遍（比改前只在入口验一次更严）。
    if (!qualifySession(session)) return;
    if (bailIfStale()) return;
    session.writing = true;
    for (const dom of session.zoneDoms) {
      dom.setAttribute('aria-busy', 'true');
      for (const button of dom.querySelectorAll<HTMLButtonElement>('button'))
        button.disabled = true;
    }

    try {
      const targetModel = session.textModel;
      const targetVersion = session.modelVersion;
      const overrides = (session.acceptedWriteOverrides ??= {
        // 仅本次已确认请求的原模型、原版本可同步查证成功的回执；历史回执不能覆盖新输入。
        // 写回器另核对缓存目标身份，导航后的结算仍只同步原文件，不碰新的活动编辑器。
        recoveredSettlementGuard: () =>
          session.acceptedSuggestion === suggestion &&
          !targetModel.isDisposed() &&
          targetModel.getVersionId() === targetVersion,
      });
      const writeback = await writeAcceptedSuggestion(suggestion, path, previous, next, overrides);
      if (!matchesSessionTarget(session)) return;
      if (sessionRef.current !== session) return;
      teardown();
      // writeAcceptedSuggestion 内部 setValue 会把光标重置到第 1 行；停回刚改的地方，
      // 免得下一次 Ctrl+K 又锚到开头。
      editor.setPosition({ lineNumber: anchorLine, column: 1 });
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(anchorLine);
      }
      flashStatus(
        writeback.writebackWarning ??
          (isContinue ? '续写已写进当前文件' : '行间修订已写进当前文件'),
      );
    } catch (error) {
      if (!qualifySession(session)) return;
      session.accepting = false;
      session.writing = false;
      session.editor.getContainerDomNode?.()?.classList.remove('sf-inline-accepting');
      for (const dom of session.zoneDoms) {
        dom.classList.remove('sf-inline-diff-zone--settling');
        dom.removeAttribute('aria-busy');
        for (const button of dom.querySelectorAll<HTMLButtonElement>('button'))
          button.disabled = false;
        const accept = dom.querySelector<HTMLButtonElement>('.sf-inline-btn-accept');
        if (accept) accept.textContent = '重试（Alt+Enter）';
      }
      flashStatus(
        `接受失败，候选已保留；可重试核对原来那次写入：${error instanceof Error ? error.message : String(error)}`,
        'assertive',
      );
    }
  }, [
    editorRef,
    filePathRef,
    flashStatus,
    matchesSessionTarget,
    playAcceptSettle,
    qualifySession,
    teardown,
    writeAcceptedSuggestion,
    sessionIdRef,
    sessionRef,
  ]);

  // 把已算好的插入 / 修订计划画成红标 + 绿块 + 动作条。revise 与 continue 共用这一段，
  // 差别只在计划怎么来：前者把整文件修订夹到锚定行，后者直接构造纯新增。
  const renderPlan = useCallback(
    (before: string, plan: AnchoredInlineDiff) => {
      const editor = editorRef.current;
      const session = sessionRef.current;
      const model = editor?.getModel();
      if (!editor || !session || !model) return;

      // 先撤输入 zone，再画 diff。
      if (session.zoneIds.length > 0) {
        editor.changeViewZones((accessor) => {
          for (const id of session.zoneIds) accessor.removeZone(id);
        });
        session.zoneIds = [];
      }
      session.phase = 'diff';
      session.capturedBefore = before;
      // 接受只写夹到锚定处的改动，模型 drift 到别处的一律不带上。
      session.resultAfter = plan.clampedAfter;
      // 续写接受后光标停在新段末尾（接着往下打字），修订则停回锚定行。
      const lastHunk = plan.hunks[plan.hunks.length - 1];
      session.caretLineAfterAccept =
        session.mode === 'continue' && lastHunk
          ? lastHunk.afterLineNumber + lastHunk.newLines.length
          : session.anchor.startLine;

      const actions: InlineDiffActions = {
        addedLines: plan.addedLines,
        removedLines: plan.removedLines,
        hunkCount: plan.hunks.length,
        droppedOffAnchor: plan.droppedOffAnchor,
      };

      // 旧行红标：整行淡背景作上下文；单行替换再叠一层句内高亮，只标真正改动的字（E22）。
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];
      for (const hunk of plan.hunks) {
        if (hunk.removedStartLine === null || hunk.removedEndLine === null) continue;
        decorations.push({
          range: new monaco.Range(hunk.removedStartLine, 1, hunk.removedEndLine, 1),
          options: { isWholeLine: true, className: 'sf-inline-diff-old' },
        });
        const seg = intraLineHunkSeg(model, hunk);
        if (seg && seg.oldEndCol > seg.oldStartCol) {
          decorations.push({
            range: new monaco.Range(
              hunk.removedStartLine,
              seg.oldStartCol,
              hunk.removedStartLine,
              seg.oldEndCol,
            ),
            options: { className: 'sf-inline-diff-old-seg' },
          });
        }
      }
      session.decorations = editor.createDecorationsCollection(decorations);

      // 绿色新增块 + 动作条（挂在最后一个 hunk 的 zone 上，落在 diff 底部）。
      const lineHeight = editorLineHeight(editor);
      // 绿色新增块的字体跟随编辑器实际解析出的字体（CJK 2:1 栈），与红色旧行同栈，改字比对不再错位。
      const editorFontFamily = editor.getOption(monaco.editor.EditorOption.fontInfo).fontFamily;
      const hostIndex = plan.hunks.length - 1;
      const diffZones: Array<{ id: string; zone: monaco.editor.IViewZone; dom: HTMLElement }> = [];
      // 动作条挂在 host zone 上；diff 画完后焦点要落进去，先记住它。
      let hostDom: HTMLElement | null = null;
      editor.changeViewZones((accessor) => {
        plan.hunks.forEach((hunk, index) => {
          const isHost = index === hostIndex;
          if (hunk.newLines.length === 0 && !isHost) return;
          const dom = buildDiffZoneDom(
            hunk,
            isHost ? actions : null,
            editorFontFamily,
            intraLineHunkSeg(model, hunk),
            {
              onAccept: () => {
                if (isSessionActive(session)) void applyAccepted();
              },
              onReject: () => {
                if (!isSessionActive(session) || session.writing) return;
                const wasContinue = sessionRef.current?.mode === 'continue';
                teardown();
                flashStatus(wasContinue ? '已弃用这段续写' : '已弃用行间修订');
              },
            },
          );
          // 初值估算；长行折行 / 动作条换行都会撑高，随后按真实高度重排，避免裁掉。
          const heightInPx =
            Math.max(hunk.newLines.length, hunk.newLines.length === 0 ? 0 : 1) * lineHeight +
            (isHost ? 44 : 10);
          const zone: monaco.editor.IViewZone = {
            afterLineNumber: hunk.afterLineNumber,
            heightInPx: Math.max(heightInPx, isHost ? 52 : lineHeight),
            domNode: dom,
          };
          const id = accessor.addZone(zone);
          session.zoneIds.push(id);
          session.zoneDoms.push(dom);
          diffZones.push({ id, zone, dom });
          if (isHost) hostDom = dom;
        });
      });
      // 布局后量真实高度撑满各 zone，绿块/动作条不被裁。
      window.requestAnimationFrame(() => {
        if (sessionRef.current !== session || !editorRef.current) return;
        editorRef.current.changeViewZones((accessor) => {
          for (const { id, zone, dom } of diffZones) {
            const measured = dom.offsetHeight;
            if (measured > 0 && measured + 8 !== zone.heightInPx) {
              zone.heightInPx = measured + 8;
              accessor.layoutZone(id);
            }
          }
        });
      });

      // 键盘：Alt+Enter 接受、Esc 弃用。挂 document（捕获期）而非编辑器容器——
      // 输入框撤掉后焦点已不在编辑器里，挂容器会收不到事件。
      const handler = (event: KeyboardEvent) => {
        if (event.isComposing) return;
        if (event.key === 'Enter' && event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          void applyAccepted();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (session.writing) return;
          const wasContinue = sessionRef.current?.mode === 'continue';
          teardown();
          flashStatus(wasContinue ? '已弃用这段续写' : '已弃用行间修订');
        }
      };
      document.addEventListener('keydown', handler, true);
      session.keydownHandler = handler;

      // 输入/loading zone 已拆，焦点此刻回落 body；移进动作条（接受键），键盘与读屏都有锚点。
      // 只做一次，不随后续变化反复搬焦点——流式输出期间搬焦点会造成读屏轰炸。
      const focusActions = () => {
        if (sessionRef.current !== session) return;
        hostDom?.querySelector('button')?.focus({ preventScroll: true });
      };
      // rAF 二次兜底：布局期 Monaco 有时会把焦点抢回编辑器（同输入框的聚焦处理）。
      window.requestAnimationFrame(() => {
        focusActions();
        window.requestAnimationFrame(focusActions);
      });

      if (session.mode === 'continue') {
        flashStatus(
          `续写建议已就绪：约 ${plan.clampedAfter.length - before.length} 字，Alt+Enter 接受`,
        );
        return;
      }
      const droppedNote =
        plan.droppedOffAnchor > 0 ? `（已忽略别处 ${plan.droppedOffAnchor} 处改动）` : '';
      flashStatus(`行间修订建议已就绪：+${plan.addedLines} / -${plan.removedLines}${droppedNote}`);
    },
    [applyAccepted, editorRef, flashStatus, isSessionActive, teardown, sessionRef],
  );

  const renderDiff = useCallback(
    (before: string, after: string) => {
      const session = sessionRef.current;
      if (!session) return;
      const plan = planAnchoredInlineDiff(before, after, {
        startLine: session.anchor.startLine,
        endLine: session.anchor.endLine,
      });
      if (plan.isNoop) {
        teardown();
        flashStatus(
          plan.droppedOffAnchor > 0
            ? 'AI 的改动落在选定处之外，已忽略；换个更具体的说法再试 Ctrl+K'
            : '行间对话：AI 没有提出改动',
        );
        return;
      }
      renderPlan(before, plan);
    },
    [flashStatus, renderPlan, teardown, sessionRef],
  );

  return { renderPlan, renderDiff };
}

export type InlineDiff = ReturnType<typeof useInlineDiff>;
