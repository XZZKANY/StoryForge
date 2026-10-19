/**
 * 会话的改名与「从列表移除」（作者 10-17 巡检：会话只能新建和切换）。
 * 改名写进引擎库；移除只是不在列表里显示，记录与运行证据都还在，右下角给「撤销」。
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { renameAssistantSession } from '../../lib/api-client';
import type { AssistantSessionRecord } from '../../lib/api/types';
import { readHiddenSessions, writeHiddenSessions } from '../../lib/hidden-sessions';
import { emitToast } from '../../lib/toast';

export function sessionDisplayTitle(session: AssistantSessionRecord): string {
  return session.title.replace(/^IDE Agent:\s*/, '') || `会话 #${session.id}`;
}

export function useSessionManagement({
  projectPath,
  sessions,
  setSessions,
  activeSessionId,
  setConversationTitle,
  onRemovedActive,
}: {
  projectPath: string | null;
  sessions: AssistantSessionRecord[];
  setSessions: (update: (current: AssistantSessionRecord[]) => AssistantSessionRecord[]) => void;
  activeSessionId: number | null;
  setConversationTitle: (title: string) => void;
  /** 移除的正是当前会话：换成新会话，免得对话区还挂着一个列表里找不到的会话。 */
  onRemovedActive: () => void;
}) {
  // 改动先写进 localStorage，再递增版本号重读：换项目时自然读到那个项目自己的清单。
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const hidden = useMemo(
    () => readHiddenSessions(projectPath),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hiddenVersion 只用来在写入后重读
    [projectPath, hiddenVersion],
  );

  const visibleSessions = useMemo(
    () => sessions.filter((session) => !hidden.has(session.id)),
    [hidden, sessions],
  );

  const setHiddenFor = useCallback(
    (project: string, update: (current: Set<number>) => Set<number>) => {
      const saved = writeHiddenSessions(project, update(readHiddenSessions(project)));
      setHiddenVersion((version) => version + 1);
      if (!saved) emitToast('本机存储写不进去，会话列表没有改动。', { tone: 'error' });
      return saved;
    },
    [],
  );
  // 改名回来时用户可能已切到别的会话：按那时的当前会话决定要不要改标题，不按发起时的。
  const activeSessionRef = useRef(activeSessionId);
  useLayoutEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  const renameSession = useCallback(
    async (id: number, title: string) => {
      const next = title.trim();
      if (!next) return;
      try {
        await renameAssistantSession(id, next);
      } catch (error) {
        emitToast(`改名失败：${error instanceof Error ? error.message : String(error)}`, {
          tone: 'error',
        });
        return;
      }
      setSessions((current) =>
        current.map((session) => (session.id === id ? { ...session, title: next } : session)),
      );
      if (id === activeSessionRef.current) setConversationTitle(next);
    },
    [setConversationTitle, setSessions],
  );

  const removeSession = useCallback(
    (id: number) => {
      if (!projectPath) return;
      const project = projectPath;
      const session = sessions.find((item) => item.id === id);
      if (!setHiddenFor(project, (current) => new Set([...current, id]))) return;
      if (id === activeSessionId) onRemovedActive();
      emitToast(`已从列表移除「${session ? sessionDisplayTitle(session) : `会话 #${id}`}」`, {
        action: {
          label: '撤销',
          run: () => {
            setHiddenFor(project, (current) => {
              const next = new Set(current);
              next.delete(id);
              return next;
            });
          },
        },
      });
    },
    [activeSessionId, onRemovedActive, projectPath, sessions, setHiddenFor],
  );

  return { visibleSessions, renameSession, removeSession };
}
