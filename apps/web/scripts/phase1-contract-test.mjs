import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const filters = process.argv.slice(2);
const testsDir = join(process.cwd(), "tests");
const testFiles = existsSync(testsDir)
  ? readdirSync(testsDir)
      .filter((file) => /\.test\.tsx?$/.test(file))
      .sort()
  : [];
const selectedTestFiles =
  filters.length === 0
    ? testFiles
    : testFiles.filter((file) => filters.some((filter) => file.includes(filter) || file.replace(/\.test\.tsx?$/, "").includes(filter)));

if (selectedTestFiles.length === 0) {
  console.log(`没有匹配的本地测试：${filters.join(" ")}`);
  process.exit(0);
}

const tempDir = mkdtempSync(join(process.cwd(), ".tmp-storyforge-phase1-"));
const tempTestsDir = join(tempDir, "tests");
const tempLibDir = join(tempDir, "lib");
const tempStudioDir = join(tempDir, "app", "studio");

function rewriteRuntimeImports(source) {
  return source
    .replaceAll("../lib/api-client", "../lib/api-client.mjs")
    .replaceAll("../app/studio/StudioFlow", "../app/studio/StudioFlow.mjs")
    .replaceAll("../app/studio/approval-action-core", "../app/studio/approval-action-core.mjs")
    .replaceAll("./approval-action-core", "./approval-action-core.mjs")
    .replaceAll("./validators", "./validators.mjs");
}

function transpile(sourcePath, outputPath) {
  const source = readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rewriteRuntimeImports(output.outputText), "utf8");
}

try {
  mkdirSync(tempTestsDir, { recursive: true });
  mkdirSync(tempLibDir, { recursive: true });
  transpile(join(process.cwd(), "lib", "api-client.ts"), join(tempLibDir, "api-client.mjs"));
  transpile(join(process.cwd(), "app", "studio", "StudioFlow.tsx"), join(tempStudioDir, "StudioFlow.mjs"));
  transpile(join(process.cwd(), "app", "studio", "approval-action-core.ts"), join(tempStudioDir, "approval-action-core.mjs"));
  transpile(join(process.cwd(), "app", "studio", "validators.ts"), join(tempStudioDir, "validators.mjs"));

  const runnableTests = selectedTestFiles.map((file) => {
    const testFile = join(testsDir, file);
    if (!existsSync(testFile)) {
      throw new Error(`测试文件不存在：${testFile}`);
    }
    const outputPath = join(tempTestsDir, basename(file).replace(/\.tsx?$/, ".mjs"));
    transpile(testFile, outputPath);
    return outputPath;
  });

  const result = spawnSync(process.execPath, ["--test", ...runnableTests], {
    cwd: process.cwd(),
    stdio: "inherit",
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
