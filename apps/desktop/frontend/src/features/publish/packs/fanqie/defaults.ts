import type { PublishSettings } from '../../model/types';
import { DEFAULT_PUBLISH_SETTINGS } from '../../model/types';

export const FANQIE_PACK_ID = 'fanqie';

export const FANQIE_DEFAULT_SETTINGS: PublishSettings = {
  ...DEFAULT_PUBLISH_SETTINGS,
  defaultPlatform: FANQIE_PACK_ID,
  defaultMonthlyOpenLimit: 3,
};

export const FANQIE_CHECKLIST_LABELS: Record<string, string> = {
  titleOk: '书名可用',
  blurbOk: '简介已备',
  coverOk: '封面已备（可后补）',
  tagsOk: '标签已选',
  firstBatchOk: '首批章节够开书',
};

export const FANQIE_OPEN_PACK_README = `# 番茄开书作业包（L0–L2）

1. 在 SF 点「开书辅助」或「打开作者后台」（本机已登录会话）
2. 新建作品，按向导分步粘贴：
   - 书名 ← 复制 meta 中的 title
   - 简介 ← blurb.txt
   - 标签 ← tags.txt
3. 按 checklist.md 勾选本地确认项
4. 上传/粘贴首批章节（见 chapters/ 或清单）
5. 向导末步或面板「确认已开」写回额度

不做自动登录/DOM 代填/打码/反检测；额度以你回写与校准为准。
`;
