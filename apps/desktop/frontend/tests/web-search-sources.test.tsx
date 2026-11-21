import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentStepsPanel } from '../src/components/chat-window/AgentStepsPanel';
import { stepFromToolTraceEvent } from '../src/components/chat-window/agent-step-mapping';
import { traceWebSources } from '../src/components/chat-window/web-search-sources';
import type { ChatWindowAgentToolTrace } from '../src/components/chat-window/types';
const trace: ChatWindowAgentToolTrace = {
  tool_name: 'web.search',
  status: 'completed',
  input_summary: { query: '公开史料' },
  output_summary: {
    result_count: 1,
    provider: 'tavily',
    sources: [{ id: 'web-1', title: '资料来源', url: 'https://example.com/history' }],
  },
};
it('shows actual result links separately from manuscript paths', () => {
  const step = stepFromToolTraceEvent(0, trace);
  expect(step.title).toBe('联网搜索「公开史料」');
  expect(step.metrics).toContain('网页来源 1 个');
  expect(step.sources).toBeUndefined();
  const html = renderToStaticMarkup(
    <AgentStepsPanel
      run={{ id: 'r', sessionId: 's', goal: '查史料', status: 'completed', steps: [step] }}
    />,
  );
  expect(html).toContain('href="https://example.com/history"');
  expect(html).toContain('noopener noreferrer');
  expect(html).toContain('资料来源');
});
it('never displays sources from failed calls or unsafe links', () => {
  expect(traceWebSources({ ...trace, status: 'failed' })).toEqual([]);
  expect(
    traceWebSources({
      ...trace,
      output_summary: {
        sources: [
          { title: 'script', url: 'javascript:alert(1)' },
          { title: 'local', url: 'file:///C:/private.txt' },
          { title: 'password', url: 'https://user:secret@example.com' },
          { title: 'one', url: 'https://example.com' },
          { title: 'duplicate', url: 'https://example.com/' },
        ],
      },
    }),
  ).toEqual([{ title: 'one', url: 'https://example.com/' }]);
});

it('shows only the actually read page and reports truncation instead of treating discovered links as read', () => {
  const read = {
    ...trace,
    tool_name: 'web.read',
    input_summary: { url: 'https://example.com/' },
    output_summary: {
      sources: [{ title: '已读正文', url: 'https://example.com/' }],
      result_count: 1,
      link_count: 2,
      truncated: true,
      links: [{ title: '未读页面', url: 'https://example.com/unread' }],
    },
  };
  const step = stepFromToolTraceEvent(0, read);
  expect(step.title).toContain('读取网页');
  expect(step.metrics).toContain('正文已截断');
  expect(traceWebSources(read)).toEqual([{ title: '已读正文', url: 'https://example.com/' }]);
});
