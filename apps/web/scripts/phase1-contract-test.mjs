import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const filters = process.argv.slice(2);
const testsDir = join(process.cwd(), 'tests');
const testFiles = existsSync(testsDir)
  ? readdirSync(testsDir)
      .filter((file) => /\.test\.tsx?$/.test(file))
      .sort()
  : [];
const selectedTestFiles =
  filters.length === 0
    ? testFiles
    : testFiles.filter((file) =>
        filters.some(
          (filter) => file.includes(filter) || file.replace(/\.test\.tsx?$/, '').includes(filter),
        ),
      );

if (selectedTestFiles.length === 0) {
  console.log(`没有匹配的本地测试：${filters.join(' ')}`);
  process.exit(0);
}

const tempDir = mkdtempSync(join(process.cwd(), '.tmp-storyforge-phase1-'));

// Runtime modules to transpile alongside tests so tests can import real production source.
// Each entry: { src: relative ts/tsx path, dst: relative .mjs path in tempDir }
const runtimeModules = [
  { src: 'next.config.ts', dst: 'next.config.mjs' },
  { src: 'lib/api-client.ts', dst: 'lib/api-client.mjs' },
  { src: 'lib/text-diff.ts', dst: 'lib/text-diff.mjs' },
  { src: 'app/studio/StudioFlow.tsx', dst: 'app/studio/StudioFlow.mjs' },
  { src: 'app/studio/approval-action-core.ts', dst: 'app/studio/approval-action-core.mjs' },
  { src: 'app/studio/validators.ts', dst: 'app/studio/validators.mjs' },
  { src: 'app/blueprints/api.tsx', dst: 'app/blueprints/api.mjs' },
  { src: 'app/book-runs/api.tsx', dst: 'app/book-runs/api.mjs' },
  { src: 'app/book-runs/audit.tsx', dst: 'app/book-runs/audit.mjs' },
  {
    src: 'components/diff-viewer/RepairDiffViewer.tsx',
    dst: 'components/diff-viewer/RepairDiffViewer.mjs',
  },
  {
    src: 'components/judge-panel/JudgeIssueList.tsx',
    dst: 'components/judge-panel/JudgeIssueList.mjs',
  },
  {
    src: 'components/scene-packet/ScenePacketPanel.tsx',
    dst: 'components/scene-packet/ScenePacketPanel.mjs',
  },
  { src: 'components/ui/LoadingSkeleton.tsx', dst: 'components/ui/LoadingSkeleton.mjs' },
  { src: 'components/ui/ErrorCard.tsx', dst: 'components/ui/ErrorCard.mjs' },
  {
    src: 'components/job-status/job-status-core.ts',
    dst: 'components/job-status/job-status-core.mjs',
  },
  { src: 'components/site-nav/site-nav-links.ts', dst: 'components/site-nav/site-nav-links.mjs' },
  { src: '../../packages/shared/src/diagnostic.ts', dst: 'packages/shared/src/diagnostic.mjs' },
  {
    src: 'components/ide/commands/command-client.ts',
    dst: 'components/ide/commands/command-client.mjs',
  },
  { src: 'components/ide/commands/registry.ts', dst: 'components/ide/commands/registry.mjs' },
  {
    src: 'components/ide/commands/registerBuiltinCommands.ts',
    dst: 'components/ide/commands/registerBuiltinCommands.mjs',
  },
  { src: 'components/ide/commands/palette.tsx', dst: 'components/ide/commands/palette.mjs' },
  { src: 'components/ide/keymap/index.ts', dst: 'components/ide/keymap/index.mjs' },
  { src: 'components/ide/performance/budgets.ts', dst: 'components/ide/performance/budgets.mjs' },
  {
    src: 'components/ide/personalization/preferences.ts',
    dst: 'components/ide/personalization/preferences.mjs',
  },
  {
    src: 'components/ide/personalization/PersonalizationControls.tsx',
    dst: 'components/ide/personalization/PersonalizationControls.mjs',
  },
  {
    src: 'components/ide/personalization/PersonalizationPanel.tsx',
    dst: 'components/ide/personalization/PersonalizationPanel.mjs',
  },
  { src: 'components/ide/agent/AgentSidebar.tsx', dst: 'components/ide/agent/AgentSidebar.mjs' },
  { src: 'components/ide/url/ide-url-state.ts', dst: 'components/ide/url/ide-url-state.mjs' },
  { src: 'components/ide/shell/ide-store.ts', dst: 'components/ide/shell/ide-store.mjs' },
  {
    src: 'components/ide/panels/ProblemsPanel.tsx',
    dst: 'components/ide/panels/ProblemsPanel.mjs',
  },
  { src: 'components/ide/views/DiffViewer.tsx', dst: 'components/ide/views/DiffViewer.mjs' },
  {
    src: 'components/ide/views/ContextInspector.tsx',
    dst: 'components/ide/views/ContextInspector.mjs',
  },
  {
    src: 'components/ide/views/StoryMemoryExplorer.tsx',
    dst: 'components/ide/views/StoryMemoryExplorer.mjs',
  },
  { src: 'components/ide/views/BookRunPanel.tsx', dst: 'components/ide/views/BookRunPanel.mjs' },
  {
    src: 'components/ide/views/BookRunEventsClient.tsx',
    dst: 'components/ide/views/BookRunEventsClient.mjs',
  },
  {
    src: 'components/ide/views/BookRunEventsPanel.tsx',
    dst: 'components/ide/views/BookRunEventsPanel.mjs',
  },
  {
    src: 'components/ide/views/ArtifactViewer.tsx',
    dst: 'components/ide/views/ArtifactViewer.mjs',
  },
  {
    src: 'components/ide/workflows/JudgeRepairWorkbench.tsx',
    dst: 'components/ide/workflows/JudgeRepairWorkbench.mjs',
  },
  { src: 'app/ide/page.tsx', dst: 'app/ide/page.mjs' },
  {
    src: 'components/ide/editors/ChapterEditor.tsx',
    dst: 'components/ide/editors/ChapterEditor.mjs',
  },
  {
    src: 'components/ide/editors/extensions/judgeIssueDecorations.ts',
    dst: 'components/ide/editors/extensions/judgeIssueDecorations.mjs',
  },
  { src: 'components/ide/shell/ActivityBar.tsx', dst: 'components/ide/shell/ActivityBar.mjs' },
  { src: 'components/ide/shell/SidePanel.tsx', dst: 'components/ide/shell/SidePanel.mjs' },
  { src: 'components/ide/shell/EditorArea.tsx', dst: 'components/ide/shell/EditorArea.mjs' },
  { src: 'components/ide/shell/BottomPanel.tsx', dst: 'components/ide/shell/BottomPanel.mjs' },
  { src: 'components/ide/shell/RightDock.tsx', dst: 'components/ide/shell/RightDock.mjs' },
  { src: 'components/ide/shell/IdeShell.tsx', dst: 'components/ide/shell/IdeShell.mjs' },
  {
    src: 'components/ide/shell/IdeShellPreferencesHydrator.tsx',
    dst: 'components/ide/shell/IdeShellPreferencesHydrator.mjs',
  },
];

const importRewrites = [
  ['../next.config', '../next.config.mjs'],
  ['../lib/api-client', '../lib/api-client.mjs'],
  ['../lib/text-diff', '../lib/text-diff.mjs'],
  ['../app/studio/StudioFlow', '../app/studio/StudioFlow.mjs'],
  ['../app/studio/approval-action-core', '../app/studio/approval-action-core.mjs'],
  ['../app/blueprints/api', '../app/blueprints/api.mjs'],
  ['../app/book-runs/api', '../app/book-runs/api.mjs'],
  ['../app/book-runs/audit', '../app/book-runs/audit.mjs'],
  ['../../lib/text-diff', '../../lib/text-diff.mjs'],
  ['../components/diff-viewer/RepairDiffViewer', '../components/diff-viewer/RepairDiffViewer.mjs'],
  ['../components/judge-panel/JudgeIssueList', '../components/judge-panel/JudgeIssueList.mjs'],
  [
    '../components/scene-packet/ScenePacketPanel',
    '../components/scene-packet/ScenePacketPanel.mjs',
  ],
  ['../components/ui/LoadingSkeleton', '../components/ui/LoadingSkeleton.mjs'],
  ['../components/ui/ErrorCard', '../components/ui/ErrorCard.mjs'],
  ['../components/job-status/job-status-core', '../components/job-status/job-status-core.mjs'],
  ['../components/site-nav/site-nav-links', '../components/site-nav/site-nav-links.mjs'],
  ['../../../packages/shared/src/diagnostic', '../packages/shared/src/diagnostic.mjs'],
  ['../../../../../packages/shared/src/diagnostic', '../packages/shared/src/diagnostic.mjs'],
  ['../../../../../../packages/shared/src/diagnostic', '../packages/shared/src/diagnostic.mjs'],
  ['../components/ide/agent/AgentSidebar', '../components/ide/agent/AgentSidebar.mjs'],
  ['../components/ide/commands/command-client', '../components/ide/commands/command-client.mjs'],
  ['../components/ide/commands/registry', '../components/ide/commands/registry.mjs'],
  [
    '../components/ide/commands/registerBuiltinCommands',
    '../components/ide/commands/registerBuiltinCommands.mjs',
  ],
  ['../components/ide/commands/palette', '../components/ide/commands/palette.mjs'],
  ['../components/ide/keymap/index', '../components/ide/keymap/index.mjs'],
  ['../components/ide/performance/budgets', '../components/ide/performance/budgets.mjs'],
  [
    '../components/ide/personalization/preferences',
    '../components/ide/personalization/preferences.mjs',
  ],
  [
    '../components/ide/personalization/PersonalizationControls',
    '../components/ide/personalization/PersonalizationControls.mjs',
  ],
  [
    '../components/ide/personalization/PersonalizationPanel',
    '../components/ide/personalization/PersonalizationPanel.mjs',
  ],
  ['../agent/AgentSidebar', '../agent/AgentSidebar.mjs'],
  ['./registry', './registry.mjs'],
  ['./command-client', './command-client.mjs'],
  ['./registerBuiltinCommands', './registerBuiltinCommands.mjs'],
  ['../commands/registry', '../commands/registry.mjs'],
  ['../commands/registerBuiltinCommands', '../commands/registerBuiltinCommands.mjs'],
  ['../editors/ChapterEditor', '../editors/ChapterEditor.mjs'],
  ['../panels/ProblemsPanel', '../panels/ProblemsPanel.mjs'],
  ['../views/DiffViewer', '../views/DiffViewer.mjs'],
  ['../components/ide/url/ide-url-state', '../components/ide/url/ide-url-state.mjs'],
  ['../components/ide/panels/ProblemsPanel', '../components/ide/panels/ProblemsPanel.mjs'],
  ['../components/ide/shell/EditorArea', '../components/ide/shell/EditorArea.mjs'],
  ['../components/ide/views/DiffViewer', '../components/ide/views/DiffViewer.mjs'],
  ['../components/ide/views/ContextInspector', '../components/ide/views/ContextInspector.mjs'],
  [
    '../components/ide/views/StoryMemoryExplorer',
    '../components/ide/views/StoryMemoryExplorer.mjs',
  ],
  ['../components/ide/views/BookRunPanel', '../components/ide/views/BookRunPanel.mjs'],
  ['../components/ide/views/BookRunEventsClient', '../components/ide/views/BookRunEventsClient.mjs'],
  ['../components/ide/views/BookRunEventsPanel', '../components/ide/views/BookRunEventsPanel.mjs'],
  ['../components/ide/views/ArtifactViewer', '../components/ide/views/ArtifactViewer.mjs'],
  [
    '../components/ide/workflows/JudgeRepairWorkbench',
    '../components/ide/workflows/JudgeRepairWorkbench.mjs',
  ],
  ['../app/ide/page', '../app/ide/page.mjs'],
  ['../components/ide/shell/RightDock', '../components/ide/shell/RightDock.mjs'],
  ['../components/ide/shell/IdeShell', '../components/ide/shell/IdeShell.mjs'],
  [
    '../components/ide/shell/IdeShellPreferencesHydrator',
    '../components/ide/shell/IdeShellPreferencesHydrator.mjs',
  ],
  ['../components/ide/editors/ChapterEditor', '../components/ide/editors/ChapterEditor.mjs'],
  [
    '../components/ide/editors/extensions/judgeIssueDecorations',
    '../components/ide/editors/extensions/judgeIssueDecorations.mjs',
  ],
  ['./ActivityBar', './ActivityBar.mjs'],
  ['./SidePanel', './SidePanel.mjs'],
  ['./EditorArea', './EditorArea.mjs'],
  ['./BottomPanel', './BottomPanel.mjs'],
  ['./RightDock', './RightDock.mjs'],
  ['./ide-store', './ide-store.mjs'],
  ['./IdeShell', './IdeShell.mjs'],
  ['../personalization/preferences', '../personalization/preferences.mjs'],
  ['../personalization/PersonalizationControls', '../personalization/PersonalizationControls.mjs'],
  ['./PersonalizationControls', './PersonalizationControls.mjs'],
  ['../personalization/PersonalizationPanel', '../personalization/PersonalizationPanel.mjs'],
  ['./preferences', './preferences.mjs'],
  ['../url/ide-url-state', '../url/ide-url-state.mjs'],
  ['../../components/ide/shell/IdeShell', '../../components/ide/shell/IdeShell.mjs'],
  [
    '../../components/ide/shell/IdeShellPreferencesHydrator',
    '../../components/ide/shell/IdeShellPreferencesHydrator.mjs',
  ],
  ['../../components/ide/url/ide-url-state', '../../components/ide/url/ide-url-state.mjs'],
  ['../../lib/api-client', '../../lib/api-client.mjs'],
  ['./extensions/judgeIssueDecorations', './extensions/judgeIssueDecorations.mjs'],
  ['../panels/ProblemsPanel', '../panels/ProblemsPanel.mjs'],
  ['../views/DiffViewer', '../views/DiffViewer.mjs'],
  ['../views/ContextInspector', '../views/ContextInspector.mjs'],
  ['../views/StoryMemoryExplorer', '../views/StoryMemoryExplorer.mjs'],
  ['../views/BookRunPanel', '../views/BookRunPanel.mjs'],
  ['../views/BookRunEventsPanel', '../views/BookRunEventsPanel.mjs'],
  ['../views/ArtifactViewer', '../views/ArtifactViewer.mjs'],
  ['./BookRunEventsClient', './BookRunEventsClient.mjs'],
  ['./BookRunPanel', './BookRunPanel.mjs'],
  ['../workflows/JudgeRepairWorkbench', '../workflows/JudgeRepairWorkbench.mjs'],
  ['./approval-action-core', './approval-action-core.mjs'],
  ['./validators', './validators.mjs'],
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteRuntimeImports(source) {
  let output = source;
  // Order matters: rewrite longest specifiers first so partial overlaps (e.g. "../lib/x" inside "../../lib/x") don't collide.
  const ordered = [...importRewrites].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of ordered) {
    // Only match when the specifier is followed by a quote (i.e. end of module specifier), so we never double-suffix.
    const pattern = new RegExp(`${escapeRegex(from)}(?=["'])`, 'g');
    output = output.replace(pattern, to);
  }
  return output;
}

function transpile(sourcePath, outputPath) {
  const source = readFileSync(sourcePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rewriteRuntimeImports(output.outputText), 'utf8');
}

try {
  for (const mod of runtimeModules) {
    const src = join(process.cwd(), mod.src);
    if (!existsSync(src)) continue;
    transpile(src, join(tempDir, mod.dst));
  }

  const tempTestsDir = join(tempDir, 'tests');
  mkdirSync(tempTestsDir, { recursive: true });

  const runnableTests = selectedTestFiles.map((file) => {
    const testFile = join(testsDir, file);
    if (!existsSync(testFile)) {
      throw new Error(`测试文件不存在：${testFile}`);
    }
    const outputPath = join(tempTestsDir, basename(file).replace(/\.tsx?$/, '.mjs'));
    transpile(testFile, outputPath);
    return outputPath;
  });

  const result = spawnSync(process.execPath, ['--test', ...runnableTests], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  process.exitCode = result.status ?? 1;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`phase1-contract-test failed: ${message}`);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
