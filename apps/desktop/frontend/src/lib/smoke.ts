/**
 * 冒烟测试入口
 * Rust 冒烟探针通过 window.__STORYFORGE_SMOKE__.openProject(path) 注入项目目录。
 * 这里把它与具体组件解耦：组件挂载时注册一个 loader，hook 收到的路径会转发给它。
 */

type SmokeController = {
  openProject: (path: string) => void;
};

declare global {
  interface Window {
    __STORYFORGE_SMOKE__?: SmokeController;
  }
}

let pendingSmokeProjectPath: string | null = null;
let smokeProjectLoader: ((path: string) => Promise<void> | void) | null = null;

if (typeof window !== 'undefined') {
  window.__STORYFORGE_SMOKE__ = {
    openProject(path: string) {
      pendingSmokeProjectPath = path;
      void smokeProjectLoader?.(path);
    },
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
