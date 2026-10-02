import assert from 'node:assert/strict';
import { test } from 'vitest';
import { decodeNativeApiConfig, supportsExternalWriteback } from '../src/lib/api/managed-agent-host';

const generation = 'a'.repeat(64);
const enabled = {
  managed_host_generation: generation,
  execution_protocols: ['external_writeback_v1'] as const,
  disabled_reason: null,
};

test('legacy Native and preview config cannot promote API self-reported capability', () => {
  const legacy = decodeNativeApiConfig({ baseUrl: 'http://127.0.0.1:8000', apiKey: 'fixture' });
  assert.equal(supportsExternalWriteback(legacy, { ...enabled, execution_protocols: ['external_writeback_v1'] }), false);
  assert.deepEqual(legacy.executionProtocols, []);
});

test('generation and both independent protocol projections must match', () => {
  const config = decodeNativeApiConfig({ baseUrl: 'fixture', apiKey: 'fixture', managedHostGeneration: generation,
    executionProtocols: ['external_writeback_v1'] });
  const api = { ...enabled, execution_protocols: ['external_writeback_v1'] as 'external_writeback_v1'[] };
  assert.equal(supportsExternalWriteback(config, api), true);
  assert.equal(supportsExternalWriteback(config, { ...api, managed_host_generation: 'b'.repeat(64) }), false);
  assert.equal(supportsExternalWriteback(config, { ...api, execution_protocols: [] }), false);
  assert.equal(supportsExternalWriteback({ ...config, executionProtocols: [] }, api), false);
  assert.equal(supportsExternalWriteback(config, { ...api, disabled_reason: 'release_gate_closed' }), false);
});

for (const capability of [
  { managedHostGeneration: true },
  { managedHostGeneration: 'untrusted' },
  { executionProtocols: 'external_writeback_v1' },
  { executionProtocols: ['unknown'] },
]) {
  test(`Native capability rejects malformed fields ${JSON.stringify(capability)}`, () => {
    assert.throws(() => decodeNativeApiConfig({ baseUrl: 'fixture', apiKey: 'fixture', ...capability }));
  });
}
