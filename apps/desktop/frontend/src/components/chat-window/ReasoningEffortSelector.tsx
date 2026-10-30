import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from '../../lib/reasoning-effort';
import { ComposerMenuSelect } from './ComposerMenuSelect';
import { useReasoningEffort } from './useReasoningEffort';

interface ReasoningEffortSelectorProps {
  projectPath: string | null;
  disabled?: boolean;
  busy?: boolean;
  fitToComposer?: boolean;
}

export function ReasoningEffortSelector({
  projectPath,
  disabled = false,
  busy = false,
  fitToComposer = false,
}: ReasoningEffortSelectorProps) {
  const { effort, changeEffort } = useReasoningEffort(projectPath);
  const label = REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label ?? '关';
  return (
    <ComposerMenuSelect<ReasoningEffort>
      options={REASONING_EFFORT_OPTIONS}
      selected={effort}
      onSelect={changeEffort}
      triggerText={`思考：${label}`}
      triggerTitle="思考等级（按作品记住，从下一次调用起生效）"
      ariaLabel="思考等级"
      menuLabel="选择思考等级"
      testId="reasoning-effort-selector"
      disabled={disabled}
      busy={busy}
      busyTitle="本轮正在按启动时的思考等级执行"
      fitToComposer={fitToComposer}
      footer="中转或模型不认时会报错，调回「关」即可。"
    />
  );
}
