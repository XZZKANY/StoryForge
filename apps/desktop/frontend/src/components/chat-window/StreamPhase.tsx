import type { Message } from './types';

type Phase = NonNullable<Message['stream']>['phase'];

const PHASE_TEXT: Record<Phase, string> = {
  waiting: '等待正文输出…',
  streaming: '正在输出…',
  working: '等待下一步…',
  unknown: '连接或内容不完整，等待核对结果',
  interrupted: '回复未完成',
  complete: '',
};

function Dots({ phase }: { phase: 'waiting' | 'working' }) {
  return (
    <span
      className={
        phase === 'working' ? 'sf-thinking-dots sf-thinking-dots--idle' : 'sf-thinking-dots'
      }
      aria-hidden="true"
      data-testid="stream-indicator"
      data-phase={phase}
    >
      <span />
      <span />
      <span />
    </span>
  );
}

/**
 * 回答区的进行中提示。等首字时是一排跳动的点，模型转去调工具时点停下来；输出中由文末的
 * 小圆点代替（见 AssistantMarkdown），这三种只给读屏留文字。连接不完整、回复被打断
 * 这类作者需要知道的情况才写出来。
 */
export function StreamPhase({ phase }: { phase: Phase }) {
  const quiet = phase === 'waiting' || phase === 'streaming' || phase === 'working';
  return (
    <div
      className={
        phase === 'streaming' ? 'sr-only' : 'mt-2 flex items-center gap-2 text-xs text-muted'
      }
      data-testid="stream-phase"
      role="status"
    >
      {(phase === 'waiting' || phase === 'working') && <Dots phase={phase} />}
      <span className={quiet ? 'sr-only' : undefined}>{PHASE_TEXT[phase]}</span>
    </div>
  );
}
