import { mkdir, access, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const apiDir = resolve(repoRoot, 'apps', 'api');
const sidecarDir = resolve(desktopDir, 'src-tauri', 'binaries');
const pyinstallerName = process.platform === 'win32' ? 'storyforge-api.exe' : 'storyforge-api';
const pyinstallerPath = resolve(sidecarDir, pyinstallerName);

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function commandOutput(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}\n${stderr}`));
    });
  });
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function targetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  if (process.env.TARGET) return process.env.TARGET;
  const version = await commandOutput('rustc', ['-vV']);
  const match = version.match(/^host:\s*(\S+)/m);
  if (!match) throw new Error('Could not determine Rust target triple from rustc -vV');
  return match[1];
}

await mkdir(sidecarDir, { recursive: true });
const triple = await targetTriple();
const sidecarName =
  process.platform === 'win32'
    ? `storyforge-api-${triple}.exe`
    : `storyforge-api-${triple}`;
const sidecarPath = resolve(sidecarDir, sidecarName);

// alembic 迁移脚本是 W2 起服收口的一部分（stamp/upgrade head），必须以 data 形式
// 打进冻结 exe，否则装机产品内 app/db/migrations.py 找不到脚本目录、回退 create_all。
// PyInstaller --add-data 的分隔符：Windows 用 ';'，其余用 ':'。
const addDataSep = process.platform === 'win32' ? ';' : ':';
const alembicDir = resolve(apiDir, 'alembic');

const pyinstallerArgs = [
  'run',
  '--with',
  'pyinstaller',
  'python',
  '-m',
  'PyInstaller',
  '--onefile',
  '--name',
  'storyforge-api',
  '--paths',
  apiDir,
  '--hidden-import',
  'app.main',
  '--collect-submodules',
  'app',
  '--add-data',
  `${alembicDir}${addDataSep}alembic`,
  '--distpath',
  sidecarDir,
  '--workpath',
  resolve(apiDir, 'build', 'pyinstaller'),
  '--specpath',
  resolve(apiDir, 'build'),
  'run_windows.py',
];

await run('uv', pyinstallerArgs, { cwd: apiDir });

if (!(await exists(pyinstallerPath))) {
  throw new Error(`Could not build or locate API sidecar at ${pyinstallerPath}`);
}
await copyFile(pyinstallerPath, sidecarPath);

console.log(`API sidecar ready: ${sidecarPath}`);
