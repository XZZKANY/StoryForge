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
];

const importRewrites = [
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
