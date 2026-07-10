import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  extractAgentRoleMentions,
  mapAgentRoleMentionsToHints,
} from '../src/lib/agent-roles';

test('extractAgentRoleMentions parses known Chinese mentions and dedupes', () => {
  assert.deepEqual(
    extractAgentRoleMentions('@剧情 @人物 @剧情 看看这一章冲突够不够'),
    ['@剧情', '@人物'],
  );
});

test('mapAgentRoleMentionsToHints maps aliases and ignores unknown mentions', () => {
  assert.deepEqual(
    mapAgentRoleMentionsToHints(['@剧情', '@未知', '@文风']),
    ['plot_reviewer', 'prose_reviewer'],
  );
});

test('mapAgentRoleMentionsToHints can use server roles when provided', () => {
  assert.deepEqual(
    mapAgentRoleMentionsToHints(
      ['@剧情'],
      [
        {
          name: 'server_plot',
          display_name: '剧情',
          kind: 'subagent',
          description: '',
          aliases: ['@剧情'],
          read_only: true,
          default_permission_profile: 'read',
          allowed_tools: ['file.review'],
          output_artifacts: ['review_report'],
          can_be_mentioned: true,
        },
      ],
    ),
    ['server_plot'],
  );
});
