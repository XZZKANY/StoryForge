const retrievalSections = [
  "资料库",
  "Embedding 刷新任务",
  "检索命中与重排",
  "Scene Packet 检索证据",
];

export default function RetrievalPage() {
  return (
    <main aria-labelledby="retrieval-title">
      <h1 id="retrieval-title">Retrieval Center 检索中心</h1>
      <p>管理资料入库、检索刷新、命中重排和 Scene Packet 的检索证据来源。</p>
      <section aria-labelledby="retrieval-sections">
        <h2 id="retrieval-sections">检索能力</h2>
        <ul>
          {retrievalSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
