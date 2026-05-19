import { phase6DataSources } from "../../lib/phase6-data-sources";

const retrievalSections = [
  "资料库",
  "资料来源类型",
  "Embedding 刷新任务",
  "搜索请求",
  "命中预览",
  "证据跳转",
  "检索命中与重排",
  "Scene Packet 检索证据",
];

export default function RetrievalPage() {
  return (
    <main aria-labelledby="retrieval-title">
      <h1 id="retrieval-title">Retrieval Center 检索中心</h1>
      <p>管理资料来源类型、搜索请求、命中预览、证据跳转和 Scene Packet 的检索证据来源。</p>
      <section aria-labelledby="retrieval-sections">
        <h2 id="retrieval-sections">检索能力</h2>
        <ul>
          {retrievalSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="retrieval-data-sources-title">
        <h2 id="retrieval-data-sources-title">数据源契约</h2>
        <ul>
          {phase6DataSources.retrieval.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>：{source.output}（{source.status}）
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
