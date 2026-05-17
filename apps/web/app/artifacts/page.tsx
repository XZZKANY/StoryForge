const artifactSections = [
  "导出物",
  "上传资料",
  "工作流快照",
  "评测报告",
];

export default function ArtifactsPage() {
  return (
    <main aria-labelledby="artifacts-title">
      <h1 id="artifacts-title">Artifact Center 制品中心</h1>
      <p>统一查看导出物、上传资料、工作流快照和评测报告，保持对象制品可追溯。</p>
      <section aria-labelledby="artifact-sections">
        <h2 id="artifact-sections">制品分类</h2>
        <ul>
          {artifactSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
