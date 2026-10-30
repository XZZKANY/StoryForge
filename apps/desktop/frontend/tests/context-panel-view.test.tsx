import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
vi.mock('../src/components/chat-window/useRunAuthorAgent', () => ({
  useRunAuthorAgent: () => vi.fn(),
}));
vi.mock('../src/components/chat-window/useChatSessionContext', () => ({
  useChatSessionContext: () => ({
    handleSelectSession: () => {},
    handleNewSession: () => true,
    retryAssistantSessionLoad: () => {},
    retryContextCandidates: () => {},
    addExplicitContext: () => {},
    togglePinnedContext: () => {},
  }),
}));
vi.mock('../src/components/chat-window/useAgentRunRecovery', () => ({
  useAgentRunRecovery: () => ({}),
}));
vi.mock('../src/components/chat-window/useAgentStreamEvent', () => ({
  useAgentStreamEvent: () => () => {},
}));
vi.mock('../src/components/chat-window/useAgentRunControls', () => ({
  useAgentRunControls: () => ({ retryLastFailedRun: () => {}, agentRunControls: {} }),
}));
vi.mock('../src/lib/api/cross-chapter', () => import('./support/http-cross-chapter-double'));
vi.mock('../src/lib/api/author-instructions', () => ({ loadAuthorInstructions: vi.fn() }));
vi.mock('../src/lib/api/conversation-skills', () => ({ loadConversationSkills: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../src/lib/smoke', async (load) => ({
  ...(await load<typeof import('../src/lib/smoke')>()),
  registerSmokeFileLoader: () => () => {},
  registerSmokeProjectLoader: () => () => {},
}));

import { ChatWindow } from '../src/components/ChatWindow';
import { ContextPanel } from '../src/components/chat-window/ContextPanel';
import { stepFromToolTraceEvent } from '../src/components/chat-window/agent-step-mapping';
import { AUTHOR_INSTRUCTIONS_TEMPLATE } from '../src/components/chat-window/useAgentInstructions';
import { SKILL_TEMPLATES } from '../src/components/chat-window/useConversationSkills';
import type { AgentRun } from '../src/components/chat-window/types';
import { useAppDialog } from '../src/components/app/AppDialog';
import { useProjectCommands } from '../src/components/app/useProjectCommands';
import {
  loadAuthorInstructions,
  type AuthorInstructionsState,
} from '../src/lib/api/author-instructions';
import {
  loadConversationSkills,
  type ConversationSkillItem,
} from '../src/lib/api/conversation-skills';
import type { AgentToolTrace } from '../src/lib/api/types';
import {
  emitOpenFileRequest,
  REQUEST_OPEN_FILE_EVENT,
  type OpenFileRequest,
} from '../src/lib/assistant-events';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../src/lib/tauri-fs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = 'D:\\连载\\雾港';
const RULES = `${ROOT}\\.storyforge\\agent-instructions.md`;
const load = vi.mocked(loadAuthorInstructions);
const loadSkills = vi.mocked(loadConversationSkills);
let root: Root;
let host: HTMLDivElement;
let opened: string[];
const onOpen = (event: Event) =>
  opened.push((event as CustomEvent<OpenFileRequest>).detail.filePath);

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  opened = [];
  window.addEventListener(REQUEST_OPEN_FILE_EVENT, onOpen);
  load.mockReset().mockResolvedValue({ status: 'missing', filePath: RULES });
  loadSkills.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(REQUEST_OPEN_FILE_EVENT, onOpen);
  vi.restoreAllMocks();
});

const $ = (testid: string) => host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const $$ = (testid: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const click = async (node: HTMLElement | null) => {
  expect(node).toBeTruthy();
  await act(async () => node!.click());
};
const trace = (overrides: Partial<AgentToolTrace>): AgentToolTrace => ({
  tool_name: 'fs.read',
  status: 'completed',
  input_summary: {},
  ...overrides,
});
const run = (traces: AgentToolTrace[]): AgentRun => ({
  id: 'run-1',
  sessionId: 's',
  goal: '看看第 5 章',
  status: 'completed',
  steps: traces.map((item, index) => stepFromToolTraceEvent(index, item)),
});
async function renderPanel(agentRun: AgentRun | null, state?: AuthorInstructionsState) {
  if (state) load.mockResolvedValue(state);
  await act(async () => root.render(<ContextPanel projectPath={ROOT} run={agentRun} />));
}

test('对话头的「上下文」按钮弹出小浮窗，不插进对话；再点、点外面、Esc 都收起', async () => {
  await act(async () =>
    root.render(<ChatWindow projectPath={ROOT} currentFile={null} assistantSessionId={1} />),
  );
  const panel = () => document.querySelector<HTMLElement>('[data-testid="context-panel"]');
  const toggle = $('conversation-context-toggle');
  expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  expect(panel()).toBeNull();
  expect(load).not.toHaveBeenCalled();

  await click(toggle);
  expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  expect(load).toHaveBeenCalledWith(ROOT);
  // 浮在对话上面，不再是对话头和消息列表之间的一整条。
  expect(host.contains(panel())).toBe(false);
  const popover = panel()?.closest<HTMLElement>('[data-floating-surface]');
  expect(popover?.id).toBe(toggle?.getAttribute('aria-controls'));
  expect(popover?.getAttribute('aria-label')).toBe('上下文');
  expect(panel()?.querySelector('[data-testid="context-run-reads-empty"]')?.textContent).toContain(
    '还没开始对话',
  );

  await click(toggle);
  expect(panel()).toBeNull();
  expect(toggle?.getAttribute('aria-expanded')).toBe('false');

  await click(toggle);
  await act(async () => {
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  expect(panel()).toBeNull();

  await click(toggle);
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(panel()).toBeNull();
});

test('这一轮读了：读过的文件可点开，搜索和看目录只列出不可点', async () => {
  await renderPanel(
    run([
      trace({ output_summary: { path: '正文/第005章.md' } }),
      trace({ tool_name: 'fs.search', input_summary: { query: '刘哥' } }),
      trace({ tool_name: 'fs.list', input_summary: {} }),
      trace({
        tool_name: 'file.revise',
        input_summary: {
          file_path: '正文/第005章.md',
          context_provenance: { context_files: ['设定/人物.md'] },
        },
      }),
      trace({ input_summary: { path: 'E:\\别处\\笔记.md' } }),
    ]),
  );
  const files = $$('context-read-file');
  expect(files.map((node) => node.textContent)).toEqual(['正文/第005章.md', '设定/人物.md']);
  expect($$('context-read-file-outside').map((node) => node.textContent)).toEqual([
    'E:/别处/笔记.md',
  ]);
  expect($('context-run-lookups')?.textContent).toContain('搜过『刘哥』');
  expect($('context-run-lookups')?.textContent).toContain('看过目录（作品根目录）');
  expect($('context-run-lookups')?.querySelector('button')).toBeNull();

  await click(files[1]);
  expect(opened).toEqual([`${ROOT}\\设定\\人物.md`]);
});

test('这一轮没读文件时给一句空状态', async () => {
  await renderPanel(run([trace({ tool_name: 'project.consistency' })]));
  expect($('context-run-reads-empty')?.textContent).toBe('这一轮还没读文件。');
  expect($$('context-read-file')).toEqual([]);
});

test('长期规矩没有时「新建」：先建目录再写说明，然后在编辑器打开', async () => {
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(false);
  const mkdir = vi.spyOn(TauriFileSystem, 'createDir').mockResolvedValue();
  const write = vi.spyOn(TauriFileSystem, 'writeFile').mockResolvedValue();
  await renderPanel(null);
  expect($('context-instructions-state')?.textContent).toContain('还没有');
  expect($('context-instructions-open')).toBeNull();

  await click($('context-instructions-create'));
  expect(exists).toHaveBeenCalledWith(RULES);
  expect(mkdir).toHaveBeenCalledWith(ROOT, `${ROOT}\\.storyforge`, true);
  expect(write).toHaveBeenCalledWith(ROOT, RULES, AUTHOR_INSTRUCTIONS_TEMPLATE);
  expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
  expect(opened).toEqual([RULES]);
});

test('「新建」碰上已有的文件不覆盖，直接打开', async () => {
  vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(true);
  const write = vi.spyOn(TauriFileSystem, 'writeFile').mockResolvedValue();
  await renderPanel(null);
  await click($('context-instructions-create'));
  expect(write).not.toHaveBeenCalled();
  expect(opened).toEqual([RULES]);
});

test('长期规矩有内容时显示字数与前几行，「打开编辑」在编辑器打开', async () => {
  await renderPanel(null, {
    status: 'active',
    filePath: RULES,
    chars: 36,
    truncated: false,
    limit: 4000,
    preview: ['# 长期规矩', '对话用简体中文。'],
  });
  expect($('context-instructions-state')?.textContent).toBe('36 字，每轮都带着');
  expect($('context-instructions-preview')?.textContent).toBe('# 长期规矩对话用简体中文。');
  expect($('context-instructions-create')).toBeNull();
  await click($('context-instructions-open'));
  expect(opened).toEqual([RULES]);
});

test('超长时说明只带最后 4000 字', async () => {
  await renderPanel(null, {
    status: 'active',
    filePath: RULES,
    chars: 3981,
    truncated: true,
    limit: 4000,
    preview: ['最新的要求'],
  });
  expect($('context-instructions-state')?.textContent).toContain('超长，只带最后 4000 字');
});

test('文件在但带不进去时只给「打开编辑」，不给「新建」', async () => {
  await renderPanel(null, { status: 'unused', filePath: RULES });
  expect($('context-instructions-state')?.textContent).toContain('没带上');
  expect($('context-instructions-create')).toBeNull();
  expect($('context-instructions-open')).toBeTruthy();
});

test('写盘广播只在长期规矩那份文件变了时重读', async () => {
  await renderPanel(null);
  expect(load).toHaveBeenCalledTimes(1);
  const mutate = (path?: string) =>
    act(async () => {
      window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT, { detail: { path } }));
    });
  await mutate(`${ROOT}\\正文\\第001章.md`);
  expect(load).toHaveBeenCalledTimes(1);
  await mutate(RULES);
  expect(load).toHaveBeenCalledTimes(2);
  await mutate();
  expect(load).toHaveBeenCalledTimes(3);
});

const skill = (name: string, when: string): ConversationSkillItem => ({
  path: `技能/${name}.md`,
  name,
  when,
  filePath: `${ROOT}\\技能\\${name}.md`,
});
const menuItems = () => [
  ...document.querySelectorAll<HTMLElement>('[data-testid="context-skill-template"]'),
];

test('技能：列出名字和什么时候用，这一轮读过的标出来，点一项在编辑器打开', async () => {
  loadSkills.mockResolvedValue([
    skill('立项流程', '作者问「下一步干什么」时'),
    skill('审稿口径', '作者让你审稿时'),
  ]);
  await renderPanel(
    run([
      trace({ output_summary: { path: '技能/审稿口径.md' } }),
      trace({ output_summary: { path: '正文/第005章.md' } }),
    ]),
  );
  expect(loadSkills).toHaveBeenCalledWith(ROOT);
  expect($('context-skills-state')?.textContent).toBe('共 2 份');
  const items = $$('context-skill');
  expect(items.map((node) => node.textContent)).toEqual([
    '立项流程作者问「下一步干什么」时',
    '审稿口径作者让你审稿时这一轮用了',
  ]);
  expect($$('context-skill-used')).toHaveLength(1);
  // 读技能也照常列在「这一轮读了」里：同一份读取记录。
  expect($$('context-read-file').map((node) => node.textContent)).toContain('技能/审稿口径.md');

  await click(items[0]);
  expect(opened).toEqual([`${ROOT}\\技能\\立项流程.md`]);
});

test('技能：没有时一行说明，「新建」给三个模板，建到 技能/<名字>.md 并打开', async () => {
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(false);
  const mkdir = vi.spyOn(TauriFileSystem, 'createDir').mockResolvedValue();
  const write = vi.spyOn(TauriFileSystem, 'writeFile').mockResolvedValue();
  await renderPanel(null);
  expect($('context-skills-state')?.textContent).toBe(
    '还没有。把这本书的流程、口径写成技能，AI 用得上时会照做。',
  );
  expect($$('context-skill')).toEqual([]);
  expect(menuItems()).toEqual([]);

  await click($('context-skills-create'));
  expect(menuItems().map((node) => node.textContent)).toEqual([
    '立项流程作者问「下一步干什么」，或世界观、总纲、人物刚写完一份时',
    '审稿口径作者让你审稿、挑毛病或评价一章时',
    '本书禁用词起草、修订、续写正文时（把禁用词写进给起草或修订的 instruction）',
  ]);

  const file = `${ROOT}\\技能\\立项流程.md`;
  await click(menuItems()[0]);
  expect(menuItems()).toEqual([]);
  expect(exists).toHaveBeenCalledWith(file);
  expect(mkdir).toHaveBeenCalledWith(ROOT, `${ROOT}\\技能`, true);
  expect(write).toHaveBeenCalledWith(ROOT, file, SKILL_TEMPLATES[0].content);
  expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
  expect(opened).toEqual([file]);
  expect(SKILL_TEMPLATES[0].content).toBe(
    [
      '---',
      '名字：立项流程',
      '什么时候用：作者问「下一步干什么」，或世界观、总纲、人物刚写完一份时',
      '---',
      '# 立项流程',
      '',
      '按这个顺序立项，一步做完再提下一步；作者说跳过就跳过。',
      '',
      '1. 世界观：`设定/` 里有一份写清时代、地理、力量体系或社会规则的文件。',
      '2. 总纲：`大纲/总纲.md` 写清主线、结局方向、分卷或分阶段。',
      '3. 主要人物：`人物/主要人物.md` 写清主角和两三个关键配角的目标、缺陷、关系。',
      '4. 第一章章纲：第一章发生什么、停在哪里。',
      '5. 开写第一章。',
      '',
      '每完成一步，回复里用一句话说下一步是什么，问作者要不要现在做。一次只起草一份。',
      '',
    ].join('\n'),
  );
});

test('技能：新建碰上同名文件不覆盖，直接打开', async () => {
  vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(true);
  const mkdir = vi.spyOn(TauriFileSystem, 'createDir').mockResolvedValue();
  const write = vi.spyOn(TauriFileSystem, 'writeFile').mockResolvedValue();
  loadSkills.mockResolvedValue([skill('审稿口径', '作者让你审稿时')]);
  await renderPanel(null);
  await click($('context-skills-create'));
  await click(menuItems()[2]);
  expect(mkdir).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(opened).toEqual([`${ROOT}\\技能\\本书禁用词.md`]);
});

test('技能：三个模板的头部都认得出名字和什么时候用', () => {
  for (const item of SKILL_TEMPLATES) {
    expect(
      item.content.startsWith(`---\n名字：${item.name}\n什么时候用：${item.when}\n---\n`),
    ).toBe(true);
  }
  expect(SKILL_TEMPLATES.map((item) => item.name)).toEqual(['立项流程', '审稿口径', '本书禁用词']);
});

test('技能：写盘广播只在技能文件夹变了时重读', async () => {
  await renderPanel(null);
  expect(loadSkills).toHaveBeenCalledTimes(1);
  const mutate = (path?: string) =>
    act(async () => {
      window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT, { detail: { path } }));
    });
  await mutate(`${ROOT}\\正文\\第001章.md`);
  await mutate(`${ROOT}\\设定\\技能树.md`);
  expect(loadSkills).toHaveBeenCalledTimes(1);
  await mutate(`${ROOT}\\技能\\立项流程.md`);
  expect(loadSkills).toHaveBeenCalledTimes(2);
  await mutate(`${ROOT}\\技能`);
  expect(loadSkills).toHaveBeenCalledTimes(3);
  await mutate();
  expect(loadSkills).toHaveBeenCalledTimes(4);
});

test('App 收到打开请求：只开项目里的文件，先放出编辑器', async () => {
  const openFile = vi.fn(async () => {});
  const onShowEditor = vi.fn();
  function Harness() {
    useProjectCommands({
      activeProject: ROOT,
      currentFile: `${ROOT}\\正文\\第001章.md`,
      dirtyFiles: new Set(),
      openFiles: [],
      dialogs: useAppDialog(),
      selectProject: () => {},
      selectProjectSafely: async () => true,
      openFile,
      confirmDiscardFiles: async () => true,
      resetEditorFiles: () => {},
      onShowEditor,
    });
    return null;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => emitOpenFileRequest('E:\\别处\\笔记.md'));
  expect(onShowEditor).not.toHaveBeenCalled();
  expect(openFile).not.toHaveBeenCalled();

  await act(async () => emitOpenFileRequest(RULES));
  expect(onShowEditor).toHaveBeenCalledTimes(1);
  expect(openFile).toHaveBeenCalledWith(RULES, '打开上下文文件');

  // 已是当前文件：只把编辑器放出来，不重开。
  await act(async () => emitOpenFileRequest(`${ROOT}\\正文\\第001章.md`));
  expect(onShowEditor).toHaveBeenCalledTimes(2);
  expect(openFile).toHaveBeenCalledTimes(1);
});
