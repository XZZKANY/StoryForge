import { describe, expect, it, vi } from 'vitest';

import { isWholeFileDrifted } from '../../src/lib/patch-hunks';
import { performGuardedWriteback } from '../../src/lib/writeback';

const normalizeEol = (text: string) => text.replace(/\r\n/g, '\n');

// 红线①：before 漂移拒写（可证伪）。isWholeFileDrifted 是 handleAcceptSuggestion 落盘前的
// 唯一漂移守卫；若它对已漂移内容误判为「未漂移」，旧补丁会覆盖作者的新改动。
describe('F27 写回红线①：before 漂移拒写', () => {
  it('磁盘内容与补丁 before 不一致时判定漂移（据此拒写）', () => {
    expect(isWholeFileDrifted('作者刚手改过的正文', '补丁生成时的旧正文', normalizeEol)).toBe(true);
  });

  it('内容一致（仅 CRLF/LF 差异）时不判漂移（允许写回）', () => {
    expect(isWholeFileDrifted('第一行\r\n第二行', '第一行\n第二行', normalizeEol)).toBe(false);
  });
});

// 红线②：接受补丁 → 快照 → 写盘 → 闭环记录时序，且快照失败必须阻断写回。
describe('F27 写回红线②：快照→写盘→记录时序与快照失败阻断', () => {
  it('内容有变时按 快照→推进分支头→写盘→记录 次序执行', async () => {
    const calls: string[] = [];
    const record = await performGuardedWriteback(true, {
      snapshot: async () => {
        calls.push('snapshot');
        return { timestamp: 1 };
      },
      advanceBranchHead: async () => {
        calls.push('advance');
      },
      write: async () => {
        calls.push('write');
      },
      record: async () => {
        calls.push('record');
        return 'loop-record';
      },
    });
    expect(calls).toEqual(['snapshot', 'advance', 'write', 'record']);
    expect(record).toBe('loop-record');
  });

  it('快照失败必须阻断写回：write 与 record 都不执行', async () => {
    const write = vi.fn(async () => {});
    const record = vi.fn(async () => 'loop-record');
    await expect(
      performGuardedWriteback(true, {
        snapshot: async () => {
          throw new Error('快照写盘失败');
        },
        advanceBranchHead: async () => {},
        write,
        record,
      }),
    ).rejects.toThrow('快照写盘失败');
    expect(write).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('内容未变时跳过快照，仍写盘并记录', async () => {
    const calls: string[] = [];
    await performGuardedWriteback(false, {
      snapshot: async () => {
        calls.push('snapshot');
        return { timestamp: 1 };
      },
      advanceBranchHead: async () => {
        calls.push('advance');
      },
      write: async () => {
        calls.push('write');
      },
      record: async () => {
        calls.push('record');
        return 'loop-record';
      },
    });
    expect(calls).toEqual(['write', 'record']);
  });
});
