const analyticsSections = [
  "审批通过率",
  "修复采纳率",
  "任务成功率",
  "Judge 失败类别",
  "事件流统计",
];

export default function AnalyticsPage() {
  return (
    <main aria-labelledby="analytics-title">
      <h1 id="analytics-title">Analytics Center 分析扩展</h1>
      <p>聚合协作、任务、修复与事件流指标，帮助团队评估平台运行质量。</p>
      <section aria-labelledby="analytics-sections">
        <h2 id="analytics-sections">分析视角</h2>
        <ul>
          {analyticsSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
