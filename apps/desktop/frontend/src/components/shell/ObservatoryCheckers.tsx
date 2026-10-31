/** 观测镜「检查器」分区：每个检查器一行，展开看它的发现；按需的几个可以请 AI 在对话里查。 */
import { useState } from 'react';

import { Check, ChevronDown, ChevronRight } from '../icons/shell-icons';
import type { ObservatoryChecker } from '../../lib/observations';
import type { Observation } from './ObsPanel';
import { Button, PlainButton } from '../ui';

const CHECKER_LABELS: Record<string, string> = {
  canon: '设定检查',
  promise: '伏笔承诺账',
  prose: '文笔气味',
  consistency: '一致性观察',
  collapse: '场景承重',
  entity_budget: '实体预算',
  deep_consistency: '深度一致性',
};

// 「按需」检查器要 Agent 给语义参数（场景节拍、新实体清单）或本身走模型，只能在对话里跑：
// 按钮替作者把话说出来，走输入框同一条路径。
const ASK_PROMPTS: Record<string, string> = {
  consistency: '做一次一致性观察：当前这章和前文在人物、物件、时间上有没有对不上的地方？',
  collapse: '检查一下当前这章的场景承重：哪场戏没推动情节，可以合并或删掉？',
  entity_budget: '检查一下当前这章新出场的人物和物件是不是太多，读者记不记得住？',
  deep_consistency: '做一次深度一致性检查：通读前文，找出和当前这章矛盾的设定或情节。',
};

// 引擎在说明末尾附的是修订策略 id，作者看的是改法。
const STRATEGY_LABELS: Record<string, string> = {
  line_edit: '改法：逐句改',
  scene_patch: '改法：动整场戏',
};

function plainDetail(detail: string): string {
  return detail.replace(/建议策略 (\w+)/g, (match, id: string) => STRATEGY_LABELS[id] ?? match);
}

/** 观测的 source 形如 `prose·dimension`，点号前是产出它的检查器。 */
export function checkerKeyOf(observation: Observation): string | null {
  return observation.source?.split('·')[0] ?? null;
}

function CheckerFinding({
  finding,
  onLocate,
  onResolve,
}: {
  finding: Observation;
  onLocate?: (observation: Observation) => void;
  onResolve?: (id: string) => void;
}) {
  const locatable = Boolean(finding.anchor && onLocate);
  return (
    <li
      className="flex items-start gap-1.5 rounded-sm px-1 py-1 hover:bg-elevated"
      data-testid="checker-finding"
      data-resolved={finding.resolved ? 'true' : 'false'}
    >
      <PlainButton
        className={`min-w-0 flex-1 text-left ${locatable ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={locatable ? () => onLocate?.(finding) : undefined}
        title={locatable ? '定位到原文' : undefined}
        data-testid="checker-finding-locate"
      >
        <span
          className={`block truncate text-2xs ${finding.resolved ? 'text-subtle line-through' : 'text-foreground'}`}
        >
          {finding.title}
        </span>
        {finding.location && (
          <span className="block truncate font-mono text-3xs text-subtle">{finding.location}</span>
        )}
        {finding.detail && (
          <span className="mt-0.5 line-clamp-2 block text-3xs leading-relaxed text-muted">
            {plainDetail(finding.detail)}
          </span>
        )}
      </PlainButton>
      {onResolve && !finding.resolved && (
        <PlainButton
          className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border border-border text-subtle hover:border-success/50 hover:bg-success/15 hover:text-success"
          aria-label={`标记已处理：${finding.title}`}
          title="标记已处理"
          onClick={() => onResolve(finding.id)}
          data-testid="checker-finding-resolve"
        >
          <Check size={10} strokeWidth={2} />
        </PlainButton>
      )}
    </li>
  );
}

export function CheckerRow({
  checker,
  findings,
  onLocate,
  onResolve,
  onAsk,
}: {
  checker: ObservatoryChecker;
  findings: Observation[];
  onLocate?: (observation: Observation) => void;
  onResolve?: (id: string) => void;
  onAsk?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = CHECKER_LABELS[checker.key] ?? checker.tool;
  const ran = checker.status === 'ran';
  const counts = ran
    ? (
        [
          ['conflict_count', '冲突'],
          ['advisory_count', '提醒'],
          ['issue_count', '问题'],
        ] as const
      )
        .map(([field, label]) =>
          typeof checker[field] === 'number' ? `${label} ${checker[field]}` : null,
        )
        .filter((value): value is string => value !== null)
        .join(' · ')
    : '';
  const expandable = ran && findings.length > 0;
  const prompt = ASK_PROMPTS[checker.key];
  const summary = (
    <>
      <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
      {counts && <span className="flex-shrink-0 font-mono text-3xs text-subtle">{counts}</span>}
    </>
  );
  return (
    <div data-testid="checker-row" data-checker={checker.key}>
      <div
        className="flex items-center gap-2 py-1 text-2xs"
        title={
          ran
            ? `${label}：每次保存后自动重查`
            : typeof checker.reason === 'string'
              ? checker.reason
              : label
        }
      >
        <span
          className={`h-[6px] w-[6px] flex-shrink-0 rounded-full ${ran ? 'bg-success' : 'bg-border-strong'}`}
        />
        {expandable ? (
          <PlainButton
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left hover:bg-elevated"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            data-testid="checker-toggle"
          >
            {summary}
            {open ? (
              <ChevronDown size={11} strokeWidth={1.7} className="flex-shrink-0 text-subtle" />
            ) : (
              <ChevronRight size={11} strokeWidth={1.7} className="flex-shrink-0 text-subtle" />
            )}
          </PlainButton>
        ) : (
          summary
        )}
        {/* 自动跑的那几个只靠绿点表示：窄侧栏（作者常用 220px）里再挂一个「保存时自动」，名字就只剩一个字。 */}
        {ran ? null : prompt && onAsk ? (
          <Button
            variant="agent-subtle"
            size="mini"
            title="在对话里请 AI 用这个检查看当前这章（会调用你配置的模型）"
            onClick={() => onAsk(prompt)}
            data-testid="checker-ask"
          >
            让 AI 查
          </Button>
        ) : (
          <span className="flex-shrink-0 font-mono text-3xs text-subtle">按需</span>
        )}
      </div>
      {open && expandable && (
        <ul className="mb-1 ml-3 border-l border-border pl-1" data-testid="checker-findings">
          {findings.map((finding) => (
            <CheckerFinding
              key={finding.id}
              finding={finding}
              onLocate={onLocate}
              onResolve={onResolve}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
