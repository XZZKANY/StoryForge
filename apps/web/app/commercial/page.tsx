const commercialMetrics = [
  "席位上限",
  "任务额度",
  "Token 额度",
  "套餐状态",
];

export default function CommercialPage() {
  return (
    <main aria-labelledby="commercial-title">
      <h1 id="commercial-title">Commercial Controls 商业化控制</h1>
      <p>展示工作区套餐、额度和当前占用情况，为后续 SaaS 控制面板打基础。</p>
      <section aria-labelledby="commercial-metrics">
        <h2 id="commercial-metrics">控制指标</h2>
        <ul>
          {commercialMetrics.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
