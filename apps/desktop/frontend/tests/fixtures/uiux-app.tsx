// Real App/Editor/Chat components, isolated in-memory sample. Never a product route.
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { App } from '../../src/App';
import { buildSampleStoryProjectFiles } from '../../src/lib/project-context';
import { APP_SETTINGS_KEY, DEFAULT_APP_SETTINGS } from '../../src/lib/user-settings';
import { applyTheme } from '../../src/lib/theme';
import { invalidateFileSystemCache, type FileEntry } from '../../src/lib/tauri-fs';

const project = 'D:/uiux-memory/StoryForge 示例项目';
const sample = buildSampleStoryProjectFiles(project);
const content = new Map(sample.map((file) => [file.path.replaceAll('\\', '/'), file.content]));
content.set(
  `${project}/.storyforge/book.json`,
  JSON.stringify({
    version: 1,
    title: 'StoryForge 示例项目',
    synopsis:
      '一份供你自由探索的样例小说。从作品档案出发，进入章节、记录灵感，再与 Agent 一起打磨故事。此页面只使用内存样例，不读取或写入你的真实作品。',
    tags: ['样例小说', '本地创作'],
    wordGoal: 100000,
    cover: null,
  }),
);
let failed = false;
let readGate: Promise<void> | null = null;
let releaseRead: (() => void) | null = null;
const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/$/, '');
const dirs = new Set<string>([project]);
for (const path of content.keys()) {
  let parent = path.slice(0, path.lastIndexOf('/'));
  while (parent.startsWith(project)) {
    dirs.add(parent);
    parent = parent.slice(0, parent.lastIndexOf('/'));
  }
}
window.__STORYFORGE_MOCK_FS__ = {
  async readFile(path) {
    if (readGate) await readGate;
    const normalized = normalize(path);
    if (failed) throw new Error('验收注入：文件读取暂时失败');
    if (!content.has(normalized)) throw new Error(`样例文件不存在：${normalized}`);
    return content.get(normalized)!;
  },
  writeFile(path, value) {
    if (failed) throw new Error('验收注入：写入失败');
    content.set(normalize(path), value);
  },
  createDir(path) {
    dirs.add(normalize(path));
  },
  pathExists(path) {
    return dirs.has(normalize(path)) || content.has(normalize(path));
  },
  listDir(path, recursive) {
    if (failed) throw new Error('验收注入：目录读取暂时失败');
    const prefix = normalize(path) + '/';
    const entries: FileEntry[] = [];
    for (const file of [...dirs, ...content.keys()]) {
      if (!file.startsWith(prefix) || (!recursive && file.slice(prefix.length).includes('/')))
        continue;
      const isDir = dirs.has(file);
      entries.push({
        path: file,
        name: file.slice(file.lastIndexOf('/') + 1),
        isDir,
        size: isDir ? 0 : new TextEncoder().encode(content.get(file)).length,
        modified: 0,
        extension: isDir ? null : (file.split('.').pop() ?? null),
      });
    }
    return entries;
  },
};
// No provider or local API traffic. Offline states are genuine UI handling of a 503.
const fetchOriginal = window.fetch;
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health')) {
    return new Response(JSON.stringify({ detail: 'UI 验收夹具：后端离线' }), { status: 503 });
  }
  return fetchOriginal(input, init);
};
const keys = [
  APP_SETTINGS_KEY,
  'storyforge:workspace-session',
  'storyforge:recent-projects',
  'storyforge:shell:view',
  'storyforge:shell:layoutMode',
  'storyforge:shell:sidebarHidden',
];
const backup = new Map(keys.map((key) => [key, localStorage.getItem(key)]));
localStorage.setItem(
  APP_SETTINGS_KEY,
  JSON.stringify({ ...DEFAULT_APP_SETTINGS, restoreLastSession: false, autoSave: false }),
);
window.addEventListener('pagehide', () => {
  for (const [key, value] of backup) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
});
createRoot(document.getElementById('fixture-controls')!).render(
  <div
    className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-xs text-muted shadow-lg"
    style={{
      position: 'fixed',
      left: 16,
      bottom: 32,
      zIndex: 50,
      maxWidth: 'calc(100vw - 32px)',
    }}
    aria-label="独立 UI 验收控件"
  >
    <strong>内存样例 · 非真实作品/模型</strong>
    <button onClick={() => window.__STORYFORGE_SMOKE__?.openProject(project)}>打开样例作品</button>
    <button onClick={() => applyTheme('dark')}>深色验收</button>
    <button onClick={() => applyTheme('light')}>浅色验收</button>
    <button
      onClick={() => {
        readGate ??= new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        invalidateFileSystemCache(project);
      }}
    >
      暂停读取
    </button>
    <button
      onClick={() => {
        releaseRead?.();
        readGate = null;
        releaseRead = null;
      }}
    >
      恢复读取
    </button>
    <button
      onClick={() => {
        failed = !failed;
        invalidateFileSystemCache(project);
      }}
    >
      切换读取失败
    </button>
    <button
      onClick={() => {
        const file = sample[2];
        window.__STORYFORGE_SMOKE__?.proposeRevision({
          filePath: file.path,
          before: file.content,
          after: `${file.content}\n\n（验收补丁：只用于检查差异审阅）`,
        });
      }}
    >
      提出验收补丁
    </button>
  </div>,
);
createRoot(document.getElementById('root')!).render(<App />);
