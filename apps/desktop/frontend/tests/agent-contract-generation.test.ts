import { expect, it } from 'vitest';

import schema from '../../../../packages/shared/src/contracts/agent-ws.schema.json';
import { emitAgentWsTypes } from '../../../../scripts/lib/emit-agent-ws-types.mjs';

it('generates reusable outcome values without adding a wire frame', () => {
  const generated = emitAgentWsTypes(schema);
  expect(generated).toBe(emitAgentWsTypes(schema));
  expect(generated).toContain('export interface AgentExecutionOutcome {');
  expect(generated).toContain('status: "failed" | "partial";');
  const union = generated.slice(generated.indexOf('export type AgentWsFrame ='));
  expect(union).not.toContain('AgentExecutionOutcome');
  expect(union.match(/\|/g)).toHaveLength(7);
  expect(union).toContain('AgentRunWaitingFrame');
  const waiting = generated.slice(generated.indexOf('export interface AgentRunWaitingFrame'), generated.indexOf('export interface AgentExecutionOutcome'));
  expect(waiting).toContain('execution_epoch: string | null');
  expect(waiting).not.toContain('proposed_patch');
  for (const frame of schema.oneOf) {
    expect(union).toContain(frame.$ref.replace('#/$defs/', ''));
  }
});
