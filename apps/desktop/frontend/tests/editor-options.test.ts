import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STORYFORGE_EDITOR_UNICODE_HIGHLIGHT } from '../src/components/editor/options';

test('StoryForge editor keeps Chinese punctuation readable without Monaco ambiguous-character boxes', () => {
  assert.equal(STORYFORGE_EDITOR_UNICODE_HIGHLIGHT.ambiguousCharacters, false);
  assert.equal(STORYFORGE_EDITOR_UNICODE_HIGHLIGHT.nonBasicASCII, false);
  assert.equal(STORYFORGE_EDITOR_UNICODE_HIGHLIGHT.invisibleCharacters, true);
});
