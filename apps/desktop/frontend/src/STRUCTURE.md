# Desktop Frontend Structure

> S6 navigation. The Desktop shell and Agent conversation are thin containers over responsibility-scoped hooks and views.

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

Open `components/app/useAppPreferences.ts`, the remaining `components/chat-window/use*.ts` hooks, and leaf panels only when the main path points to them.

## Ownership Boundaries

- `App.tsx` wires owners together. Do not grow project, editor, preference, or Agent workflow logic back into it.
- `AppShell.tsx` renders props and preserves mount boundaries. Collapsing the Agent panel hides the mounted `ChatWindow`; opening settings hides the mounted `Editor`.
- `useEditorWorkspaceTabs.ts` is the single owner of `openFiles`, `previewFile`, and `dirtyFiles`. File switching never discards a dirty buffer; close/project-leave paths confirm first.
- `useProjectCommands.ts` owns explicit local project mutations and deterministic Canon refresh. It must continue to use project-scoped filesystem APIs.
- `useAppPreferences.ts` owns persisted settings and provider/model optimistic rollback ordering.
- `ChatWindow.tsx` composes conversation hooks. Session state, streaming events, run control, recovery, submission, and rendering stay in their named owners.

## Product Guardrails

- Manuscript truth remains in local project files.
- Agent reads flush the active editor before building context.
- Agent write tools produce proposed artifacts only; accepted write-back remains a frontend confirmation flow.
- Session changes and layout collapse must not strand an active run or leak events into another conversation.

## Size Gates

- `App.tsx` must remain at or below 400 lines.
- `ChatWindow.tsx` and every S6 owner listed in `tests/test_source_code_standards.py` must remain at or below 500 lines.
- Static layout/ownership tests must move with the owner file rather than silently continuing to inspect an emptied facade.
