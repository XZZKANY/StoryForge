/**
 * 命令面板与观测镜共用的「先把界面摆好，再发动作」：布局切换、展开对话栏后再发会话事件。
 * 从 AppShell 拆出来只为守住它的行数上限，行为与原先内联的回调一致。
 */
import { emitAgentPromptRequest, emitNewSessionRequest } from '../../lib/assistant-events';
import type { LayoutMode, useShellState } from '../shell/useShellState';

type Shell = ReturnType<typeof useShellState>;

export function shellActions(shell: Shell, openWorkspace: () => void) {
  const focus = (show: () => void, mode: LayoutMode) => () => {
    openWorkspace();
    show();
    shell.setLayoutMode(mode);
  };
  const revealChat = () => {
    openWorkspace();
    shell.showRight();
  };
  return {
    onFocusAssistantOnly: focus(shell.showRight, 'chat'),
    onFocusWorkspaceOnly: focus(shell.showSidebar, 'editor'),
    onRestoreLayout: focus(shell.showSidebar, 'balanced'),
    onNewSession: () => {
      revealChat();
      emitNewSessionRequest();
    },
    onAskAgent: (text: string) => {
      revealChat();
      emitAgentPromptRequest(text);
    },
  };
}
