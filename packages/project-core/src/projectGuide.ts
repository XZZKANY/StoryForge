/** 新建作品时写进大纲目录的目录说明：只是空架子，不算作者的总纲。 */
export const PROJECT_GUIDE_RELATIVE_PATH = '大纲/项目说明.md';

export const PROJECT_GUIDE_MARKDOWN = [
  '# 项目说明',
  '',
  '- 大纲：存放总纲、章节节点、反转表。',
  '- 人物：存放角色小传、关系、成长线。',
  '- 设定：存放世界观、地点、物件、规则。',
  '- 世界观：存放世界底层规则、势力、历史和专有名词。',
  '- 时间线：存放事件顺序、回忆、伏笔兑现节点。',
  '- 伏笔：存放埋线、回收计划、读者预期管理。',
  '- 正文：存放章节正文。',
].join('\n');

/** 作者没动过的目录说明（换行写法与首尾空白不计）。 */
export function isUntouchedProjectGuide(relativePath: string, content: string): boolean {
  return (
    relativePath.replace(/\\/g, '/') === PROJECT_GUIDE_RELATIVE_PATH &&
    content.replace(/\r\n?/g, '\n').trim() === PROJECT_GUIDE_MARKDOWN
  );
}
