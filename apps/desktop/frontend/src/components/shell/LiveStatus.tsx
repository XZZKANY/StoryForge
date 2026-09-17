/**
 * 常驻、视觉隐藏的 live region：给「异步状态变化」一个稳定、可被屏幕阅读器感知的出口。
 *
 * 用法契约（这是「相位级」而非「逐帧级」播报的约定，别破坏）：
 *  - **常驻挂载**——永远渲染，文本变就播报；不要把整条 <LiveStatus> 塞进条件分支
 *    （挂上/摘下的瞬间有的读屏不念）。
 *  - **文案分相位，不在同相位内抖**——同一状态阶段里细节再怎么变都保持同一句恒定文本，
 *    只在相位切换（运行 → 等待 → 终态）时换文案，避免长程任务每一步都吵一遍。
 *  - **可见文案留给别的元素**——这里只做 sr-only 语义播报，不替代可见的状态行，
 *    避免见字又听字的重复。
 *
 * 默认 polite（状态变化，不打断）；error 时用 assertive/role="alert"（失败要打断）。
 */
export function LiveStatus({
  text,
  testid,
  tone = 'polite',
}: {
  text: string;
  testid: string;
  /** polite（默认，状态）或 assertive（失败打断）。 */
  tone?: 'polite' | 'assertive';
}) {
  return (
    <p
      role={tone === 'assertive' ? 'alert' : 'status'}
      aria-live={tone}
      className="sr-only"
      data-testid={testid}
    >
      {text}
    </p>
  );
}
