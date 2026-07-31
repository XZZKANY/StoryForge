import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, test } from 'vitest';

import { ComposerBox } from '../src/components/chat-window/Composer';
import { writableFilePatch } from '../src/components/chat-window/agent-result';
import {
  AGENT_PERMISSION_PROFILES,
  DEFAULT_AGENT_PERMISSION_PROFILE,
  allowsAuthoringActions,
  normalizeAgentPermissionProfile,
  readAgentPermissionProfile,
  shouldAutoAcceptSuggestion,
  writeAgentPermissionProfile,
} from '../src/lib/agent-permission';
import type { AgentResultMessage } from '../src/lib/api-client';

beforeEach(() => {
  localStorage.clear();
});

test('权限是「对这个项目」的：两本书各记一份，互不串档', () => {
  writeAgentPermissionProfile('D:/连载/末世吞噬', 'auto');
  writeAgentPermissionProfile('D:/连载/试验田', 'read');

  assert.equal(readAgentPermissionProfile('D:/连载/末世吞噬'), 'auto');
  assert.equal(readAgentPermissionProfile('D:/连载/试验田'), 'read');
  // 没设过的项目不继承别人的授权。
  assert.equal(readAgentPermissionProfile('D:/连载/新书'), DEFAULT_AGENT_PERMISSION_PROFILE);
  assert.equal(readAgentPermissionProfile(null), DEFAULT_AGENT_PERMISSION_PROFILE);
});

test('迁移绝不把旧档位升级成自动落盘', () => {
  assert.equal(DEFAULT_AGENT_PERMISSION_PROFILE, 'ask');
  for (const legacy of ['risk_confirm', 'step_confirm', 'autonomous', 'full_allow']) {
    assert.equal(normalizeAgentPermissionProfile(legacy), 'ask', legacy);
  }
  // 存档里躺着旧值时，读出来也是 ask，不是 auto。
  localStorage.setItem('storyforge:agent-permission:D:/连载/末世吞噬', 'autonomous');
  assert.equal(readAgentPermissionProfile('D:/连载/末世吞噬'), 'ask');

  assert.equal(normalizeAgentPermissionProfile('随便什么'), 'ask');
  assert.equal(normalizeAgentPermissionProfile(undefined), 'ask');
});

test('只读档挡住 Ctrl+K / Ctrl+Shift+K 的发起，其余档位放行', () => {
  assert.equal(allowsAuthoringActions('read'), false);
  for (const profile of AGENT_PERMISSION_PROFILES.filter((item) => item !== 'read')) {
    assert.equal(allowsAuthoringActions(profile), true, profile);
  }
});

test('自动落盘的判定表：只有后端明确说不必确认、且不是派生缓存时才自动', () => {
  const path = 'D:/连载/末世吞噬/正文/第01章.md';

  assert.equal(shouldAutoAcceptSuggestion({ filePath: path, requiresConfirmation: false }), true);
  assert.equal(shouldAutoAcceptSuggestion({ filePath: path, requiresConfirmation: true }), false);
  // 失败关闭：字段缺失（老后端 / 坏数据）一律退回手动确认。
  assert.equal(shouldAutoAcceptSuggestion({ filePath: path }), false);
  // 派生缓存由后端重建，自动写进去下次扫描就被覆盖。
  assert.equal(
    shouldAutoAcceptSuggestion({
      filePath: 'D:/连载/末世吞噬/.storyforge/canon/derived/dossier.md',
      requiresConfirmation: false,
    }),
    false,
  );
});

function patchMessage(patch: Record<string, unknown> | null): AgentResultMessage {
  return {
    proposed_patch: patch,
    tool_trace: [],
    agent_result: { summary: '' },
  } as unknown as AgentResultMessage;
}

test('补丁上的确认位失败关闭：只有后端显式 false 才免点击', () => {
  const base = { file_path: '正文/第01章.md', before: '旧', after: '新' };

  assert.equal(writableFilePatch(patchMessage({ ...base }))?.requires_confirmation, true);
  assert.equal(
    writableFilePatch(patchMessage({ ...base, requires_confirmation: true }))?.requires_confirmation,
    true,
  );
  assert.equal(
    writableFilePatch(patchMessage({ ...base, requires_confirmation: 'false' }))
      ?.requires_confirmation,
    true,
  );
  assert.equal(
    writableFilePatch(patchMessage({ ...base, requires_confirmation: false }))
      ?.requires_confirmation,
    false,
  );
});

test('Composer 带权限选择器，运行中锁定本轮启动时的档位', () => {
  const html = renderToStaticMarkup(
    <ComposerBox
      value="继续写第七章"
      disabled={false}
      busy
      currentFileLabel="正文/第07章.md"
      explicitContextPaths={[]}
      permissionProfile="auto"
      onChange={() => undefined}
      onSubmit={() => undefined}
      onAddContext={() => undefined}
      onPermissionProfileChange={() => undefined}
    />,
  );

  assert.match(html, /data-testid="composer-permission-profile"/);
  assert.match(html, /value="auto"/);
  assert.match(html, /<select[^>]*disabled=""[^>]*data-testid="composer-permission-profile"/);
});
