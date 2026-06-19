/**
 * 冒烟测试入口
 * Rust 冒烟探针通过 window.__STORYFORGE_SMOKE__.openProject(path) 注入项目目录。
 * 这里把它与具体组件解耦：组件挂载时注册一个 loader，hook 收到的路径会转发给它。
 */

import { getApiConfig } from './api-client';

type SmokeApiConfig = Awaited<ReturnType<typeof getApiConfig>>;

type SmokeController = {
  openProject: (path: string) => void;
  openFile: (path: string) => void;
  getApiConfig: () => ReturnType<typeof getApiConfig>;
  getApiConfigSnapshot: () => SmokeApiConfig | null;
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
    getApiConfig,
    getApiConfigSnapshot() {
      return apiConfigSnapshot;
    },
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
