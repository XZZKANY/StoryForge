import { phase6DataSources } from "../../lib/phase6-data-sources";

const runSections = [
  "模型运行日志",
  "Provider 解析结果",
  "Prompt Pack 来源",
  "Checkpoint 状态",
  "失败重试",
  "ModelRun adapter 契约",
  "任务恢复入口",
];

export default function RunsPage() {
  return (
    <main aria-labelledby="runs-title">
      <h1 id="runs-title">Run Center 运行日志中心</h1>
      <p>查看模型调用摘要、延迟、Token 使用量、Checkpoint 状态和失败重试入口，支撑运行可观测性。</p>
      <section aria-labelledby="runs-sections">
        <h2 id="runs-sections">运行记录视角</h2>
        <ul>
          {runSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="runs-data-sources-title">
        <h2 id="runs-data-sources-title">数据源契约</h2>
        <ul>
          {phase6DataSources.runs.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>：{source.output}（{source.status}）
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
