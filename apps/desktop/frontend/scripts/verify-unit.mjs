import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const filters = process.argv.slice(2);
const cwd = process.cwd();
const srcDir = join(cwd, 'src');
const testsDir = join(cwd, 'tests');
const tempDir = mkdtempSync(join(cwd, '.tmp-storyforge-desktop-unit-'));
const tempNodeModules = join(tempDir, 'node_modules');

function loadTypeScript() {
  const candidates = [cwd, join(cwd, '..', '..', 'web'), join(cwd, '..', '..', '..')];
  for (const candidate of candidates) {
    try {
      return createRequire(join(candidate, 'package.json'))('typescript');
    } catch {
      // Try the next workspace package.
    }
  }
  throw new Error('Unable to resolve the workspace TypeScript package.');
}

const ts = loadTypeScript();

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function isSourceFile(file) {
  return /\.(ts|tsx)$/.test(file) && !/\.d\.ts$/.test(file);
}

function toTempModulePath(sourcePath) {
  const rel = relative(cwd, sourcePath);
  return join(tempDir, rel).replace(/\.(ts|tsx)$/, '.mjs');
}

function normalizeSpecifier(specifier) {
  if (!specifier.startsWith('.')) return specifier;
  if (/\.(css|json|mjs|js|jsx|ts|tsx)$/.test(specifier)) {
    return specifier.replace(/\.(ts|tsx)$/, '.mjs');
  }
  return `${specifier}.mjs`;
}

function rewriteImports(source) {
  return source.replace(
    /(from\s+["']|import\s*\(\s*["'])(\.[^"']+)(["'])/g,
    (_match, prefix, specifier, suffix) => `${prefix}${normalizeSpecifier(specifier)}${suffix}`,
  );
}

function transpile(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const outputPath = toTempModulePath(sourcePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rewriteImports(output.outputText), 'utf8');
  return outputPath;
}

function writeModule(file, source) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, 'utf8');
}

function createRuntimeStubs() {
  const requireFromFrontend = createRequire(join(cwd, 'package.json'));
  const reactUrl = pathToFileURL(requireFromFrontend.resolve('react')).href;
  const jsxRuntimeUrl = pathToFileURL(requireFromFrontend.resolve('react/jsx-runtime')).href;
  const jsxDevRuntimeUrl = pathToFileURL(requireFromFrontend.resolve('react/jsx-dev-runtime')).href;
  const reactDomServerUrl = pathToFileURL(requireFromFrontend.resolve('react-dom/server')).href;

  writeModule(
    join(tempNodeModules, 'react', 'package.json'),
    JSON.stringify({
      type: 'module',
      main: './index.js',
      exports: {
        '.': './index.js',
        './jsx-runtime': './jsx-runtime.js',
        './jsx-dev-runtime': './jsx-dev-runtime.js',
      },
    }),
  );
  writeModule(
    join(tempNodeModules, 'react', 'index.js'),
    `export * from ${JSON.stringify(reactUrl)};\nimport React from ${JSON.stringify(reactUrl)};\nexport default React;\n`,
  );
  writeModule(
    join(tempNodeModules, 'react', 'jsx-runtime.js'),
    `export * from ${JSON.stringify(jsxRuntimeUrl)};\n`,
  );
  writeModule(
    join(tempNodeModules, 'react', 'jsx-dev-runtime.js'),
    `export * from ${JSON.stringify(jsxDevRuntimeUrl)};\n`,
  );

  writeModule(
    join(tempNodeModules, 'react-dom', 'package.json'),
    JSON.stringify({ type: 'module', exports: { './server': './server.js' } }),
  );
  writeModule(
    join(tempNodeModules, 'react-dom', 'server.js'),
    `export * from ${JSON.stringify(reactDomServerUrl)};\n`,
  );

  writeModule(
    join(tempNodeModules, 'monaco-editor', 'package.json'),
    JSON.stringify({ type: 'module', main: './index.js' }),
  );
  writeModule(
    join(tempNodeModules, 'monaco-editor', 'index.js'),
    'export const editor = {};\nexport const KeyMod = {};\nexport const KeyCode = {};\n',
  );

  writeModule(
    join(tempNodeModules, '@tauri-apps', 'api', 'package.json'),
    JSON.stringify({
      type: 'module',
      exports: { './core': './core.js', './event': './event.js' },
    }),
  );
  writeModule(
    join(tempNodeModules, '@tauri-apps', 'api', 'core.js'),
    'export async function invoke(){ throw new Error("Tauri invoke is unavailable in unit tests."); }\n',
  );
  writeModule(
    join(tempNodeModules, '@tauri-apps', 'api', 'event.js'),
    'export async function listen(){ return () => {}; }\n',
  );
}

try {
  createRuntimeStubs();

  for (const sourceFile of walk(srcDir).filter(isSourceFile)) {
    transpile(sourceFile);
  }

  const testFiles = walk(testsDir)
    .filter(isSourceFile)
    .filter((file) => /\.test\.(ts|tsx)$/.test(basename(file)))
    .filter((file) => {
      if (filters.length === 0) return true;
      const rel = relative(testsDir, file).split(sep).join('/');
      const stem = rel.replace(/\.test\.(ts|tsx)$/, '');
      return filters.some((filter) => rel.includes(filter) || stem.includes(filter));
    })
    .sort();

  if (testFiles.length === 0) {
    console.log(`No desktop frontend tests matched: ${filters.join(' ')}`);
    process.exit(0);
  }

  const runnableTests = testFiles.map(transpile);
  const result = spawnSync(process.execPath, ['--test', ...runnableTests], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`verify-unit failed: ${message}`);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
