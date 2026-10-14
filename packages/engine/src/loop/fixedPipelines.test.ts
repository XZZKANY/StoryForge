import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-fixed-pipelines.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';
import {
  buildRuntimePendingCallResolutionPayload,
  buildRuntimePendingCallResumeDiagnostic,
} from './traces';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);

describe('fixed intent pipelines replay the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(19);
    expect(golden.scenarios).toHaveLength(29);
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

// 未决调用的恢复诊断与消费记录：端到端场景走不到的分支（未支持的 intent、缺恢复消息 / 载荷、run 未恢复）。
describe('pending call helpers match Python', () => {
  it.each((golden.pending_call_diagnostics as Obj[]).map((item) => [item.name, item] as const))(
    'diagnostic %s',
    (_name, item) => {
      expect(
        buildRuntimePendingCallResumeDiagnostic({
          runStatus: item.run_status,
          currentStep: item.current_step,
          payload: item.payload,
          artifactId: 7,
        }),
      ).toEqual(item.result);
    },
  );

  it.each((golden.pending_call_resolutions as Obj[]).map((item) => [item.name, item] as const))(
    'resolution %s',
    (_name, item) => {
      expect(buildRuntimePendingCallResolutionPayload(item.payload, 7)).toEqual(item.result);
    },
  );
});
