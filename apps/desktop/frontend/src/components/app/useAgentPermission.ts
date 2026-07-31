import { useCallback, useState } from 'react';

import {
  readAgentPermissionProfile,
  writeAgentPermissionProfile,
  type AgentPermissionProfile,
} from '../../lib/agent-permission';

type AgentPermissionState = {
  projectPath: string | null;
  profile: AgentPermissionProfile;
};

/**
 * 当前项目的 Agent 权限档位。
 *
 * 换项目时在**渲染期**同步换档（React 的 adjust-state-on-prop-change 写法），不用 useEffect：
 * effect 要等一帧才跑，那一帧里作者按回车发出去的就是上一个项目的授权。
 */
export function useAgentPermission(projectPath: string | null): {
  profile: AgentPermissionProfile;
  changeProfile: (next: AgentPermissionProfile) => void;
} {
  const [state, setState] = useState<AgentPermissionState>(() => ({
    projectPath,
    profile: readAgentPermissionProfile(projectPath),
  }));

  if (state.projectPath !== projectPath) {
    setState({ projectPath, profile: readAgentPermissionProfile(projectPath) });
  }

  const changeProfile = useCallback(
    (next: AgentPermissionProfile) => {
      setState({ projectPath, profile: writeAgentPermissionProfile(projectPath, next) });
    },
    [projectPath],
  );

  return { profile: state.profile, changeProfile };
}
