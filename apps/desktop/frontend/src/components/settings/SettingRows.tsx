/** 设置页的分组、卡片与各种设置行；行按标题和描述跟着设置搜索自过滤。 */
import { useId, type ReactNode } from 'react';

import { Button, Field, type FieldControlProps, PlainButton, Select } from '../ui';
import { useSettingsRowVisible } from './search-context';

export function SettingGroup({
  id,
  title,
  badge = null,
  children,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  // sf-settings-group + sf-settings-card：搜索过滤后若卡片内全部行 null 渲染 → 卡片 :empty，
  // 整组（含标题）随之 CSS 隐藏，不再留空标题/空卡壳（见 index.css）。
  return (
    <section id={id} className="sf-settings-group mb-8 scroll-mt-6">
      <h2 className="mb-3 text-sm font-medium text-foreground">
        {title}
        {badge}
      </h2>
      {children}
    </section>
  );
}

/** 「未保存」徽标：仅在正在编辑的模型配置与打开时不一致时出现，保存或取消后消失。 */
export function UnsavedBadge({ visible, testId }: { visible: boolean; testId: string }) {
  if (!visible) return null;
  return (
    <span className="ml-2 text-xs font-normal text-warning" data-testid={testId}>
      ● 未保存
    </span>
  );
}

export function SettingCard({ children }: { children: ReactNode }) {
  return <div className="sf-settings-card overflow-hidden rounded-xl bg-surface">{children}</div>;
}

const ROW_CLASS = 'min-h-[76px] px-4 py-3';

type RowShellProps = {
  title: string;
  description: string;
  /** 接在说明后面、不参与搜索的补充，如对比度警告。 */
  note?: ReactNode;
} & (
  | {
      /** 控件能被 <label> 命名（输入框、下拉、开关）：标题渲染成关联到它的 label。 */
      controlId: string;
      children: (control: FieldControlProps) => ReactNode;
    }
  | {
      /** 按钮、单选组、只读值不能靠 <label> 命名：标题与说明各带 id，需要时控件自己 aria-labelledby / aria-describedby。 */
      controlId?: undefined;
      children: ReactNode | ((ids: { labelId: string; descriptionId: string }) => ReactNode);
    }
);

/** 设置行外壳：标题与说明在左、控件在右；搜索词不在标题和说明里就整行不渲染。所有设置行都经这里。 */
export function RowShell(props: RowShellProps) {
  const { title, description, note } = props;
  const visible = useSettingsRowVisible(title, description);
  const id = useId();
  if (!visible) return null;
  const help = note ? (
    <>
      {description}
      {note}
    </>
  ) : (
    description
  );
  if (props.controlId !== undefined)
    return (
      <Field
        id={props.controlId}
        label={title}
        description={help}
        layout="horizontal"
        className={ROW_CLASS}
      >
        {props.children}
      </Field>
    );

  // 与 Field 的横排同一套 sf-field 类，只是标题不是 <label>。
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  return (
    <div className={`sf-field ${ROW_CLASS}`} data-layout="horizontal">
      <div className="sf-field-label">
        <div id={labelId} className="font-medium">
          {title}
        </div>
        <div id={descriptionId} className="sf-field-help">
          {help}
        </div>
      </div>
      <div className="sf-field-control">
        {typeof props.children === 'function'
          ? props.children({ labelId, descriptionId })
          : props.children}
      </div>
    </div>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  // controlId 走 RowShell 的 Field 分支：标题成为真 label，点标题也能切开关；
  // 按钮改名职责交给 label 关联，不再自带 aria-label。
  const controlId = useId();
  return (
    <RowShell title={title} description={description} controlId={controlId}>
      {(control) => (
        <PlainButton
          {...control}
          aria-pressed={checked}
          onClick={() => onChange(!checked)}
          className={`relative h-[22px] w-[38px] rounded-full transition-colors ${
            checked ? 'bg-accent hover:bg-accent/90' : 'bg-border-strong hover:bg-border'
          }`}
        >
          <span
            className={`absolute left-0 top-0.5 h-[18px] w-[18px] rounded-full transition-transform ${
              checked ? 'translate-x-[18px] bg-accent-foreground' : 'translate-x-0.5 bg-foreground'
            }`}
          />
        </PlainButton>
      )}
    </RowShell>
  );
}

export function RangeRow({
  title,
  description,
  value,
  min,
  max,
  step,
  unit = 'px',
  formatValue,
  testId,
  onChange,
}: {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  formatValue?: (value: number) => string;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <RowShell title={title} description={description} controlId={testId}>
      {(control) => (
        <div className="flex items-center gap-3">
          <input
            type="range"
            {...control}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-40 accent-accent"
            data-testid={testId}
          />
          <span className="w-14 whitespace-nowrap text-right text-sm tabular-nums text-foreground">
            {formatValue ? formatValue(value) : `${value}${unit}`}
          </span>
        </div>
      )}
    </RowShell>
  );
}

export function SelectRow({
  title,
  description,
  value,
  onChange,
  options,
  testId,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  testId: string;
}) {
  return (
    <RowShell title={title} description={description} controlId={testId}>
      {(control) => (
        <Select
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          controlSize="sm"
          className="w-[180px]"
          data-testid={testId}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </RowShell>
  );
}

export function ActionRow({
  title,
  description,
  actionLabel,
  onAction,
  disabled = false,
  status = null,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  status?: { text: string; tone: 'ok' | 'error' } | null;
}) {
  return (
    <RowShell title={title} description={description}>
      <div className="flex items-center gap-2.5">
        {status && (
          <span
            className={`max-w-[280px] whitespace-pre-wrap break-words text-xs ${
              status.tone === 'error' ? 'text-error' : 'text-success'
            }`}
            role={status.tone === 'error' ? 'alert' : 'status'}
            data-testid="action-row-status"
          >
            {status.text}
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="flex-shrink-0 text-sm"
          onClick={onAction}
          disabled={disabled}
        >
          {actionLabel}
        </Button>
      </div>
    </RowShell>
  );
}
