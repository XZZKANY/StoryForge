import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';
import { buildCheck, checkPrompt } from './chapterCheckProtocol';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);

describe('chapter writing pipeline replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(19);
    expect(golden.scenarios).toHaveLength(34);
  });

  it.each((golden.scenarios as Obj[]).map((item) => [item.id, item] as const))(
    '%s',
    async (_id, scenario) => {
      const { record, error } = await replay(scenario);
      if (scenario.error) {
        expect(error).toBeInstanceOf(AgentRuntimeUserMessageError);
        expect((error as Error).message).toBe(scenario.error.message);
      } else {
        if (error) throw error;
        expectSame(record.result, scenario.result, 'result');
      }
      if ('controls' in scenario) expectSame(record.controls, scenario.controls, 'controls');
      for (const key of REPLAY_KEYS) expectSame(record[key], scenario[key], key);
    },
  );
});

// 检查协议的整份校验：端到端场景走不到的分支逐条对 Python（重复键、非有限数字、引用定位、预算）。
describe('chapter check protocol matches Python', () => {
  it('builds the same checker prompt', () => {
    const record = (golden.check_records as Obj[])[0];
    expect(checkPrompt(golden.check_brief as Obj, record.content)).toBe(golden.check_prompt);
  });

  it.each((golden.check_records as Obj[]).map((item) => [item.name, item] as const))(
    '%s',
    (_name, item) => {
      const raw = item.raw_repeat ? item.raw_repeat[0].repeat(item.raw_repeat[1]) : item.raw;
      expect(
        buildCheck(item.content, golden.check_brief as Obj, raw, {
          providerFailed: item.provider_failed === true,
        }),
      ).toEqual(item.result);
    },
  );
});
