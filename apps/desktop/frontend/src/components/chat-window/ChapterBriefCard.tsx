import { Button, Field, Input, Textarea } from '../ui';

import { useState } from 'react';

import type { ChapterBrief } from './types';

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
