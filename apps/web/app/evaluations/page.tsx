import { phase6DataSources } from "../../lib/phase6-data-sources";

const evaluationSections = [
  "评测集",
  "运行记录",
  "指标趋势",
  "失败样例",
  "一致性错误率",
  "修复成功率",
  "用户接受率",
  "未回收 open loop",
];

export default function EvaluationsPage() {
  return (
    <main aria-labelledby="evaluations-title">
      <h1 id="evaluations-title">Evaluation Lab 评测实验面板</h1>
      <p>维护评测集、运行记录、指标趋势和失败样例，为后续模型与 Prompt 策略迭代提供依据。</p>
      <section aria-labelledby="evaluation-sections">
        <h2 id="evaluation-sections">评测指标</h2>
        <ul>
          {evaluationSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="evaluations-data-sources-title">
        <h2 id="evaluations-data-sources-title">数据源契约</h2>
        <ul>
          {phase6DataSources.evaluations.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>：{source.output}（{source.status}）
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
