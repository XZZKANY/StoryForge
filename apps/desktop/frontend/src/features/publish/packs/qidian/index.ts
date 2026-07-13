import type { PlatformPack } from '../types';

/**
 * 起点等第二平台骨架：接口对齐，不宣称可用。
 * 规则/URL 待你有真实运营需求再填。
 */
export const QIDIAN_PACK_ID = 'qidian';

export const qidianPack: PlatformPack = {
  id: QIDIAN_PACK_ID,
  label: '起点中文网（骨架）',
  ready: false,
  defaultMonthlyOpenLimit: 0,
  settingsDefaults: {
    defaultPlatform: QIDIAN_PACK_ID,
    defaultMonthlyOpenLimit: 0,
  },
  checklistLabels: {
    titleOk: '书名',
    blurbOk: '简介',
    coverOk: '封面',
    tagsOk: '标签',
    firstBatchOk: '首更章节',
  },
  openPackReadme: `# 起点开书作业包（骨架）

本 pack 尚未配置真实作者站规则与 URL。
请继续使用番茄 pack，或自行补全 qidian pack 后将 ready 设为 true。
`,
  authorHomeUrl: '',
  loginUrl: '',
  openUrlAllowlist: [],
  isAllowedOpenUrl: () => false,
  apiBaseUrl: '',
  apiEndpoints: {},
};
