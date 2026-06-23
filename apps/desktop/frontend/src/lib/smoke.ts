/**
 * 冒烟测试入口
 * Rust 冒烟探针通过 window.__STORYFORGE_SMOKE__.openProject(path) 注入项目目录。
 * 这里把它与具体组件解耦：组件挂载时注册一个 loader，hook 收到的路径会转发给它。
 */

import { getApiConfig } from './api-client';
import { createRemoteFileSuggestion } from './assistant-suggestions';
import { emitAcceptCurrentFileSuggestion, emitFileSuggestion } from './assistant-events';

type SmokeApiConfig = Awaited<ReturnType<typeof getApiConfig>>;

type SmokeController = {
  openProject: (path: string) => void;
  openFile: (path: string) => void;
  proposeRevision: (params: {
    filePath: string;
    before: string;
    after: string;
    summary?: string;
    userIntent?: string;
    assistantSessionId?: number | null;
    issueIds?: string[];
    contextFiles?: string[];
  }) => void;
  acceptCurrentSuggestion: () => void;
  setCurrentEditorContent: (content: string) => boolean;
  getCurrentEditorContent: () => string | null;
  getApiConfig: () => ReturnType<typeof getApiConfig>;
  getApiConfigSnapshot: () => SmokeApiConfig | null;
};

type SmokeEditorController = {
  setContent: (content: string) => boolean;
  getContent: () => string | null;
};

declare global {
  interface Window {
    __STORYFORGE_SMOKE__?: SmokeController;
  }
}

let pendingSmokeProjectPath: string | null = null;
let pendingSmokeFilePath: string | null = null;
let smokeProjectLoader: ((path: string) => Promise<void> | void) | null = null;
let smokeFileLoader: ((path: string) => Promise<void> | void) | null = null;
let smokeEditorController: SmokeEditorController | null = null;
let apiConfigSnapshot: SmokeApiConfig | null = null;

function refreshApiConfigSnapshot() {
  void getApiConfig().then((config) => {
    apiConfigSnapshot = config;
  });
}

if (typeof window !== 'undefined') {
  refreshApiConfigSnapshot();
  window.__STORYFORGE_SMOKE__ = {
    openProject(path: string) {
      pendingSmokeProjectPath = path;
      void smokeProjectLoader?.(path);
    },
    openFile(path: string) {
      pendingSmokeFilePath = path;
      void smokeFileLoader?.(path);
    },
    proposeRevision(params) {
      emitFileSuggestion(
        createRemoteFileSuggestion({
          id: 'smoke-file-revision',
          filePath: params.filePath,
          before: params.before,
          after: params.after,
          summary: params.summary ?? 'Smoke proposed patch',
          model: 'smoke',
          userIntent: params.userIntent ?? 'smoke revision writeback',
          assistantSessionId: params.assistantSessionId ?? null,
          issueIds: params.issueIds ?? [],
          contextFiles: params.contextFiles ?? [],
        }),
      );
    },
    acceptCurrentSuggestion() {
      emitAcceptCurrentFileSuggestion();
    },
    setCurrentEditorContent(content: string) {
      return smokeEditorController?.setContent(content) ?? false;
    },
    getCurrentEditorContent() {
      return smokeEditorController?.getContent() ?? null;
    },
    getApiConfig,
    getApiConfigSnapshot() {
      return apiConfigSnapshot;
    },
  };
}

export function registerSmokeEditorController(controller: SmokeEditorController) {
  smokeEditorController = controller;
  return () => {
    if (smokeEditorController === controller) {
      smokeEditorController = null;
    }
  };
}

export function registerSmokeFileLoader(loader: (path: string) => Promise<void> | void) {
  smokeFileLoader = loader;
  if (pendingSmokeFilePath) {
    const path = pendingSmokeFilePath;
    pendingSmokeFilePath = null;
    void loader(path);
  }

  return () => {
    if (smokeFileLoader === loader) {
      smokeFileLoader = null;
    }
  };
}

export function registerSmokeProjectLoader(loader: (path: string) => Promise<void> | void) {
  smokeProjectLoader = loader;
  if (pendingSmokeProjectPath) {
    const path = pendingSmokeProjectPath;
    pendingSmokeProjectPath = null;
    void loader(path);
  }

  return () => {
    if (smokeProjectLoader === loader) {
      smokeProjectLoader = null;
    }
  };
}
