import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { currentMonacoTheme } from '../../lib/theme';
import { proseReadingTypography, STORYFORGE_EDITOR_UNICODE_HIGHLIGHT } from './options';

// 补丁审阅面板的只读内联对比编辑器。
export function usePatchDiffEditor({
  suggestion,
  editorFontSize,
  editorFontFamily,
  expanded,
}: {
  suggestion: AssistantFileSuggestion;
  editorFontSize: number;
  editorFontFamily: string;
  expanded: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
  // 差异是异步算出来的：算完那一刻再停到第一处改动；挂载时与换了新补丁时各等一次。
  const revealPendingRef = useRef(true);

  // 挂载期创建只读内联 diff 编辑器；suggestion 变化时只更新 model 内容，不销毁重建（保留滚动位置）。
  useEffect(() => {
    if (!containerRef.current) return;
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      renderSideBySide: false,
      automaticLayout: true,
      theme: currentMonacoTheme(),
      minimap: { enabled: false },
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      lineNumbers: 'off',
      folding: false,
      ...proseReadingTypography(editorFontSize, editorFontFamily),
      unicodeHighlight: STORYFORGE_EDITOR_UNICODE_HIGHLIGHT,
    });
    // 定位不到的分块仍按原始行号指路（「第 N 处 · 第 X 行」），original 侧给出行号做定位锚；
    // modified 侧行号对指路没有用处，保持关闭省一点宽度。
    diffEditor.getOriginalEditor().updateOptions({ lineNumbers: 'on' });
    const original = monaco.editor.createModel(suggestion.before, 'markdown');
    const modified = monaco.editor.createModel(suggestion.after, 'markdown');
    const revealSubscription = diffEditor.onDidUpdateDiff(() => {
      if (!revealPendingRef.current) return;
      revealPendingRef.current = false;
      diffEditor.revealFirstDiff();
    });
    diffEditor.setModel({ original, modified });
    diffEditorRef.current = diffEditor;
    originalModelRef.current = original;
    modifiedModelRef.current = modified;
    return () => {
      revealSubscription.dispose();
      diffEditor.dispose();
      original.dispose();
      modified.dispose();
      diffEditorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载期一次性创建 diff 编辑器；before/after 后续变化由下方 effect 同步到 model，避免销毁重建
  }, []);

  // 同一面板实例上换了新补丁时，只刷新两个 model 的内容；新补丁（id 变化）等差异重算完再停到
  // 第一处改动——立刻读 getLineChanges 拿到的还是上一版的差异。同一补丁被分块接受局部刷新（id 不变）
  // 则保留位置。
  const lastSuggestionIdRef = useRef(suggestion.id);
  useEffect(() => {
    let changed = false;
    if (originalModelRef.current && originalModelRef.current.getValue() !== suggestion.before) {
      originalModelRef.current.setValue(suggestion.before);
      changed = true;
    }
    if (modifiedModelRef.current && modifiedModelRef.current.getValue() !== suggestion.after) {
      modifiedModelRef.current.setValue(suggestion.after);
      changed = true;
    }
    if (lastSuggestionIdRef.current !== suggestion.id) {
      lastSuggestionIdRef.current = suggestion.id;
      revealPendingRef.current = changed;
      if (!changed) diffEditorRef.current?.revealFirstDiff();
    }
  }, [suggestion.id, suggestion.before, suggestion.after]);

  // 展开/收起改变容器高度后，立即让 Monaco 重新布局。
  useEffect(() => {
    diffEditorRef.current?.layout();
  }, [expanded]);

  // diff 编辑器挂载期一次性创建（保留滚动位置），字号/字体设置变化时 updateOptions 追平。
  useEffect(() => {
    diffEditorRef.current?.updateOptions(proseReadingTypography(editorFontSize, editorFontFamily));
  }, [editorFontSize, editorFontFamily]);
  return { containerRef, diffEditorRef };
}
