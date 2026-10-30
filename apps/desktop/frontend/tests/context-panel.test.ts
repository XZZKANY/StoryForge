import { expect, test } from 'vitest';

import {
  runContextReads,
  skillsReadThisRun,
  skillsUsedThisRun,
  traceLookup,
  traceReadSources,
} from '../src/components/chat-window/context-panel';
import {
  stepFromToolTraceEvent,
  toolStepTitle,
  stepsFromAgentResult,
} from '../src/components/chat-window/agent-step-mapping';
import type { AgentToolTrace } from '../src/lib/api/types';

const ROOT = 'D:\\连载\\雾港';
const trace = (overrides: Partial<AgentToolTrace>): AgentToolTrace => ({
  tool_name: 'fs.read',
  status: 'completed',
  input_summary: {},
  ...overrides,
});

test('fs.read prefers the resolved path the engine read, then the requested one', () => {
  expect(
    traceReadSources(
      trace({
        input_summary: { path: './正文/第005章.md' },
        output_summary: { path: '正文/第005章.md', returned_chars: 10 },
      }),
    ),
  ).toEqual(['正文/第005章.md']);
  expect(traceReadSources(trace({ input_summary: { path: '设定/人物.md' } }))).toEqual([
    '设定/人物.md',
  ]);
  // 没读成的调用不算读过。
  expect(
    traceReadSources(trace({ status: 'failed', input_summary: { path: '正文/第009章.md' } })),
  ).toEqual([]);
});

test('project.knowledge only counts the read action', () => {
  expect(
    traceReadSources(
      trace({
        tool_name: 'project.knowledge',
        input_summary: { action: 'read', path: '.storyforge/knowledge/人物.md' },
      }),
    ),
  ).toEqual(['.storyforge/knowledge/人物.md']);
  expect(
    traceReadSources(
      trace({ tool_name: 'project.knowledge', input_summary: { action: 'search', query: '雾' } }),
    ),
  ).toEqual([]);
});

test('patch tools contribute their context snapshot plus the target they read', () => {
  const provenance = {
    context_provenance: {
      context_files: ['设定/人物.md', '正文/第004章.md', '设定/人物.md'],
      context_file_count: 3,
    },
  };
  expect(
    traceReadSources(
      trace({
        tool_name: 'file.revise',
        input_summary: { file_path: '正文/第005章.md', ...provenance },
      }),
    ),
  ).toEqual(['正文/第005章.md', '设定/人物.md', '正文/第004章.md']);
  // 新文件还不存在：只算上下文，不算目标。
  expect(
    traceReadSources(
      trace({
        tool_name: 'file.create',
        input_summary: { file_path: '正文/第006章.md', ...provenance },
      }),
    ),
  ).toEqual(['设定/人物.md', '正文/第004章.md']);
  // 拟章纲把快照摘要摊在 input_summary 上；别的工具的同名参数不认。
  expect(
    traceReadSources(
      trace({
        tool_name: 'chapter.brief',
        input_summary: { target_path: '正文/第006章.md', context_files: ['大纲.md'] },
      }),
    ),
  ).toEqual(['大纲.md']);
  expect(
    traceReadSources(trace({ tool_name: 'fs.list', input_summary: { context_files: ['x.md'] } })),
  ).toEqual([]);
});

test('search and list record what was looked up, not files', () => {
  expect(traceLookup(trace({ tool_name: 'fs.search', input_summary: { query: ' 刘哥 ' } }))).toBe(
    '刘哥',
  );
  expect(traceLookup(trace({ tool_name: 'fs.list', input_summary: {} }))).toBe('');
  expect(traceLookup(trace({ tool_name: 'fs.list', input_summary: { subpath: '正文' } }))).toBe(
    '正文',
  );
  expect(traceLookup(trace({ input_summary: { path: 'a.md' } }))).toBeUndefined();
});

test('live and settled step mapping carry the same sources', () => {
  const traces = [
    trace({ output_summary: { path: '正文/第005章.md' } }),
    trace({ tool_name: 'fs.search', input_summary: { query: '刘哥' } }),
  ];
  const live = traces.map((item, index) => stepFromToolTraceEvent(index, item));
  const settled = stepsFromAgentResult({
    type: 'agent_result',
    session_id: 's',
    run_id: 'r',
    assistant_session_id: 1,
    user_message: '看看第 5 章',
    intent: 'chat.explain',
    plan: [],
    tool_trace: traces,
    agent_result: { summary: '读完了', requires_user_confirmation: false },
  });
  expect(live[0].sources).toEqual(['正文/第005章.md']);
  expect(live[1].lookup).toBe('刘哥');
  expect(settled).toEqual(live);
});

test('run reads dedupe across steps, keep first-read order, and resolve inside the project', () => {
  const steps = [
    stepFromToolTraceEvent(0, trace({ output_summary: { path: '正文/第005章.md' } })),
    stepFromToolTraceEvent(1, trace({ tool_name: 'fs.search', input_summary: { query: '刘哥' } })),
    stepFromToolTraceEvent(2, trace({ tool_name: 'fs.search', input_summary: { query: '刘哥' } })),
    stepFromToolTraceEvent(3, trace({ tool_name: 'fs.list', input_summary: {} })),
    stepFromToolTraceEvent(
      4,
      trace({
        tool_name: 'project.trim_prose',
        input_summary: { path: '正文\\第005章.md' },
      }),
    ),
    stepFromToolTraceEvent(5, trace({ input_summary: { path: `${ROOT}\\设定\\人物.md` } })),
    stepFromToolTraceEvent(6, trace({ input_summary: { path: 'E:\\别处\\笔记.md' } })),
  ];
  expect(runContextReads(steps, ROOT)).toEqual({
    files: [
      { path: '正文/第005章.md', filePath: `${ROOT}\\正文\\第005章.md` },
      { path: '设定/人物.md', filePath: `${ROOT}\\设定\\人物.md` },
      // 项目外的路径照样列出，但不给打开。
      { path: 'E:/别处/笔记.md', filePath: null },
    ],
    lookups: [
      { kind: 'search', text: '刘哥' },
      { kind: 'list', text: '' },
    ],
  });
  expect(runContextReads([], ROOT)).toEqual({ files: [], lookups: [] });
});

test('skills read this run are the run reads under 技能/, inside the project', () => {
  const steps = [
    stepFromToolTraceEvent(0, trace({ output_summary: { path: '正文/第005章.md' } })),
    stepFromToolTraceEvent(1, trace({ input_summary: { path: '技能\\立项流程.md' } })),
    stepFromToolTraceEvent(2, trace({ input_summary: { path: `${ROOT}\\技能\\审稿口径.md` } })),
    stepFromToolTraceEvent(3, trace({ input_summary: { path: '设定/技能树.md' } })),
    stepFromToolTraceEvent(4, trace({ input_summary: { path: 'E:\\别处\\技能\\x.md' } })),
  ];
  expect([...skillsReadThisRun(runContextReads(steps, ROOT))]).toEqual([
    '技能/立项流程.md',
    '技能/审稿口径.md',
  ]);
  expect(skillsReadThisRun(null).size).toBe(0);
});

const skillRead = (output: Record<string, unknown>, name = '对白打磨') =>
  trace({ tool_name: 'skill.read', input_summary: { name }, output_summary: output });

test('skill.read：作品技能计入项目路径，插件技能不当项目文件、另列一项不可点', () => {
  const work = skillRead({ skill_name: '立项流程', plugin: null, path: '技能/立项流程.md' });
  const plugin = skillRead({
    skill_name: '对白打磨',
    plugin: '网文工具箱',
    path: 'skills/对白.md',
  });
  expect(traceReadSources(work)).toEqual(['技能/立项流程.md']);
  expect(traceReadSources(plugin)).toEqual([]);
  expect(traceReadSources({ ...work, status: 'failed' })).toEqual([]);

  const steps = [work, plugin, plugin].map((item, index) => stepFromToolTraceEvent(index, item));
  expect(steps[1].skill).toEqual({
    name: '对白打磨',
    plugin: '网文工具箱',
    path: 'skills/对白.md',
  });
  expect(runContextReads(steps, ROOT).files).toEqual([
    { path: '技能/立项流程.md', filePath: `${ROOT}\\技能\\立项流程.md` },
    { path: '插件「网文工具箱」/skills/对白.md', filePath: null },
  ]);
});

test('skill.read 在思考过程里叫「读技能」，目标是技能名，插件技能带插件名', () => {
  expect(toolStepTitle(skillRead({ skill_name: '立项流程', plugin: null }))).toBe(
    '读技能 立项流程',
  );
  expect(toolStepTitle(skillRead({ skill_name: '对白打磨', plugin: '网文工具箱' }))).toBe(
    '读技能 对白打磨（插件 网文工具箱）',
  );
  // 还在跑、没有 output 时按调用时点的名字。
  expect(
    toolStepTitle(
      trace({ tool_name: 'skill.read', status: 'running', input_summary: { name: '节奏' } }),
    ),
  ).toBe('读技能 节奏');
});

test('skills used this run: 技能/ 下读过的作品技能，加 skill.read 按（插件, 名字）读过的', () => {
  const skills = [
    { path: '技能/立项流程.md', name: '立项流程', plugin: null },
    { path: '技能/审稿口径.md', name: '审稿口径', plugin: null },
    { path: 'skills/对白.md', name: '对白打磨', plugin: '网文工具箱' },
    { path: 'skills/节奏.md', name: '节奏检查', plugin: '网文工具箱' },
  ];
  const steps = [
    stepFromToolTraceEvent(0, trace({ input_summary: { path: '技能\\审稿口径.md' } })),
    stepFromToolTraceEvent(1, skillRead({ plugin: '网文工具箱' })),
    // 插件对不上的不算。
    stepFromToolTraceEvent(2, skillRead({ skill_name: '节奏检查', plugin: '别的插件' })),
  ];
  expect([...skillsUsedThisRun(steps, ROOT, skills)]).toEqual(['审稿口径', '对白打磨']);
  expect(skillsUsedThisRun(null, ROOT, skills).size).toBe(0);
});
