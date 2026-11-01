import type { Dispatch, SetStateAction } from 'react';

import type { BookProfileHandle } from '../app/useBookProfile';
import { Check, Pencil, X } from '../icons/shell-icons';
import { PlainButton, revealOnHover } from '../ui';

export type EditingNote = { line: number; original: string; text: string };

// 作品视图「灵感速记」分区的内容：记一条存进 灵感.md，勾掉、改、删。
export function BookNotesBody({
  handle,
  noteDraft,
  setNoteDraft,
  addNote,
  editingNote,
  setEditingNote,
}: {
  handle: BookProfileHandle;
  noteDraft: string;
  setNoteDraft: Dispatch<SetStateAction<string>>;
  addNote: () => void;
  editingNote: EditingNote | null;
  setEditingNote: Dispatch<SetStateAction<EditingNote | null>>;
}) {
  return (
    <>
      <div className="px-3">
        <input
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              addNote();
            }
          }}
          placeholder="记一条，回车存进 灵感.md"
          className="sf-input w-full rounded-sm border border-border bg-panel px-2 py-1 text-2xs text-foreground placeholder:text-subtle"
          data-testid="book-note-input"
        />
      </div>
      {handle.notes.length > 0 && (
        <ul className="mt-1" data-testid="book-note-list">
          {handle.notes.map((note) => (
            <li
              key={note.line}
              className="group flex items-start gap-1.5 px-3 py-0.5 hover:bg-elevated"
              data-testid="book-note-row"
              data-done={note.done}
            >
              {editingNote?.line === note.line && editingNote.original === note.text ? (
                <input
                  autoFocus
                  className="sf-input min-w-0 flex-1 rounded-sm border border-border-strong bg-background px-1.5 py-0.5 text-2xs text-foreground outline-none"
                  aria-label="改这条速记"
                  value={editingNote.text}
                  onChange={(event) => setEditingNote({ ...editingNote, text: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'Escape') setEditingNote(null);
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    event.currentTarget.blur();
                  }}
                  onBlur={() => {
                    const draft = editingNote;
                    setEditingNote(null);
                    if (draft && draft.text.trim() && draft.text.trim() !== note.text)
                      void handle
                        .editNote(note, draft.text)
                        .catch(() => false)
                        .then((saved) => {
                          // 没存进去：改到一半的字放回编辑框（那一条还在原处时才显示），不让作者重敲。
                          if (!saved) setEditingNote((current) => current ?? draft);
                        });
                  }}
                  data-testid="book-note-edit-input"
                />
              ) : (
                <PlainButton
                  className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
                  title={note.done ? '标记为未完成' : '标记为已完成'}
                  aria-label={note.done ? '标记为未完成' : '标记为已完成'}
                  aria-pressed={note.done}
                  onClick={() => void handle.toggleNote(note)}
                >
                  <span
                    className={`mt-px grid h-4 w-4 flex-shrink-0 place-items-center rounded-xs border ${
                      note.done ? 'border-muted text-muted' : 'border-border text-transparent'
                    } hover:border-muted`}
                  >
                    <Check size={11} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span
                    className={`min-w-0 flex-1 break-words text-2xs leading-snug ${
                      note.done ? 'text-subtle line-through' : 'text-muted'
                    }`}
                  >
                    {note.text}
                  </span>
                </PlainButton>
              )}
              <PlainButton
                className={`mt-[2px] flex-shrink-0 text-subtle hover:text-foreground ${revealOnHover('faint')}`}
                title="改这条"
                aria-label={`改速记 ${note.text}`}
                onClick={() =>
                  setEditingNote({ line: note.line, original: note.text, text: note.text })
                }
                data-testid="book-note-edit"
              >
                <Pencil size={11} strokeWidth={2} />
              </PlainButton>
              <PlainButton
                className={`mt-[2px] flex-shrink-0 text-subtle hover:text-foreground ${revealOnHover('faint')}`}
                title="删除这条"
                aria-label={`删除速记 ${note.text}`}
                onClick={() => void handle.removeNote(note)}
              >
                <X size={11} strokeWidth={2} />
              </PlainButton>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
