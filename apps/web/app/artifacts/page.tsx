import { phase6DataSources } from "../../lib/phase6-data-sources";

const artifactSections = [
  "导出物",
  "导出下载",
  "上传资料",
  "资料入库状态",
  "工作流快照",
  "快照追溯",
  "评测报告",
  "报告追溯",
];

export default function ArtifactsPage() {
  return (
    <main aria-labelledby="artifacts-title">
      <h1 id="artifacts-title">Artifact Center 制品中心</h1>
      <p>统一查看导出下载、资料入库状态、工作流快照追溯和评测报告追溯，保持对象制品可追溯。</p>
      <section aria-labelledby="artifact-sections">
        <h2 id="artifact-sections">制品分类</h2>
        <ul>
          {artifactSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="artifacts-data-sources-title">
        <h2 id="artifacts-data-sources-title">数据源契约</h2>
        <ul>
          {phase6DataSources.artifacts.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>：{source.output}（{source.status}）
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
