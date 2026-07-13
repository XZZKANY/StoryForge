import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  fieldText,
  nextStepIndex,
  prevStepIndex,
  OPEN_ASSIST_STEPS,
} from '../src/features/publish/assist/wizard-steps';
import { isAllowedFanqieUrl } from '../src/features/publish/packs/fanqie/urls';

test('向导步骤可前进后退', () => {
  assert.equal(OPEN_ASSIST_STEPS.length, 4);
  assert.equal(nextStepIndex(0, 4), 1);
  assert.equal(nextStepIndex(3, 4), 3);
  assert.equal(prevStepIndex(0), 0);
  assert.equal(prevStepIndex(2), 1);
});

test('fieldText 按字段返回', () => {
  assert.equal(
    fieldText({ field: 'title', title: '书A', blurb: '简介', tags: 'tag' }),
    '书A',
  );
  assert.equal(
    fieldText({ field: 'blurb', title: '书A', blurb: '简介', tags: 'tag' }),
    '简介',
  );
  assert.equal(fieldText({ field: 'done', title: 'x', blurb: '', tags: '' }), null);
});

test('URL 白名单只放行番茄作者相关 https', () => {
  assert.equal(isAllowedFanqieUrl('https://fanqienovel.com/main/writer'), true);
  assert.equal(isAllowedFanqieUrl('http://fanqienovel.com/main/writer'), false);
  assert.equal(isAllowedFanqieUrl('https://evil.example.com/'), false);
  assert.equal(isAllowedFanqieUrl('javascript:alert(1)'), false);
});
