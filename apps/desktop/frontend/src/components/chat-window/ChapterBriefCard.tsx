import { Button, Field, Input, Textarea } from '../ui';

import { useState } from 'react';

import type { ChapterBrief, ChapterBriefAdjustment } from './types';

export function ChapterBriefCard({
  brief,
  onConfirm,
  onCancel,
  busy = false,
}: {
  brief: ChapterBrief;
  onConfirm: (brief: ChapterBrief) => void;
  onCancel: () => void;
  /** 已点开始起草、结果还没回来：两个按钮都不能再点。 */
  busy?: boolean;
}) {
  const [draft, setDraft] = useState(brief);
  const update = (key: keyof ChapterBrief, value: string | number) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <section
      className="rounded-lg border border-agent/40 bg-panel px-3 py-3"
      data-testid="chapter-brief-card"
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-foreground">章纲草稿</div>
          <div
            className="mt-1 truncate text-xs text-subtle"
            title={`${draft.targetPath} · 第 ${draft.revision} 版`}
          >
            {draft.targetPath} · 第 {draft.revision} 版
          </div>
        </div>
        <span className="rounded-md border border-agent/40 px-1.5 py-0.5 text-3xs text-agent">
          待确认
        </span>
      </div>
      <AdjustmentList
        adjustments={draft.factAdjustments ?? []}
        disabled={busy}
        onRevert={(target) =>
          setDraft((current) => ({
            ...current,
            factAdjustments: (current.factAdjustments ?? []).filter((item) => item !== target),
          }))
        }
      />
      <Field label="本章目标">
        {(control) => (
          <Textarea
            {...control}
            controlSize="sm"
            rows={3}
            className="mt-1 min-h-16 text-xs"
            value={draft.goal}
            onChange={(event) => update('goal', event.target.value)}
            data-testid="chapter-brief-goal"
          />
        )}
      </Field>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="视角">
          {(control) => (
            <Input
              {...control}
              controlSize="sm"
              className="mt-1 text-xs"
              value={draft.pov ?? ''}
              onChange={(event) => update('pov', event.target.value)}
              data-testid="chapter-brief-pov"
            />
          )}
        </Field>
        <Field label="场景">
          {(control) => (
            <Input
              {...control}
              controlSize="sm"
              className="mt-1 text-xs"
              value={draft.setting ?? ''}
              onChange={(event) => update('setting', event.target.value)}
              data-testid="chapter-brief-setting"
            />
          )}
        </Field>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="最少字数">
          {(control) => (
            <Input
              {...control}
              controlSize="sm"
              className="mt-1 text-xs"
              type="number"
              min={1}
              value={draft.targetCharsMin}
              onChange={(event) => update('targetCharsMin', Number(event.target.value))}
            />
          )}
        </Field>
        <Field label="最多字数">
          {(control) => (
            <Input
              {...control}
              controlSize="sm"
              className="mt-1 text-xs"
              type="number"
              min={1}
              value={draft.targetCharsMax}
              onChange={(event) => update('targetCharsMax', Number(event.target.value))}
            />
          )}
        </Field>
      </div>
      <BriefList
        label="必达节拍"
        values={draft.requiredBeats}
        onChange={(values) => setDraft((current) => ({ ...current, requiredBeats: values }))}
        testId="chapter-brief-beats"
      />
      <BriefList
        label="禁写事项"
        values={draft.forbiddenItems}
        onChange={(values) => setDraft((current) => ({ ...current, forbiddenItems: values }))}
        testId="chapter-brief-forbidden"
      />
      {/* 起草拿这几条当既成事实；模型拿不准时会写「需核实」，作者要在这里看得到、改得了。 */}
      <BriefList
        label="连续性约束"
        values={draft.continuityConstraints}
        onChange={(values) =>
          setDraft((current) => ({ ...current, continuityConstraints: values }))
        }
        testId="chapter-brief-continuity"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="text-xs"
          onClick={onCancel}
          disabled={busy}
          data-testid="chapter-brief-cancel"
        >
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          variant="agent"
          className="text-xs"
          onClick={() => onConfirm(draft)}
          disabled={busy}
          data-testid="chapter-brief-confirm"
        >
          {busy ? '起草中…' : '开始起草'}
        </Button>
      </div>
    </section>
  );
}

/**
 * 计划和已经写下的内容打架时（上一章已抓到的人又要追捕、已死的人要出场），章纲给出的调整。
 * 起草照这些写、优先于下面的目标和节拍；作者不认的那条可以改回原计划，照原样写。
 */
function AdjustmentList({
  adjustments,
  disabled,
  onRevert,
}: {
  adjustments: ChapterBriefAdjustment[];
  disabled: boolean;
  onRevert: (adjustment: ChapterBriefAdjustment) => void;
}) {
  if (!adjustments.length) return null;
  return (
    <div
      className="mb-3 rounded-md border border-border bg-surface px-2.5 py-2"
      data-testid="chapter-brief-adjustments"
    >
      <div className="text-xs font-semibold text-foreground">按已写内容调整</div>
      <div className="mt-0.5 text-3xs text-subtle">起草照这几条写，优先于下面的目标和节拍。</div>
      <ul className="mt-2 space-y-2">
        {adjustments.map((item) => (
          <li
            key={`${item.planQuote}|${item.factQuote}|${item.adjustment}`}
            className="flex items-start gap-2"
            data-testid="chapter-brief-adjustment"
          >
            <div className="min-w-0 flex-1 text-xs">
              <div className="text-foreground">{item.adjustment}</div>
              <div className="mt-0.5 text-3xs text-subtle">
                计划：「{item.planQuote}」 · 已写：「{item.factQuote}」
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0 text-3xs"
              onClick={() => onRevert(item)}
              disabled={disabled}
              data-testid="chapter-brief-adjustment-revert"
            >
              改回原计划
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 一行一条：挤在一行里用分号隔开，长条目会被截断，条目里自带的分号还会把一条拆成两条。 */
function BriefList({
  label,
  values,
  onChange,
  testId,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  testId: string;
}) {
  // 文本框自己记住原文：边打字边按行过滤，空行一出现就被吃掉，光标会跳。
  const [text, setText] = useState(values.join('\n'));
  return (
    <Field label={label} className="mt-2">
      {(control) => (
        <Textarea
          {...control}
          controlSize="sm"
          rows={Math.min(6, Math.max(2, values.length))}
          className="mt-1 text-xs"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange(
              event.target.value
                .split('\n')
                .map((value) => value.trim())
                .filter(Boolean),
            );
          }}
          data-testid={testId}
        />
      )}
    </Field>
  );
}
