import { useCallback, useEffect, useState } from 'react';
import { CONVERSATION_SKILL_DIR, PLUGINS_FILE } from '@storyforge/project-core';

import {
  loadConversationSkills,
  type ConversationSkillItem,
} from '../../lib/api/conversation-skills';
import { useAsyncEffect } from '../../lib/async-guards';
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

// 立项流程、审稿口径由自带的「起书基础包」插件提供，这里只留每本书各写各的。
export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
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
  if (await TauriFileSystem.projectPathExists(projectRoot, file)) return file;
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

  useAsyncEffect(
    (isCurrent) => {
      if (!projectPath) return;
      const settle = (view: ConversationSkillsView) => {
        if (isCurrent()) setLoaded({ projectPath, view });
      };
      loadConversationSkills(projectPath).then(
        (skills) => settle({ status: 'ready', skills }),
        (error: unknown) => settle({ status: 'error', message: errorText(error) }),
      );
    },
    [projectPath, version],
  );

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
