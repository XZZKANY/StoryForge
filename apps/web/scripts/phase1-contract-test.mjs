import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const includesAll = (content, values, label) => {
  for (const value of values) {
    assert.ok(content.includes(value), `${label} ???????${value}`);
  }
};

const homePage = read("app/page.tsx");
includesAll(homePage, ["/studio", "/refinery", "/assets", "/jobs"], "????");
includesAll(homePage, ["Studio ?????", "Refinery ????", "Asset Center ????", "Job Center ????"], "????");

const routeContracts = [
  ["app/studio/page.tsx", ["Studio ?????", "???", "ScenePacketPanel"]],
  ["app/refinery/page.tsx", ["Refinery ????", "???", "????", "???", "??"]],
  ["app/assets/page.tsx", ["Asset Center ????", "????", "??"]],
  ["app/jobs/page.tsx", ["Job Center ????", "????", "????"]],
];

for (const [path, values] of routeContracts) {
  includesAll(read(path), values, path);
}

includesAll(read("components/scene-packet/ScenePacketPanel.tsx"), ["export function ScenePacketPanel", "????", "evidenceLinks", "href"], "ScenePacketPanel");
includesAll(read("components/judge-panel/JudgeIssueList.tsx"), ["export function JudgeIssueList", "????", "??", "severity", "location"], "JudgeIssueList");
includesAll(read("components/diff-viewer/RepairDiffViewer.tsx"), ["export function RepairDiffViewer", "??", "????", "originalText", "revisedText"], "RepairDiffViewer");
includesAll(read("tests/phase1-navigation.test.tsx"), ["????????", "ScenePacketPanel ??????", "JudgeIssueList ?????????", "RepairDiffViewer ?????????"], "??????");

console.log("??????????????????");
