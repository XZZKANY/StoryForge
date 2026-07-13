export type AssistField = 'title' | 'blurb' | 'tags' | 'done';

export type AssistStep = {
  id: AssistField;
  label: string;
  hint: string;
};

export const OPEN_ASSIST_STEPS: AssistStep[] = [
  {
    id: 'title',
    label: '书名',
    hint: '复制书名 → 切到已打开的番茄后台粘贴 → 点「下一步」',
  },
  {
    id: 'blurb',
    label: '简介',
    hint: '复制简介 → 粘贴到后台简介框 → 下一步',
  },
  {
    id: 'tags',
    label: '标签',
    hint: '复制标签 → 在后台选择/粘贴标签 → 下一步',
  },
  {
    id: 'done',
    label: '确认已开',
    hint: '后台开书完成后，点「确认已开」写回 SF 额度（可中断关闭向导）',
  },
];

export function fieldText(input: {
  field: AssistField;
  title: string;
  blurb: string;
  tags: string;
}): string | null {
  switch (input.field) {
    case 'title':
      return input.title;
    case 'blurb':
      return input.blurb;
    case 'tags':
      return input.tags;
    case 'done':
      return null;
    default:
      return null;
  }
}

export function nextStepIndex(current: number, total: number): number {
  return Math.min(current + 1, total - 1);
}

export function prevStepIndex(current: number): number {
  return Math.max(current - 1, 0);
}
