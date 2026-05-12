const assets = [
  { name: "章节计划", type: "文档", version: "v3", summary: "记录主线节奏和章节目标。" },
  { name: "林岚", type: "人物", version: "v2", summary: "维护角色动机、关系和口吻。" },
  { name: "灯塔港", type: "地点", version: "v1", summary: "沉淀场景地理、氛围和证据。" },
];

export default function AssetsPage() {
  return (
    <main aria-labelledby="assets-title">
      <h1 id="assets-title">Asset Center 素材中心</h1>
      <p>Asset Center 用于管理可被创作和修订链路复用的故事素材。</p>
      <section aria-labelledby="asset-list-title">
        <h2 id="asset-list-title">素材清单</h2>
        <ul>
          {assets.map((asset) => (
            <li key={asset.name}>
              <strong>{asset.name}</strong>，{asset.type}，版本 {asset.version}
              <p>{asset.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
