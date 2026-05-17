const evaluationSections = [
  "一致性错误率",
  "修复成功率",
  "用户接受率",
  "未回收 open loop",
];

export default function EvaluationsPage() {
  return (
    <main aria-labelledby="evaluations-title">
      <h1 id="evaluations-title">Evaluation Lab 评测实验面板</h1>
      <p>维护评测基准集、运行实验并观察质量指标，为后续模型与 Prompt 策略迭代提供依据。</p>
      <section aria-labelledby="evaluation-sections">
        <h2 id="evaluation-sections">评测指标</h2>
        <ul>
          {evaluationSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
