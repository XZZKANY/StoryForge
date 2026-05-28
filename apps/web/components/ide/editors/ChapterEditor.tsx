'use client';

import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { useEffect, useRef } from 'react';

import type { Diagnostic } from '../../../../../packages/shared/src/diagnostic';
import { createJudgeIssueDecorations } from './extensions/judgeIssueDecorations';

export type ChapterEditorProps = {
  readonly content: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly onChange: (content: string) => void;
};

export function ChapterEditor({ content, diagnostics, onChange }: ChapterEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const decorations = createJudgeIssueDecorations(diagnostics);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          markdown(),
          keymap.of(defaultKeymap),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [content, onChange]);

  return (
    <section
      aria-label="章节编辑器"
      className="grid gap-3"
      data-testid="chapter-editor"
      data-editor-engine="codemirror6"
    >
      <div
        ref={hostRef}
        className="min-h-80 rounded border border-stone-700 bg-stone-950 p-3 text-stone-100"
        role="textbox"
        aria-label="章节 Markdown 内容"
        aria-multiline="true"
      >
        <noscript>{content}</noscript>
      </div>
      <p className="text-xs text-stone-400">诊断装饰数量：{decorations.length}</p>
    </section>
  );
}
