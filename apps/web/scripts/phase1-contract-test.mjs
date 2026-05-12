import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const filters = process.argv.slice(2);
const shouldRunPhase1 = filters.length === 0 || filters.some((filter) => "phase1-navigation".includes(filter));

if (!shouldRunPhase1) {
  console.log(`没有匹配的本地测试：${filters.join(" ")}`);
  process.exit(0);
}

const tempDir = mkdtempSync(join(tmpdir(), "storyforge-phase1-"));
const tempTest = join(tempDir, "phase1-navigation.test.mjs");

try {
  const source = readFileSync(join(process.cwd(), "tests", "phase1-navigation.test.tsx"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.Preserve,
    },
  });
  writeFileSync(tempTest, output.outputText, "utf8");
  const result = spawnSync(process.execPath, ["--test", tempTest], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
