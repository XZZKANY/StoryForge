const runSections = [
  "模型运行日志",
  "Provider 解析结果",
  "Prompt Pack 来源",
  "任务恢复入口",
];

export default function RunsPage() {
  return (
    <main aria-labelledby="runs-title">
      <h1 id="runs-title">Run Center 运行日志中心</h1>
      <p>查看模型调用摘要、延迟、Token 使用量和任务恢复入口，支撑运行可观测性。</p>
      <section aria-labelledby="runs-sections">
        <h2 id="runs-sections">运行记录视角</h2>
        <ul>
          {runSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
