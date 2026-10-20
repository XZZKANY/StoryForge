/**
 * 全项目审计 G-03：真实模型探针只核隔离与密钥，业务步骤全失败也汇总成 passed。
 * 业务判定拆成纯函数，在这里钉住：任一步失败或被跳过都要报出来。
 */
import { expect, it } from 'vitest';
import { realBusinessFailures } from '../scripts/real-probe-verdict.mjs';

const ok = { result: { ok: true, message: {} } };
const failed = (error: string) => ({ result: { ok: false, error } });

const agentPassed = {
  write: ok,
  brief: { briefId: 'b' },
  confirm: { ok: true },
  patch: { after: '第三章' },
  writeback: { ok: true },
  review: ok,
  revise: ok,
};

it('全部走通才没有未达成的步骤', () => {
  expect(
    realBusinessFailures({
      real: {
        ctrlK: { revise: { ok: true } },
        continuation: { continued: { ok: true } },
      },
      agentReal: agentPassed,
    }),
  ).toEqual([]);
  expect(realBusinessFailures({})).toEqual([]);
});

it('行间修订与续写都失败：两步都报出来', () => {
  expect(
    realBusinessFailures({
      real: {
        ctrlK: { revise: { ok: false, error: 'HTTP 504' } },
        continuation: { continued: { ok: false, error: '上游超时' } },
      },
    }),
  ).toEqual(['行间修订：HTTP 504', '光标处续写：上游超时']);
});

it('起草失败、没有补丁、写回被跳过：每一步都算没达成', () => {
  const unmet = realBusinessFailures({
    agentReal: {
      write: failed('模型拒绝'),
      brief: null,
      confirm: null,
      patch: null,
      writeback: null,
      review: failed('HTTP 500'),
      revise: ok,
    },
  });
  expect(unmet).toEqual([
    '起草出章纲：模型拒绝',
    '确认章纲后起草：没有走到',
    '产出补丁：没有走到',
    '写回：没有走到',
    '审稿：HTTP 500',
  ]);
});

it('只差写回失败也不算通过', () => {
  expect(
    realBusinessFailures({
      agentReal: { ...agentPassed, writeback: { ok: false, error: '磁盘内容已变化' } },
    }),
  ).toEqual(['写回：磁盘内容已变化']);
});
