import { useCallback } from 'react';

import { emitPatchRejected, replacePendingFileSuggestion } from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { TauriFileSystem } from '../../lib/tauri-fs';
import type { SuggestionIntake } from './useSuggestionIntake';
import type { SuggestionState, UseSuggestionWritebackParams } from './useSuggestionState';

// 不写正文的三条出口：存旁注、重试、拒绝。新建的目标文件还空着时顺手摘掉那个页签。

export function useSuggestionDismissal(
  { editorRef, modelCacheRef, projectPathRef }: UseSuggestionWritebackParams,
  {
    setSuggestionStatus,
    pendingSuggestionRef,
    dropOpenFilePathRef,
    updatePendingSuggestion,
    beginAction,
    isCurrentAction,
    failAction,
    finishAction,
  }: SuggestionState,
  { forgetSuggestionRecovery }: Pick<SuggestionIntake, 'forgetSuggestionRecovery'>,
) {
  // 在首个 await 前锁定预览身份；拒绝和保存旁注都不该留下不存在的空文件页签。
  const prepareEmptyTargetRetirement = useCallback(
    (actionToken: symbol, suggestion: AssistantFileSuggestion) => {
      const project = projectPathRef.current;
      const targetState = modelCacheRef.current.get(suggestion.filePath);
      const targetModel = targetState?.model;
      const version =
        targetState?.diskBaseline.kind === 'missing' ? targetModel?.getVersionId() : undefined;
      const unchanged = () =>
        isCurrentAction(actionToken) &&
        modelCacheRef.current.get(suggestion.filePath) === targetState &&
        targetState?.diskBaseline.kind === 'missing' &&
        targetState.originalContent === '' &&
        targetModel !== undefined &&
        editorRef.current?.getModel() === targetModel &&
        !targetModel.isDisposed() &&
        targetModel.getVersionId() === version &&
        targetModel.getValue() === '';
      return async () =>
        project !== null &&
        unchanged() &&
        !(await TauriFileSystem.projectPathExists(project, suggestion.filePath)) &&
        unchanged();
    },
    [editorRef, isCurrentAction, modelCacheRef, projectPathRef],
  );

  const handleSaveSuggestionNote = useCallback(async () => {
    const suggestion = pendingSuggestionRef.current;
    const project = projectPathRef.current;
    if (!suggestion || !project) return;

    const actionToken = beginAction('note', suggestion);
    if (!actionToken) return;
    const canRetireEmptyTarget = prepareEmptyTargetRetirement(actionToken, suggestion);

    try {
      const separator = project.includes('\\') ? '\\' : '/';
      const fileName = suggestion.filePath.split(/[/\\]/).pop() ?? 'file';
      const notePath = [
        project.replace(/[/\\]+$/, ''),
        '.storyforge',
        'notes',
        `${Date.now()}-${fileName}.md`,
      ].join(separator);
      const note = [
        `# ${suggestion.title}`,
        '',
        `- 文件：${suggestion.filePath}`,
        `- 时间：${new Date(suggestion.createdAt).toISOString()}`,
        '',
        '## 摘要',
        '',
        suggestion.summary,
        '',
        '## 旁注',
        '',
        suggestion.note,
        '',
        '## 当前内容摘录',
        '',
        '```markdown',
        suggestion.before.slice(0, 2000),
        suggestion.before.length > 2000 ? '...' : '',
        '```',
        '',
        '## 建议后摘录',
        '',
        '```markdown',
        suggestion.after.slice(0, 2000),
        suggestion.after.length > 2000 ? '...' : '',
        '```',
      ].join('\n');
      await TauriFileSystem.writeFile(project, notePath, note);
      const runStatus = await forgetSuggestionRecovery(suggestion);
      if (!runStatus) return;
      const retireEmptyTarget = await canRetireEmptyTarget();
      replacePendingFileSuggestion(suggestion, null);
      if (!isCurrentAction(actionToken)) return;
      updatePendingSuggestion(null);
      setSuggestionStatus(`已保存旁注: ${notePath}`, 'success');
      if (retireEmptyTarget) dropOpenFilePathRef.current?.(suggestion.filePath);
      emitPatchRejected({
        filePath: suggestion.filePath,
        patchId: suggestion.id,
        direction: '',
        runId: suggestion.runId,
        projectPath: project,
        assistantSessionId: suggestion.assistantSessionId,
        runStatus: typeof runStatus === 'string' ? runStatus : undefined,
      });
    } catch (err) {
      failAction(
        actionToken,
        `保存旁注失败: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      finishAction(actionToken);
    }
  }, [
    beginAction,
    failAction,
    finishAction,
    forgetSuggestionRecovery,
    isCurrentAction,
    prepareEmptyTargetRetirement,
    projectPathRef,
    setSuggestionStatus,
    updatePendingSuggestion,
    dropOpenFilePathRef,
    pendingSuggestionRef,
  ]);

  const handleRetrySuggestion = useCallback(
    async (retry: () => Promise<void>) => {
      const suggestion = pendingSuggestionRef.current;
      if (!suggestion) return;
      const token = beginAction('retry', suggestion);
      if (!token) return;
      try {
        await retry();
      } catch (error) {
        failAction(
          token,
          `重试失败: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      } finally {
        finishAction(token);
      }
    },
    [beginAction, failAction, finishAction, pendingSuggestionRef],
  );

  /**
   * 拒绝不是二元否决：作者往往知道该怎么改，只是这版没改对。
   *
   * direction 非空时由 ChatWindow 侧接住，当作一句真实的作者发言发出去——落进会话、
   * 自动进下一轮 prompt、顺带重做一版；留空则维持轻量否决，不烧新一轮 BYO-key。
   * 无论哪条路径，都不写正文；先关闭恢复 journal，再清面板并广播拒绝。
   */
  const rejectPendingSuggestion = useCallback(
    async (direction = ''): Promise<boolean> => {
      const suggestion = pendingSuggestionRef.current;
      const trimmed = direction.trim();
      let runStatus: 'completed' | 'failed' | undefined;
      let retireEmptyTarget = false;
      const project = projectPathRef.current;
      if (suggestion) {
        const actionToken = beginAction('reject', suggestion);
        if (!actionToken) return false;
        const canRetireEmptyTarget = prepareEmptyTargetRetirement(actionToken, suggestion);
        try {
          const forgotten = await forgetSuggestionRecovery(suggestion);
          if (!isCurrentAction(actionToken) || !forgotten) return false;
          runStatus = typeof forgotten === 'string' ? forgotten : undefined;
          retireEmptyTarget = await canRetireEmptyTarget();
          if (!isCurrentAction(actionToken)) return false;
        } catch (error) {
          failAction(
            actionToken,
            `拒绝尚未完成: ${error instanceof Error ? error.message : String(error)}`,
            error,
          );
          return false;
        } finally {
          finishAction(actionToken);
        }
      }
      updatePendingSuggestion(null);
      setSuggestionStatus(trimmed ? '已否掉这版，正按你的说法重来' : '已拒绝修订');
      if (suggestion) {
        if (retireEmptyTarget) dropOpenFilePathRef.current?.(suggestion.filePath);
        emitPatchRejected({
          filePath: suggestion.filePath,
          patchId: suggestion.id,
          direction: trimmed,
          ...(suggestion.runId
            ? {
                runId: suggestion.runId,
                projectPath: project,
                assistantSessionId: suggestion.assistantSessionId,
                runStatus,
              }
            : {}),
        });
      }
      return true;
    },
    [
      beginAction,
      failAction,
      prepareEmptyTargetRetirement,
      projectPathRef,
      finishAction,
      forgetSuggestionRecovery,
      isCurrentAction,
      pendingSuggestionRef,
      setSuggestionStatus,
      updatePendingSuggestion,
      dropOpenFilePathRef,
    ],
  );

  return { handleSaveSuggestionNote, handleRetrySuggestion, rejectPendingSuggestion };
}
