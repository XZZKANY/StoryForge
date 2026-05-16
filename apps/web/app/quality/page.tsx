const qualityCards = [
  {
    title: "开放问题",
    value: "1 条",
    description: "优先处理设定冲突和仍待复审的问题单。",
  },
  {
    title: "修复采纳率",
    value: "50%",
    description: "对照已接受补丁与全部补丁，观察修订命中率。",
  },
  {
    title: "任务成功率",
    value: "50%",
    description: "查看批量精修任务是否稳定完成，识别可恢复失败。",
  },
  {
    title: "系列记忆覆盖",
    value: "2 条",
    description: "确认关键世界规则和跨书约束已经沉淀到系列级记忆。",
  },
];

export default function QualityDashboardPage() {
  return (
    <main aria-labelledby="quality-title">
      <h1 id="quality-title">Quality Dashboard 质量看板</h1>
      <p>聚合开放问题、修复采纳率、任务成功率和系列记忆覆盖，帮助判断第二阶段稳定性。</p>
      <section aria-labelledby="quality-overview">
        <h2 id="quality-overview">质量指标概览</h2>
        <ul>
          {qualityCards.map((card) => (
            <li key={card.title}>
              <strong>{card.title}</strong>
              <p>{card.value}</p>
              <p>{card.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
