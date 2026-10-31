import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type * as monaco from 'monaco-editor';

import { REVIEW_ISSUES_EVENT, type ReviewIssueMarker } from '../../lib/assistant-events';
import { issueDecorationOptions, locateEvidence } from './decorations';

export function useReviewIssueMarkers({
  editorRef,
  editorReady,
  filePathRef,
  issueDecorationsRef,
  loadedFilePath,
}: {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  filePathRef: MutableRefObject<string | null>;
  editorReady: boolean;
  issueDecorationsRef: MutableRefObject<monaco.editor.IEditorDecorationsCollection | null>;
  loadedFilePath: string | null;
}) {
  // 留存当前审稿 issue，供内容变化后按 evidence 重新校验、移除已改好的标记（E18）。
  const reviewIssuesRef = useRef<ReviewIssueMarker[]>([]);

  const applyIssueDecorations = useCallback((issues: ReviewIssueMarker[]) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const issue of issues) {
      const range = locateEvidence(model, issue.evidence);
      if (!range) continue;
      decorations.push({ range, options: issueDecorationOptions(issue) });
    }
    if (issueDecorationsRef.current) {
      issueDecorationsRef.current.set(decorations);
    } else {
      issueDecorationsRef.current = editor.createDecorationsCollection(decorations);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖数组照拆分前原样；漏列的是上层传入、身份不变的 ref / setter
  }, []);

  // 审稿完成后把 issues 标进正文：gutter 圆点 + 词级下划线 + hover 显示问题与建议。
  useEffect(() => {
    const onIssues = (event: Event) => {
      const detail = (event as CustomEvent<{ filePath: string; issues: ReviewIssueMarker[] }>)
        .detail;
      if (!detail || detail.filePath !== filePathRef.current) return;
      reviewIssuesRef.current = detail.issues;
      applyIssueDecorations(detail.issues);
    };
    window.addEventListener(REVIEW_ISSUES_EVENT, onIssues);
    return () => window.removeEventListener(REVIEW_ISSUES_EVENT, onIssues);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖数组照拆分前原样；漏列的是上层传入、身份不变的 ref / setter
  }, [applyIssueDecorations]);

  // 切文件清留存 issue：避免内容变化重校验把旧文件的 issue 误标进新文件（decorations 由加载器清）。
  useEffect(() => {
    reviewIssuesRef.current = [];
  }, [loadedFilePath]);

  // E18：作者改掉问题文字后，去抖重跑 locateEvidence——失配的 issue 在 applyIssueDecorations 里被跳过即消失，
  // 不必等重审 / 切文件。stub 无 onDidChangeModelContent，typeof 守卫。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor || typeof editor.onDidChangeModelContent !== 'function') return;
    let timer: number | null = null;
    const subscription = editor.onDidChangeModelContent(() => {
      if (reviewIssuesRef.current.length === 0) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => applyIssueDecorations(reviewIssuesRef.current), 400);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      subscription.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖数组照拆分前原样；漏列的是上层传入、身份不变的 ref / setter
  }, [editorReady, applyIssueDecorations]);
}
