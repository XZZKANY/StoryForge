import { listWritebackRecovery, recoverWriteback } from '../api/writeback-recovery';
import type { AgentRunWaitingMessage, AgentSocketMessage, ApiConfig } from '../api/types';
import type { ExternalWriteback } from '../api/managed-agent-host';
import { getApiConfig } from '../api/config';
import {
  getAgentCapabilities,
  getExternalWriteback,
  prepareExternalWriteback,
  reconcileExternalWriteback,
} from '../api/external-writeback';
import { getAgentRunEvents } from '../api/agent-runs';
import { reconstructAgentResultFromEvents } from '../api/agent-run-events';
import { readAgentPermissionProfile, type AgentPermissionProfile } from '../agent-permission';
import { TauriFileSystem } from '../tauri-fs';
import { resolveProjectRelativePath } from '../project-context';
import type { WritebackIdentity, WritebackReceipt } from '../writeback-receipt-types';

export type GuardedExternalExecution = {
  validate: () => void;
  execute: (
    guard: () => void,
    beforeNativeAdmission: () => Promise<void>,
  ) => Promise<{
    receipt: WritebackReceipt;
    warning: string | null;
    retryAudit: (() => Promise<void>) | null;
  }>;
};
export type ExternalEditorPort = { acquire: (wait: ExternalWriteback) => GuardedExternalExecution };
export type ExternalWaitView = {
  key: string;
  project: string;
  frame: AgentRunWaitingMessage;
  wait: ExternalWriteback | null;
  phase: 'loading' | 'waiting' | 'applying' | 'observing' | 'running' | 'finished' | 'blocked';
  error: string | null;
  result: AgentSocketMessage | null;
  attempted: boolean;
  live: boolean;
  canRepairAudit: boolean;
};
export type Entry = Omit<ExternalWaitView, 'live' | 'canRepairAudit'> & {
  config: ApiConfig;
  epoch: string | null;
  retryAudit: (() => Promise<void>) | null;
  onResult?: (message: AgentSocketMessage) => void;
};
export type CoordinatorPorts = {
  list?: typeof listWritebackRecovery;
  recover?: typeof recoverWriteback;
  config: typeof getApiConfig;
  capabilities: typeof getAgentCapabilities;
  read: typeof getExternalWriteback;
  prepare: typeof prepareExternalWriteback;
  reconcile: typeof reconcileExternalWriteback;
  describe: (project: string, wait: ExternalWriteback) => Promise<WritebackIdentity>;
  profile: (project: string) => AgentPermissionProfile;
  result: (
    runId: string,
    sessionId: string,
    config: ApiConfig,
  ) => Promise<AgentSocketMessage | null>;
};
export const desktopCoordinatorPorts: CoordinatorPorts = {
  list: listWritebackRecovery,
  recover: recoverWriteback,
  config: getApiConfig,
  capabilities: getAgentCapabilities,
  read: getExternalWriteback,
  prepare: prepareExternalWriteback,
  reconcile: reconcileExternalWriteback,
  describe: (project, wait) =>
    TauriFileSystem.describeWritebackOperation(project, {
      operationKey: wait.operation_key,
      source: wait.source,
      path: resolveProjectRelativePath(project, wait.requested_path) ?? wait.requested_path,
      content: wait.proposal.after,
    }),
  profile: readAgentPermissionProfile,
  result: async (runId, sessionId, config) =>
    reconstructAgentResultFromEvents(await getAgentRunEvents(runId, { config }), {
      runId,
      sessionId,
    }),
};
