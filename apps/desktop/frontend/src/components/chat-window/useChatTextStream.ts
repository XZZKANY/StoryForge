import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AgentTextFrame } from '../../lib/api/agent-text-stream';
import type { AgentRunStatus, AgentTextSettlement, Message } from './types';

type Phase = NonNullable<Message['stream']>['phase'];
type Draft = {
  runId: string;
  active: () => boolean;
  streamId: string | null;
  round: number;
  sequence: number;
  text: string;
  phase: Phase;
  accepting: boolean;
};

/**
 * Reuse the trailing stream message node across frames. Only identity text/phase changes
 * rebuild the array, and the untouched prefix keeps reference so memoized history does not
 * re-render; an unchanged frame skips setMessages entirely.
 */
function replaceTrailingStream(
  messages: Message[],
  runId: string,
  content: string,
  phase: Phase,
): Message[] {
  const id = 'stream:' + runId;
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) {
    return [...messages, { id, role: 'assistant', content, stream: { runId, phase } }];
  }
  const previous = messages[index];
  // A settled stream message is terminal; live frames must not resurrect it.
  if (previous.stream?.phase === 'complete' || previous.stream?.phase === 'interrupted')
    return messages;
  if (previous.content === content && previous.stream?.phase === phase) return messages;
  const item: Message = { ...previous, content, stream: { runId, phase } };
  return index === messages.length - 1
    ? [...messages.slice(0, index), item]
    : messages.map((message, i) => (i === index ? item : message));
}

/** A transient display projection. Only existing result owners may settle it. */
export function useChatTextStream(setMessages: Dispatch<SetStateAction<Message[]>>) {
  const draft = useRef<Draft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const revision = useRef(0);

  const stream = useMemo(() => {
    const cancelTimer = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const render = (current: Draft) => {
      const text = current.text;
      const phase = current.phase;
      setMessages((messages) => replaceTrailingStream(messages, current.runId, text, phase));
    };
    const flush = () => {
      cancelTimer();
      const current = draft.current;
      if (current && alive.current && current.active()) render(current);
    };
    return {
      begin(runId: string, active: () => boolean) {
        revision.current += 1;
        cancelTimer();
        draft.current = {
          runId,
          active,
          streamId: null,
          round: 0,
          sequence: 0,
          text: '',
          phase: 'waiting',
          accepting: true,
        };
      },
      accept(frame: AgentTextFrame) {
        const current = draft.current;
        if (
          !alive.current ||
          !current ||
          !current.accepting ||
          current.runId !== frame.run_id ||
          !current.active()
        )
          return;
        if (frame.type === 'agent_text_stream_started') {
          // Rounds strictly advance; duplicate/recreated same-round starts must not erase text.
          if (frame.round_index <= current.round) return;
          cancelTimer();
          current.streamId = frame.stream_id;
          current.round = frame.round_index;
          current.sequence = 0;
          current.text = '';
          current.phase = 'waiting';
          setMessages((messages) => replaceTrailingStream(messages, current.runId, '', 'waiting'));
          return;
        }
        if (
          frame.stream_id !== current.streamId ||
          frame.round_index !== current.round ||
          frame.chunk_sequence <= current.sequence
        )
          return;
        if (
          frame.chunk_sequence !== current.sequence + 1 ||
          // This display-only cap is UTF-16 units, not the wire's code-point or tool-JSON budget.
          current.text.length + frame.text_delta.length > 1_048_576
        ) {
          current.phase = 'unknown';
          current.accepting = false;
          flush();
          return;
        }
        current.sequence = frame.chunk_sequence;
        const first = current.text.length === 0;
        current.text += frame.text_delta;
        // Late text may complete this preview, but only a new round releases a tool/permission hold.
        if (current.phase === 'waiting') current.phase = 'streaming';
        if (first) flush();
        else if (timer.current === null) timer.current = setTimeout(flush, 40);
      },
      hold(runId: string, phase: Phase, close = true) {
        const current = draft.current;
        if (!current || current.runId !== runId || (!close && !current.accepting)) return;
        cancelTimer();
        current.phase = phase;
        if (close) current.accepting = false;
        render(current);
      },
      settle(
        runId: string | null | undefined,
        settlement: AgentTextSettlement,
        status: AgentRunStatus,
        append = true,
      ) {
        revision.current += 1;
        cancelTimer();
        const current = draft.current?.runId === runId ? draft.current : null;
        if (current) {
          current.accepting = false;
          draft.current = null;
        }
        const interrupted = status === 'failed' || status === 'stopped' || status === 'paused';
        const diagnostic = settlement.kind === 'diagnostic';
        const content = diagnostic ? settlement.detail : settlement.content;
        setMessages((messages) => {
          const index = messages.findIndex((message) => runId && message.stream?.runId === runId);
          if (index < 0) return append ? [...messages, { role: 'assistant', content }] : messages;
          const previous = messages[index];
          const partial = current?.text ?? previous.content;
          const retainPartial = interrupted && !!partial && (diagnostic || !content.trim());
          const nextContent = retainPartial ? partial : content;
          const nextPhase = interrupted ? ('interrupted' as const) : ('complete' as const);
          const nextDetail = retainPartial && diagnostic ? content : undefined;
          // Reuse the node when the visible projection is unchanged after a live settle.
          if (
            previous.content === nextContent &&
            previous.stream?.phase === nextPhase &&
            previous.stream?.detail === nextDetail
          )
            return messages;
          const item: Message = {
            ...previous,
            content: nextContent,
            stream: { runId: runId!, phase: nextPhase, detail: nextDetail },
          };
          return index === messages.length - 1
            ? [...messages.slice(0, index), item]
            : messages.map((message, i) => (i === index ? item : message));
        });
      },
      revision() {
        return revision.current;
      },
      hasPending(runId: string | null) {
        return !!runId && draft.current?.runId === runId;
      },
      reset() {
        revision.current += 1;
        cancelTimer();
        draft.current = null;
      },
    };
  }, [setMessages]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stream.reset();
    };
  }, [stream]);
  return stream;
}
