import type { ProjectReader } from '../readPort';
import {
  FsToolError,
  iterProjectFiles,
  readBoundedText,
  resolveProjectRoot,
  resolveScopedPath,
} from './fsTools';
import { isManuscriptPath } from './manuscript';
import { pythonStrip } from './pythonText';

const MAX_FILE_BYTES = 512_000;
const PROCESS_ONLY_BEATS = ['到场', '取证', '保存', '转场'];
const INVESTIGATION_BUCKETS = [
  ['来到', '到达', '进入', '档案室', '码头', '灯塔', '现场'],
  ['询问', '追问', '问', '管理员', '证人'],
  ['查看', '翻看', '调查', '记录', '账本', '登记表', '线索', '证据'],
  ['收进', '保存', '带走', '放进', '口袋'],
  ['离开', '转场', '赶往', '回到'],
];

type SceneIssue = { rule: string; severity: string; detail: string; snippet: string };
const sceneIssue = (rule: string, severity: string, detail: string, snippet = ''): SceneIssue => ({
  rule,
  severity,
  detail,
  snippet,
});
const signals = (issues: readonly SceneIssue[]) =>
  issues.map((item) => `${item.rule}（${item.severity}）`).join('、');

/** 被检查的稿件：项目内、普通文件、非空；返回解析后的相对路径与正文。 */
async function readScene(reader: ProjectReader, root: string, path: string) {
  await resolveProjectRoot(reader, root);
  const target = await resolveScopedPath(reader, root, path);
  if ((await reader.inspectProjectPath(root, target)).targetKind !== 'file')
    throw new FsToolError(`不是文件：${path}`);
  const content = (await readBoundedText(reader, root, target, MAX_FILE_BYTES)).content;
  if (!pythonStrip(content)) throw new FsToolError(`文件没有可检查的内容：${path}`);
  return { target, content };
}

/** 场景承重静态检查：按确定性规则判断本场是否承重，产出 advisory 信号。 */
export async function collapseScan(
  reader: ProjectReader,
  root: string,
  path: string,
  options: {
    beats?: readonly string[] | null;
    emotionBefore?: string | null;
    emotionAfter?: string | null;
    irreversibleConsequence?: string | null;
    deletable?: boolean | null;
  } = {},
) {
  const { target, content } = await readScene(reader, root, path);
  const issues: SceneIssue[] = [];
  if (options.beats != null) {
    const normalized = options.beats.map(pythonStrip).filter(Boolean);
    if (
      normalized.length === PROCESS_ONLY_BEATS.length &&
      normalized.every((beat, i) => beat === PROCESS_ONLY_BEATS[i])
    )
      issues.push(
        sceneIssue(
          'process_only',
          '中',
          '场景只有到场、取证、保存、转场流程，没有承重变化。',
          normalized.join('-'),
        ),
      );
  }
  const before = options.emotionBefore == null ? null : pythonStrip(options.emotionBefore);
  const after = options.emotionAfter == null ? null : pythonStrip(options.emotionAfter);
  if (before && after && before === after)
    issues.push(
      sceneIssue('emotion_unchanged', '低', '场景前后情绪相同，没有可见情绪变化。', before),
    );
  const consequence =
    options.irreversibleConsequence == null ? null : pythonStrip(options.irreversibleConsequence);
  if (options.irreversibleConsequence != null && !consequence)
    issues.push(
      sceneIssue('no_irreversible_consequence', '低', '显式观察结果为空：本场没有不可逆后果。'),
    );
  if (options.deletable === true)
    issues.push(sceneIssue('deletable', '低', '本场被标记为可删除，删除后主线仍可成立。'));
  const templateHits = INVESTIGATION_BUCKETS.filter((bucket) =>
    bucket.some((term) => content.includes(term)),
  ).map((bucket) => bucket.find((term) => content.includes(term))!);
  if (templateHits.length >= 3 && !consequence)
    issues.push(
      sceneIssue(
        'investigation_template',
        '中',
        '正文命中至少三个调查动作桶，且没有不可逆后果；这是用不可逆后果近似原版推进三信号的降级判定。',
        templateHits.join('-'),
      ),
    );
  const status = issues.length ? 'warn' : 'pass';
  return {
    path: target,
    verdict: { status, issues },
    summary:
      status === 'pass'
        ? '场景承重静态检查未发现风险信号；这是 advisory 参考，不是质量判定。'
        : `场景承重静态检查发现 ${issues.length} 个 advisory 信号：${signals(issues)}；请结合原文核实，不是质量判定。`,
  };
}

/**
 * 按正文阅读序给出 1-based 章序：遍历文件工具可见的全部文件、只数正文目录，
 * 与 canon 章序同口径地避免笔记和资料占章号。
 */
async function chapterOrdinal(
  reader: ProjectReader,
  root: string,
  target: string,
  path: string,
): Promise<number> {
  let index = 0;
  for (const candidate of await iterProjectFiles(reader, root)) {
    if (!isManuscriptPath(candidate)) continue;
    index += 1;
    if (candidate === target) return index;
  }
  throw new FsToolError(`文件不在项目正文阅读序中，无法推断章节序号：${path}`);
}

export type EntityBudgetOptions = {
  chapter?: number | null;
  newKeyCharacters?: readonly string[] | null;
  newCoreLocations?: readonly string[] | null;
  newCoreEvidence?: readonly string[] | null;
  newMajorReversals?: readonly string[] | null;
  newMysteries?: readonly string[] | null;
  newEquipment?: readonly string[] | null;
  budgetKeyCharacters?: number;
  budgetCoreLocations?: number;
  budgetCoreEvidence?: number;
  budgetMajorReversals?: number;
  /** 第 20 章后还允许新增几个核心地点；默认 0，一个都算超。 */
  budgetLateCoreLocations?: number;
  /** 第 25 章后还允许新增几个谜题；默认 0。 */
  budgetLateMysteries?: number;
};

/** 长篇实体预算静态检查：单章结构化观察值对照阈值与数量预算，产出 advisory 信号。 */
export async function entityBudgetScan(
  reader: ProjectReader,
  root: string,
  path: string,
  options: EntityBudgetOptions = {},
) {
  const { target } = await readScene(reader, root, path);
  const chapter = options.chapter ?? (await chapterOrdinal(reader, root, target, path));
  const issues: SceneIssue[] = [];
  const add = (rule: string, detail: string, snippet: string) =>
    issues.push(sceneIssue(rule, '高', detail, snippet));
  const {
    newKeyCharacters,
    newCoreLocations,
    newCoreEvidence,
    newMajorReversals,
    newMysteries,
    newEquipment,
  } = options;
  if (
    chapter >= 20 &&
    newCoreLocations &&
    newCoreLocations.length > (options.budgetLateCoreLocations ?? 0)
  )
    add(
      'late_core_locations',
      `chapter 20+新增核心地点: ${newCoreLocations.join(', ')}`,
      newCoreLocations.join(', '),
    );
  if (chapter >= 25 && newMysteries && newMysteries.length > (options.budgetLateMysteries ?? 0))
    add(
      'late_mysteries',
      `chapter 25+新增新谜题: ${newMysteries.join(', ')}`,
      newMysteries.join(', '),
    );
  const lateItems = [...(newCoreEvidence ?? []), ...(newEquipment ?? [])];
  if (chapter >= 30 && lateItems.length)
    add(
      'late_core_evidence_or_equipment',
      `chapter 30新增设备型号/core evidence: ${lateItems.join(', ')}`,
      lateItems.join(', '),
    );
  const budgets: [string, readonly string[] | null | undefined, number, string][] = [
    [
      'key_characters_over_budget',
      newKeyCharacters,
      options.budgetKeyCharacters ?? 5,
      '新增关键人物超过默认预算。',
    ],
    [
      'core_locations_over_budget',
      newCoreLocations,
      options.budgetCoreLocations ?? 3,
      '新增核心地点超过默认预算。',
    ],
    [
      'core_evidence_over_budget',
      newCoreEvidence,
      options.budgetCoreEvidence ?? 3,
      '新增核心证据超过默认预算。',
    ],
    [
      'major_reversals_over_budget',
      newMajorReversals,
      options.budgetMajorReversals ?? 2,
      '重大反转超过默认预算。',
    ],
  ];
  for (const [rule, items, budget, detail] of budgets)
    if (items != null && items.length > budget) add(rule, detail, items.join(', '));
  const status = issues.length ? 'warn' : 'pass';
  return {
    path: target,
    chapter,
    verdict: { status, issues },
    summary: issues.length
      ? `第 ${chapter} 章实体预算检查发现 ${issues.length} 个 advisory 信号：${signals(issues)}；` +
        '请结合原文核实，不是质量判定。'
      : `第 ${chapter} 章实体预算检查未发现风险信号；这是 advisory 参考，不是质量判定。`,
  };
}
