import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);
const CHAPTERS = ['正文/第001章.md', '正文/第002章.md'];
const BRIEF_MARK = '整理成 Chapter Brief';

/** 拿写章 golden 的「写第三章」场景改一改再回放，只看第一次模型请求。 */
async function firstRequest(change: (spec: Obj) => void) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === 'write-brief')!;
  const spec = JSON.parse(base.spec_json);
  change(spec);
  const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
  if (error) throw error;
  const messages = (record.requests as Obj[])[0].body.messages as Obj[];
  return {
    user: messages[messages.length - 1].content as string,
    system: messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content as string)
      .join('\n'),
  };
}

describe('开写第一章前的立项检查', () => {
  it('sends a chapter request on a book with no chapters and no setup files to the conversation agent', async () => {
    const { user, system } = await firstRequest((spec) => {
      spec.removed_files = [...CHAPTERS, '人物/主角.md'];
    });
    expect(user).toContain('[立项检查：这本书还没有正文，也还缺总纲、人物、世界规则文件。');
    expect(user).toContain('作者：写第三章');
    expect(user).not.toContain(BRIEF_MARK);
    expect(system).toContain('[立项 · 确定性]\n· 还没有正文，也还缺总纲、人物、世界规则文件');
  });

  it('only names what is still missing', async () => {
    const { user } = await firstRequest((spec) => {
      spec.removed_files = CHAPTERS;
      spec.extra_files = { '大纲/总纲.md': '主线：林舟入城寻亲。' };
    });
    expect(user).toContain('也还缺世界规则文件');
    expect(user).toContain('建议顺序：设定/世界规则.md');
  });

  it('goes straight to the brief once outline, characters and settings exist', async () => {
    const { user } = await firstRequest((spec) => {
      spec.removed_files = CHAPTERS;
      spec.extra_files = { '大纲/总纲.md': '主线', '设定/世界规则.md': '城门三更关闭。' };
    });
    expect(user).toContain(BRIEF_MARK);
  });

  it('goes straight to the brief when the author says to skip setup', async () => {
    const { user } = await firstRequest((spec) => {
      spec.removed_files = [...CHAPTERS, '人物/主角.md'];
      spec.message.user_message = '跳过立项，写第一章';
    });
    expect(user).toContain(BRIEF_MARK);
    expect(user).not.toContain('[立项检查');
  });

  it('leaves books that already have chapters alone', async () => {
    const { user, system } = await firstRequest(() => undefined);
    expect(user).toContain(BRIEF_MARK);
    expect(system).not.toContain('[立项 · 确定性]');
  });
});
