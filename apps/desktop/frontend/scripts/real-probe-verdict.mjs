/**
 * 真实模型探针的业务判定：隔离、密钥、正文未被乱改这些断言通过，不等于验收通过。
 * 修订、续写、起草、写回、审稿这些业务步骤任一步失败或被跳过，整次就不算通过（证据照样落盘）。
 */
const reason = (error) => (error ? String(error) : '没有走到');

export function realBusinessFailures({ real, agentReal }) {
  const unmet = [];
  const step = (name, ok, error) => {
    if (!ok) unmet.push(`${name}：${reason(error)}`);
  };
  if (real) {
    step('行间修订', real.ctrlK?.revise?.ok, real.ctrlK?.revise?.error);
    step('光标处续写', real.continuation?.continued?.ok, real.continuation?.continued?.error);
  }
  if (agentReal) {
    step(
      '起草出章纲',
      agentReal.write?.result?.ok && agentReal.brief,
      agentReal.write?.result?.error,
    );
    step('确认章纲后起草', agentReal.confirm?.ok, agentReal.confirm?.error);
    step('产出补丁', agentReal.patch, null);
    step('写回', agentReal.writeback?.ok, agentReal.writeback?.error);
    step('审稿', agentReal.review?.result?.ok, agentReal.review?.result?.error);
    step('修订', agentReal.revise?.result?.ok, agentReal.revise?.result?.error);
  }
  return unmet;
}
