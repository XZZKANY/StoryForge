# Desktop Frontend Structure

> S6 navigation. The Desktop shell, the Agent conversation, and the editor are thin containers over responsibility-scoped hooks and views.

## Main Read Order

Read the live Desktop path in this order. The list stays within eight files.

1. `App.tsx` - application wiring and shortcuts.
2. `components/app/AppShell.tsx` - fixed shell layout and component composition.
3. `components/app/useEditorWorkspaceTabs.ts` - preview/open/dirty editor-tab state and destructive-boundary confirmation.
4. `components/app/useProjectCommands.ts` - project/file commands, Canon refresh, smoke loaders, and project-tree invalidation.
5. `components/ChatWindow.tsx` - Agent conversation container.
6. `components/chat-window/useChatSessionContext.ts` - session load, switch, and draft ownership.
7. `components/chat-window/useRunAuthorAgent.ts` - context flush/build and live Agent run orchestration.
8. `components/chat-window/ChatWindowView.tsx` - conversation presentation and controls.

Open `components/app/useAppPreferences.ts`, the remaining `components/chat-window/use*.ts` hooks, and leaf panels only when the main path points to them. Recent additions with their own owners: `components/app/useEditorNavigation.ts` (editor navigation coordination), `components/chat-window/useAgentRunAdmission.ts` (run admission before dispatch), `components/chat-window/useAgentRunReconciliation.ts` (post-resume run reconciliation).

## Editor Read Order

The editor has the same shape. Read it in this order:

1. `components/Editor.tsx` - editor container: creates the shared refs, calls the owners below, renders the panels.
2. `components/editor/useSuggestionWriteback.ts` - AI patch composition; keeps the chat-side window listeners and the returned API.
3. `components/editor/useSuggestionState.ts` - pending patch, action lock, and truncated-accept arming.
4. `components/editor/useGuardedSuggestionWrite.ts` - guarded write-back for every accepted patch.
5. `components/editor/useInlineChat.ts` - Ctrl+K / Ctrl+Shift+K entry and lifecycle; the session, diff, and request phases live in `useInlineSession.ts`, `useInlineDiff.ts`, and `useInlineRequest.ts`.
6. `components/editor/useEditorSave.ts` - manual and auto save through the write-back queue.

Open the other owners only when the path points to them: `useSuggestionIntake.ts` (patch intake, buffer, recovery journal), `useWholeSuggestionAccept.ts`, `useHunkSuggestionAccept.ts`, `useSuggestionUndo.ts`, `useSuggestionDismissal.ts`, `useReviewIssueMarkers.ts`, `useEditorCursorSync.ts`, `useEditorWindowCommands.ts`, `useVersionRestore.ts`. Helpers without React: `suggestion-op-state.ts`, `inline-chat-session.ts`, `inline-chat-dom.ts`.

## Ownership Boundaries

- `App.tsx` wires owners together. Do not grow project, editor, preference, or Agent workflow logic back into it.
- `AppShell.tsx` renders props and preserves mount boundaries. Collapsing the Agent panel hides the mounted `ChatWindow`; opening settings hides the mounted `Editor`.
- `useEditorWorkspaceTabs.ts` is the single owner of `openFiles`, `previewFile`, and `dirtyFiles`. File switching never discards a dirty buffer; close/project-leave paths confirm first.
- `useProjectCommands.ts` owns explicit local project mutations and deterministic Canon refresh. It must continue to use project-scoped filesystem APIs.
- `useAppPreferences.ts` owns persisted settings and provider/model optimistic rollback ordering.
- `ChatWindow.tsx` composes conversation hooks. Session state, streaming events, run control, recovery, submission, and rendering stay in their named owners.
- `Editor.tsx` and `useSuggestionWriteback.ts` / `useInlineChat.ts` compose editor owners. They pass the same ref and setter objects down and call the owners in the original order, because hook order is effect registration order.
- `useSuggestionState.ts` is the single owner of the pending patch, the action lock, and truncated-accept arming; the other suggestion owners change them only through what it returns.
- `useGuardedSuggestionWrite.ts` is the only path that writes an accepted patch (read-only derived paths refused, pre-write snapshot, branch head, receipted atomic write, version record). Whole and hunk accept, undo, and inline chat all call it.
- `useInlineSession.ts` owns the inline session and its teardown; the diff and request phases act only on a session that still qualifies.

## Product Guardrails

- Manuscript truth remains in local project files.
- Agent reads flush the active editor before building context (fail-closed save handshake; a failed/timed-out flush rejects and blocks the read).
- Agent write tools produce proposed artifacts only; accepted write-back is permission-aware: `read`/`ask` profiles require explicit confirmation, `auto`/`full` may skip the click, but every profile still goes through guarded write-back (pre-write snapshot → atomic conditional write → version record). The backend never writes manuscript files directly.
- Session changes and layout collapse must not strand an active run or leak events into another conversation.

## Size Gates

- `App.tsx` must remain at or below 400 lines.
- `ChatWindow.tsx`, `Editor.tsx`, and every owner listed in `tests/source-standards.test.ts` must remain at or below 500 lines, as must every file under `components/app`, `components/chat-window`, and `components/editor` (except the frozen `chat-window/panels.tsx`).
- Static layout/ownership tests must move with the owner file rather than silently continuing to inspect an emptied facade.
