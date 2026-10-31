/**
 * 编辑器内的两种就地 AI 交互，共用同一套 view zone / 接受写回机制：
 *
 * - **Ctrl+K 行间对话**（revise）：改锚定文本。单发 /assistant/revise（整文件进出），
 *   把 before/after 夹到锚定行画成「旧行红标 + 新行绿块」。指令必填。
 * - **Ctrl+Shift+K 光标处续写**（continue）：在光标处接着往下写一段。走 SSE
 *   /assistant/continue 逐块吐字，落定后按 planCursorInsertion 画成纯新增绿块。
 *   指令可留空（＝就接着写）；不设「空行拒绝」闸，因为光标停在段末空行正是续写的起手式。
 *
 * 两者都收敛到 useSuggestionWriteback 的 writeAcceptedSuggestion（同一套快照 + 写盘 +
 * 闭环 + 分支）。纯逻辑在 lib/inline-chat.ts 与 lib/inline-continue.ts 已单测；这里只做
 * Monaco view zone / decoration 的命令式生命周期。
 *
 * 红线不破：后端只出建议、不写盘，落盘仍走作者确认后的守卫写回。
 */

import { useCallback, useEffect } from 'react';
import * as monaco from 'monaco-editor';

import { allowsAuthoringActions, readAgentPermissionProfile } from '../../lib/agent-permission';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import type { InlineAnchor } from '../../lib/inline-chat';
import { buildInputZoneDom, type InlineMode } from './inline-chat-dom';
import type { InlineSession } from './inline-chat-session';
import { useInlineDiff } from './useInlineDiff';
import { useInlineRequest } from './useInlineRequest';
import { useInlineSession, type UseInlineChatParams } from './useInlineSession';

/**
 * 会话 id 只在同一项目内沿用；项目变了就丢弃，防止新项目的请求把消息写进旧项目的会话
 * （后端只按 id 取会话，前端不拦就会跨项目复用）。
 */
export function inlineSessionIdForProject(
  sessionId: number | null,
  sessionProject: string | null,
  projectPath: string | null,
): number | null {
  return sessionProject === projectPath ? sessionId : null;
}

export function useInlineChat(params: UseInlineChatParams) {
  const { editorRef, editorReady, filePath, filePathRef, projectPathRef } = params;
  const sessionState = useInlineSession(params);
  const {
    sessionRef,
    sessionIdRef,
    sessionIdProjectRef,
    registeredRef,
    openRef,
    matchesSessionTarget,
    isSessionActive,
    teardown,
    clearToast,
    flashStatus,
    qualifySession,
  } = sessionState;
  const diff = useInlineDiff(params, sessionState);
  const { send } = useInlineRequest(params, sessionState, diff);

  const open = useCallback(
    (mode: InlineMode = 'revise') => {
      const editor = editorRef.current;
      if (!editor || typeof editor.changeViewZones !== 'function') return;
      const project = projectPathRef.current;
      const path = filePathRef.current;
      // 切项目后旧会话 id 必须失效：open 是每次 Ctrl+K / Ctrl+Shift+K 的入口，此刻读到的是
      // 当前项目，能可靠判断 id 是否属于本项目。
      sessionIdRef.current = inlineSessionIdForProject(
        sessionIdRef.current,
        sessionIdProjectRef.current,
        project,
      );
      if (!project || !path) {
        flashStatus(
          mode === 'continue'
            ? '先在编辑器里打开一个文件，再用 Ctrl+Shift+K 续写'
            : '先在编辑器里打开一个文件，再用 Ctrl+K 行间对话',
        );
        return;
      }
      if (isReadOnlyDerivedProjectPath(path)) {
        flashStatus(
          mode === 'continue' ? '派生缓存为只读，不能续写' : '派生缓存为只读，不能行间修订',
        );
        return;
      }
      // 这两条走 /api/assistant/*，不经 AgentRun 的权限 gate；「只读」档要名副其实，
      // 就必须在这里挡住发起。读的是 localStorage 现值而不是缓存 prop：这是授权判定，
      // 要用作者此刻的选择，不是上一次渲染时的。
      if (!allowsAuthoringActions(readAgentPermissionProfile(project))) {
        flashStatus(
          mode === 'continue'
            ? '本作品是只读档，AI 不产生改动；要续写请先在对话框把档位调开'
            : '本作品是只读档，AI 不产生改动；要改稿请先在对话框把档位调开',
        );
        return;
      }
      const model = editor.getModel();
      if (!model) return;

      teardown();

      const selection = editor.getSelection();
      const anchor: InlineAnchor =
        selection && !selection.isEmpty()
          ? {
              startLine: selection.startLineNumber,
              // Monaco 选区不含终点：停在下一行第 1 列只选到前一个换行符，
              // 不能把未选中的下一行正文一起授权给模型或接受写回。
              endLine:
                selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
                  ? selection.endLineNumber - 1
                  : selection.endLineNumber,
              text: model.getValueInRange(selection),
              isSelection: true,
            }
          : {
              startLine: selection?.startLineNumber ?? 1,
              endLine: selection?.startLineNumber ?? 1,
              text: model.getLineContent(selection?.startLineNumber ?? 1),
              isSelection: false,
            };

      // 段落间空行（网文极常见）没选中就按 Ctrl+K，锚定取整行 = 空串 → 模型多半 no-op、白等一趟。
      // 续写不设这道闸：光标停在段末空行按键，正是续写最典型的起手式。
      if (mode !== 'continue' && !anchor.isSelection && anchor.text.trim() === '') {
        flashStatus('先选中要改的文字，再用 Ctrl+K 行间对话');
        return;
      }

      const session: InlineSession = {
        editor,
        textModel: model,
        modelVersion: model.getVersionId(),
        projectPath: project,
        filePath: path,
        accessibleZoneHost: null,
        mode,
        phase: 'input',
        anchor,
        inputDom: null,
        zoneIds: [],
        zoneDoms: [],
        decorations: null,
        keydownHandler: null,
        abortController: null,
        capturedBefore: '',
        resultAfter: '',
        userInstruction: '',
        model: '',
        caretLineAfterAccept: anchor.startLine,
        accepting: false,
        writing: false,
        acceptedSuggestion: null,
      };
      sessionRef.current = session;

      const dom = buildInputZoneDom(anchor, mode, {
        onSend: (value) => {
          if (isSessionActive(session)) void send(value);
          else if (sessionRef.current === session) teardown();
        },
        onCancel: () => {
          if (sessionRef.current === session) teardown();
        },
      });
      session.inputDom = dom;
      // 先给一个够用的初值，随后按真实高度重排——写死高度会把气泡底边裁掉（「不是完整的气泡」）。
      const inputZone: monaco.editor.IViewZone = {
        afterLineNumber: anchor.endLine,
        heightInPx: 120,
        domNode: dom.container,
      };
      let inputZoneId = '';
      editor.changeViewZones((accessor) => {
        inputZoneId = accessor.addZone(inputZone);
        session.zoneIds.push(inputZoneId);
      });
      // Monaco hides view zones from its code-reader by default. Our zones are
      // interactive author UI; child aria-label cannot override a hidden ancestor.
      const zoneHost = dom.container.closest<HTMLElement>('.view-zones');
      if (zoneHost) {
        session.accessibleZoneHost = {
          node: zoneHost,
          originalHidden: zoneHost.getAttribute('aria-hidden'),
        };
        zoneHost.setAttribute('aria-hidden', 'false');
      }
      // zoneDoms 除落位动效外也用于 teardown 的焦点归还判断，输入泡同样登记。
      session.zoneDoms.push(dom.container);
      // 把锚定行滚进视野：接受后 setValue 会把光标重置到第 1 行，若作者已滚到别处，
      // 输入泡会锚在光标（第 1 行）弹到「别处」——这里确保它总在眼前。
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(anchor.startLine);
      }
      // Monaco 把 zone DOM 挂上、布局后：①量真实高度撑满 zone，不裁气泡；②聚焦输入框
      //（rAF 二次兜底，布局期 Monaco 有时会把焦点抢回编辑器，单次 setTimeout 会「打不了字」）。
      const focusInput = () => {
        if (isSessionActive(session) && session.phase === 'input')
          dom.textarea.focus({ preventScroll: true });
      };
      window.requestAnimationFrame(() => {
        if (
          !isSessionActive(session) ||
          session.phase !== 'input' ||
          !session.zoneIds.includes(inputZoneId)
        )
          return;
        const measured = dom.container.offsetHeight;
        if (measured > 0 && editorRef.current && sessionRef.current === session) {
          // offsetHeight 不含外边距，补上 margin(4+6) 再留一点余量。
          inputZone.heightInPx = measured + 14;
          editorRef.current.changeViewZones((accessor) => accessor.layoutZone(inputZoneId));
        }
        focusInput();
        window.requestAnimationFrame(focusInput);
      });
    },
    [
      editorRef,
      filePathRef,
      flashStatus,
      isSessionActive,
      projectPathRef,
      send,
      teardown,
      sessionIdProjectRef,
      sessionIdRef,
      sessionRef,
    ],
  );

  useEffect(() => {
    openRef.current = open;
  }, [open, openRef]);

  // Ctrl+K（改锚定文本）/ Ctrl+Shift+K（光标处续写）各注册一次。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor || registeredRef.current) return;
    registeredRef.current = true;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => openRef.current('revise'));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK, () =>
      openRef.current('continue'),
    );
  }, [editorReady, editorRef, openRef, registeredRef]);

  // 上面两条只在正文有焦点时生效；焦点在文件树、对话框、页签行时按 Ctrl+K 曾是死键，
  // 作者看不到任何反应。正文看得见时把焦点拉回正文，按原选区 / 光标行开同一个行间框。
  useEffect(() => {
    if (!editorReady) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
      if (event.key.toLowerCase() !== 'k') return;
      const editor = editorRef.current;
      const node = editor?.getDomNode();
      if (!editor || !node || !editor.getModel() || editor.hasTextFocus()) return;
      const target = event.target instanceof Element ? event.target : null;
      // 行间框自己的输入框在正文 DOM 里；弹窗（设置、命令面板）里按键不该把正文拽出来。
      if (target && (node.contains(target) || target.closest('[role="dialog"]'))) return;
      if (node.getBoundingClientRect().width === 0) return;
      event.preventDefault();
      editor.focus();
      openRef.current(event.shiftKey ? 'continue' : 'revise');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorReady, editorRef, openRef]);

  // 输入阶段：光标移出锚定行即拆除（点到别的行就是「不改这儿了」）。仅限 input 阶段——
  // diff 阶段点「接受/弃用」按钮会顺带移光标，若此时拆除会话，点击就落空（接受只能用快捷键）。
  // diff 阶段的收尾交给按钮 / Esc / 切文件。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor || typeof editor.onDidChangeCursorPosition !== 'function') return;
    const disposable = editor.onDidChangeCursorPosition((event) => {
      const session = sessionRef.current;
      if (!session || session.phase !== 'input') return;
      const line = event.position.lineNumber;
      if (line < session.anchor.startLine || line > session.anchor.endLine) teardown();
    });
    return () => disposable.dispose();
  }, [editorReady, editorRef, teardown, sessionRef]);

  // 换文件时拆掉进行中的行间会话，避免 zone/decoration 残留到新文件。
  useEffect(() => {
    return () => teardown();
  }, [filePath, teardown]);

  // Project/model refs can change while the editor remains mounted, including
  // a same-file projection. Every committed render rechecks the captured owner.
  useEffect(() => {
    const session = sessionRef.current;
    if (session && !matchesSessionTarget(session)) teardown();
  });

  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor) return;
    const qualifyCurrent = () => {
      const session = sessionRef.current;
      // Guarded writeback may update this model before its audit finishes. Keep the
      // locked candidate until settlement; failures still recheck the captured version.
      if (session?.writing && matchesSessionTarget(session)) return;
      if (session) qualifySession(session);
    };
    const modelSubscription = editor.onDidChangeModel?.(qualifyCurrent);
    const contentSubscription = editor.onDidChangeModelContent?.(qualifyCurrent);
    return () => {
      modelSubscription?.dispose();
      contentSubscription?.dispose();
    };
  }, [editorReady, editorRef, matchesSessionTarget, qualifySession, sessionRef]);

  // 卸载时清掉 toast 与其计时器。
  useEffect(() => {
    return () => clearToast();
  }, [clearToast]);
}
