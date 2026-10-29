import { useCallback, useState } from 'react';

import {
  readReasoningEffort,
  writeReasoningEffort,
  type ReasoningEffort,
} from '../../lib/reasoning-effort';

type ReasoningEffortState = {
  projectPath: string | null;
  effort: ReasoningEffort;
};

/** 当前项目的思考等级；换项目时在渲染期同步换值（同 useAgentPermission），不等 effect 那一帧。 */
export function useReasoningEffort(projectPath: string | null): {
  effort: ReasoningEffort;
  changeEffort: (next: ReasoningEffort) => void;
} {
  const [state, setState] = useState<ReasoningEffortState>(() => ({
    projectPath,
    effort: readReasoningEffort(projectPath),
  }));

  if (state.projectPath !== projectPath) {
    setState({ projectPath, effort: readReasoningEffort(projectPath) });
  }

  const changeEffort = useCallback(
    (next: ReasoningEffort) => {
      setState({ projectPath, effort: writeReasoningEffort(projectPath, next) });
    },
    [projectPath],
  );

  return { effort: state.effort, changeEffort };
}
