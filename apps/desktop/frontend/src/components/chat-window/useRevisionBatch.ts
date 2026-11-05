import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { executeIdeCommand } from '../../lib/api/ide-commands';
import { sendAgentControlMessage } from '../../lib/api-client';
import { PATCH_REJECTED_EVENT, type PatchRejection } from '../../lib/assistant-events';
import { mapBookContextPayload, type ManuscriptChapter } from '../../lib/book-context';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import { relativePathInsideProject } from '../../lib/project-context';
import { awaitChapterWriteback } from '../../lib/write-batch-writeback';
import { emitToast } from '../../lib/toast';
import { useConversationScope } from './useConversationScope';
import type { RunAuthorAgent } from './types';
import type { ChatWindowState } from './useChatWindowState';
import {
  parseRevisionBatchCommand,
  resolveRevisionChapters,
  revisionChapterPrompt,
  runRevisionBatchLoop,
  type RevisionBatchRequest,
} from './revision-batch';

export type RevisionBatchView = {
  phase: 'loading' | 'confirming' | 'running' | 'waiting' | 'completed' | 'stopped';
  request: RevisionBatchRequest | null;
  chapters: ManuscriptChapter[];
  completed: number;
  current: number | null;
  message: string;
};
type Task = {
  project: string;
  scope: number;
  current: () => boolean;
  request: RevisionBatchRequest;
  chapters: ManuscriptChapter[];
  completed: number;
  runId: string | null;
  abort: AbortController;
  permission: AgentPermissionProfile;
  started: boolean;
  inFlight: boolean;
};
const key = (p: string) => p.replace(/\\/g, '/').toLowerCase();
async function chaptersOf(project: string): Promise<ManuscriptChapter[]> {
  const result = await executeIdeCommand('book.context', { project_root: project });
  const snapshot = mapBookContextPayload(
    (result.payload as { book_context?: unknown } | undefined)?.book_context,
  );
  if (!snapshot) throw new Error('无法读取章节列表，请刷新作品后重试。');
  return snapshot.chapters;
}

export function useRevisionBatch({
  state,
  runAuthorAgent,
  projectPath,
  assistantSessionId,
  permissionProfile,
}: {
  state: ChatWindowState;
  runAuthorAgent: RunAuthorAgent;
  projectPath: string | null;
  assistantSessionId: number | null;
  permissionProfile: AgentPermissionProfile;
}) {
  const { scope, isCurrentScope } = useConversationScope(projectPath, assistantSessionId, state);
  const latest = useRef({ state, runAuthorAgent, permissionProfile });
  useLayoutEffect(() => {
    latest.current = { state, runAuthorAgent, permissionProfile };
  });
  const taskRef = useRef<Task | null>(null);
  const offerRef = useRef<object | null>(null);
  const [owned, setOwned] = useState<{ scope: number; view: RevisionBatchView } | null>(null);
  const view = owned?.scope === scope ? owned.view : null;
  const show = useCallback(
    (
      task: Task,
      phase: RevisionBatchView['phase'],
      message: string,
      current: number | null = null,
    ) => {
      if (!task.current() || taskRef.current !== task) return;
      setOwned({
        scope: task.scope,
        view: {
          phase,
          request: task.request,
          chapters: task.chapters,
          completed: task.completed,
          current,
          message,
        },
      });
    },
    [],
  );
  const abandon = useCallback((task: Task | null) => {
    if (!task) return;
    task.abort.abort();
    if (task.runId && task.inFlight)
      void sendAgentControlMessage({
        sessionId: task.runId,
        runId: task.runId,
        type: 'stop_run',
        payload: { source: 'desktop.revision-batch' },
      }).catch(() => undefined);
  }, []);
  useLayoutEffect(
    () => () => {
      offerRef.current = null;
      abandon(taskRef.current);
      taskRef.current = null;
    },
    [scope, abandon],
  );
  const stop = useCallback(
    (message = '连续修改已停止；已保存的章节保留，尚未接受的修订仍可单独处理。') => {
      const task = taskRef.current;
      if (!task) return;
      show(task, 'stopped', message);
      abandon(task);
      taskRef.current = null;
    },
    [abandon, show],
  );
  useLayoutEffect(() => {
    const task = taskRef.current;
    if (task?.started && task.permission !== permissionProfile)
      stop('作品权限已变化，连续修改已停止。');
  }, [permissionProfile, stop]);
  useEffect(() => {
    const reject = (event: Event) => {
      const result = (event as CustomEvent<PatchRejection>).detail;
      const task = taskRef.current;
      if (task?.started && result?.runId === task.runId && result.projectPath === task.project)
        stop('本章修订已拒绝，后续章节未启动。');
    };
    window.addEventListener(PATCH_REJECTED_EVENT, reject);
    return () => window.removeEventListener(PATCH_REJECTED_EVENT, reject);
  }, [stop]);

  const offer = useCallback(
    (instruction: string): boolean => {
      const command = parseRevisionBatchCommand(instruction);
      if (!command) return false;
      const token = {};
      offerRef.current = token;
      if (taskRef.current?.started) return true;
      abandon(taskRef.current);
      taskRef.current = null;
      if (command.kind === 'invalid' || !projectPath || permissionProfile === 'read') {
        setOwned({
          scope,
          view: {
            phase: 'stopped',
            request: null,
            chapters: [],
            completed: 0,
            current: null,
            message:
              command.kind === 'invalid'
                ? command.message
                : '请先打开作品，并将权限改为询问或自动。',
          },
        });
        return true;
      }
      const task: Task = {
        project: projectPath,
        scope,
        current: isCurrentScope,
        request: command.request,
        chapters: [],
        completed: 0,
        runId: null,
        abort: new AbortController(),
        permission: permissionProfile,
        started: false,
        inFlight: false,
      };
      taskRef.current = task;
      show(task, 'loading', '正在核对目标章节…');
      void chaptersOf(projectPath)
        .then((chapters) => {
          if (!task.current() || taskRef.current !== task || offerRef.current !== token) return;
          task.chapters = resolveRevisionChapters(task.request, chapters);
          show(task, 'confirming', '确认范围和统一要求后开始。');
        })
        .catch((error: unknown) => {
          if (task.current() && taskRef.current === task) {
            show(task, 'stopped', error instanceof Error ? error.message : String(error));
            taskRef.current = null;
          }
        });
      return true;
    },
    [abandon, isCurrentScope, permissionProfile, projectPath, scope, show],
  );

  const start = useCallback(() => {
    const task = taskRef.current;
    const live = latest.current;
    if (!task || task.started || !task.current() || !task.chapters.length) return;
    if (
      live.state.agentBusy ||
      live.state.agentRun?.deliveryUnknown ||
      live.state.chapterBrief ||
      ['waiting', 'paused'].includes(live.state.agentRun?.status ?? '')
    ) {
      emitToast('请先处理当前待确认内容，再开始连续修改。', { tone: 'info' });
      return;
    }
    if (live.permissionProfile === 'read') {
      stop('当前是只读档，连续修改未启动。');
      return;
    }
    task.started = true;
    show(task, 'running', '正在核对目标章节…');
    task.permission = live.permissionProfile;
    const alive = () => taskRef.current === task && task.current() && !task.abort.signal.aborted;
    void runRevisionBatchLoop({
      chapters: task.chapters,
      alive,
      validate: async () => {
        if (latest.current.permissionProfile !== task.permission)
          throw new Error('作品权限已变化，连续修改已停止。');
        const targets = resolveRevisionChapters(task.request, await chaptersOf(task.project));
        if (
          targets.some(
            (chapter, index) => chapter.relativePath !== task.chapters[index].relativePath,
          )
        )
          throw new Error('章节路径发生变化，连续修改已停止。');
      },
      dispatch: async (chapter, index) => {
        const live = latest.current;
        const goal = revisionChapterPrompt(task.request, chapter, index, task.chapters.length);
        live.state.setMessages((messages) => [...messages, { role: 'user', content: goal }]);
        const previous = live.state.agentRunIdRef.current;
        task.inFlight = true;
        const result = live.runAuthorAgent(goal, 'agent', 'file.revise', [], {
          revisionTargetFilePath: chapter.relativePath,
          revisionAbortSignal: task.abort.signal,
        });
        const started = live.state.agentRunIdRef.current;
        task.runId = started && started !== previous ? started : null;
        try {
          const outcome = await result;
          if (outcome.kind !== 'not_dispatched') task.runId = outcome.runId;
          return outcome;
        } finally {
          task.inFlight = false;
        }
      },
      awaitWriteback: (runId) =>
        awaitChapterWriteback(runId, { timeoutMs: 24 * 60 * 60 * 1000, signal: task.abort.signal }),
      matchesTarget: (path, chapter) =>
        key(relativePathInsideProject(task.project, path) ?? '') === key(chapter.relativePath),
      progress: (phase, index) =>
        show(
          task,
          phase,
          phase === 'running'
            ? '正在修改第 ' + task.chapters[index].ordinal + ' 章'
            : '等待第 ' + task.chapters[index].ordinal + ' 章接受并保存；保存成功后继续下一章。',
          task.chapters[index].ordinal,
        ),
      saved: (_chapter, index) => {
        task.completed = index + 1;
        task.runId = null;
      },
    })
      .then(() => {
        if (alive()) {
          show(task, 'completed', '所选 ' + task.completed + ' 章已逐章修改并保存。');
          taskRef.current = null;
        }
      })
      .catch((error: unknown) => {
        if (alive()) {
          show(task, 'stopped', error instanceof Error ? error.message : String(error));
          taskRef.current = null;
        }
      });
  }, [show, stop]);
  const close = useCallback(() => {
    if (taskRef.current?.started) return;
    offerRef.current = null;
    abandon(taskRef.current);
    taskRef.current = null;
    setOwned(null);
  }, [abandon]);
  return {
    view,
    offer,
    start,
    stop: () => stop(),
    close,
    occupied: view?.phase === 'running' || view?.phase === 'waiting',
    confirming: view?.phase === 'loading' || view?.phase === 'confirming',
  };
}
export type RevisionBatchScheduler = ReturnType<typeof useRevisionBatch>;
