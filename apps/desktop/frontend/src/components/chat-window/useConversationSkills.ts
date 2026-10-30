import { useCallback, useEffect, useState } from 'react';
import { CONVERSATION_SKILL_DIR, PLUGINS_FILE } from '@storyforge/project-core';

import {
  loadConversationSkills,
  type ConversationSkillItem,
} from '../../lib/api/conversation-skills';
import { emitOpenFileRequest } from '../../lib/assistant-events';
import { resolveProjectRelativePath } from '../../lib/project-context';
import { PLUGINS_CHANGED_EVENT } from '../../lib/plugin-events';
import { normalizePathForMatch } from '../../lib/project/path';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../../lib/tauri-fs';
import { emitToast } from '../../lib/toast';

export type SkillTemplate = { name: string; when: string; content: string };

const template = (name: string, when: string, body: string): SkillTemplate => ({
  name,
  when,
  content: `---\n名字：${name}\n什么时候用：${when}\n---\n# ${name}\n\n${body}\n`,
});

export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  template(
    '立项流程',
    '作者问「下一步干什么」，或世界观、总纲、人物刚写完一份时',
    [
      '按这个顺序立项，一步做完再提下一步；作者说跳过就跳过。',
      '',
      '1. 世界观：`设定/` 里有一份写清时代、地理、力量体系或社会规则的文件。',
      '2. 总纲：`大纲/总纲.md` 写清主线、结局方向、分卷或分阶段。',
      '3. 主要人物：`人物/主要人物.md` 写清主角和两三个关键配角的目标、缺陷、关系。',
      '4. 第一章章纲：第一章发生什么、停在哪里。',
      '5. 开写第一章。',
      '',
      '每完成一步，回复里用一句话说下一步是什么，问作者要不要现在做。一次只起草一份。',
    ].join('\n'),
  ),
  template(
    '审稿口径',
    '作者让你审稿、挑毛病或评价一章时',
    [
      '（改成你最在意的几条）',
      '',
      '- 先说最影响读下去的一处问题，再说其他。',
      '- 每条指出原文位置，并给一句改法。',
      '- 不用「文笔不错」这类大词，只说具体哪里、为什么。',
    ].join('\n'),
  ),
  template(
    '本书禁用词',
    '起草、修订、续写正文时（把禁用词写进给起草或修订的 instruction）',
    ['下面的词和说法不要出现在正文里；修订时看到就换掉。', '', '- （一行写一个）'].join('\n'),
  ),
];

/** 按模板新建一份技能并返回它的绝对路径；同名文件已在就原样返回，绝不覆盖。 */
export async function createConversationSkillFile(
  projectRoot: string,
  skill: SkillTemplate,
): Promise<string> {
  const dir = resolveProjectRelativePath(projectRoot, CONVERSATION_SKILL_DIR);
  const file = resolveProjectRelativePath(
    projectRoot,
    `${CONVERSATION_SKILL_DIR}/${skill.name}.md`,
  );
  if (dir === null || file === null) throw new Error('技能的路径不在当前作品里');
  if (await TauriFileSystem.pathExists(file)) return file;
  await TauriFileSystem.createDir(projectRoot, dir, true);
  await TauriFileSystem.writeFile(projectRoot, file, skill.content);
  return file;
}

export type ConversationSkillsView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; skills: ConversationSkillItem[] };

const SKILL_DIR = `/${normalizePathForMatch(CONVERSATION_SKILL_DIR)}`;
const PLUGINS_PATH = `/${normalizePathForMatch(PLUGINS_FILE)}`;

// 写盘广播带路径时只认技能文件夹（或其中的文件）与插件启用文件；不带路径的是整体失效，也重读。
function touchesSkills(changed: string | undefined): boolean {
  if (!changed) return true;
  const path = `/${normalizePathForMatch(changed)}`;
  return path.endsWith(SKILL_DIR) || path.includes(`${SKILL_DIR}/`) || path.endsWith(PLUGINS_PATH);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 对话栏「上下文」的技能块：展开时读一次，之后跟着写盘广播刷新。 */
export function useConversationSkills(projectPath: string | null) {
  // 结果连同读的是哪部作品一起存：切作品时旧结果不冒充新作品的。
  const [loaded, setLoaded] = useState<{
    projectPath: string;
    view: ConversationSkillsView;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onMutation = (event: Event) => {
      if (touchesSkills((event as CustomEvent<{ path?: string }>).detail?.path))
        setVersion((value) => value + 1);
    };
    const onPluginsChanged = () => setVersion((value) => value + 1);
    window.addEventListener(FS_MUTATION_EVENT, onMutation);
    window.addEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    return () => {
      window.removeEventListener(FS_MUTATION_EVENT, onMutation);
      window.removeEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    };
  }, []);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    const settle = (view: ConversationSkillsView) => {
      if (!cancelled) setLoaded({ projectPath, view });
    };
    loadConversationSkills(projectPath).then(
      (skills) => settle({ status: 'ready', skills }),
      (error: unknown) => settle({ status: 'error', message: errorText(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [projectPath, version]);

  const create = useCallback(
    async (skill: SkillTemplate) => {
      if (!projectPath || creating) return;
      setCreating(true);
      try {
        emitOpenFileRequest(await createConversationSkillFile(projectPath, skill));
      } catch (error) {
        emitToast(`新建技能失败：${errorText(error)}`, { tone: 'error' });
      } finally {
        setCreating(false);
        setVersion((value) => value + 1);
      }
    },
    [creating, projectPath],
  );

  const view: ConversationSkillsView = !projectPath
    ? { status: 'idle' }
    : loaded?.projectPath === projectPath
      ? loaded.view
      : { status: 'loading' };
  return { view, creating, create };
}
