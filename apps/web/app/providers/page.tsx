const providerCapabilities = [
  "LLM",
  "Embedding",
  "Reranker",
  "图片生成或封面生成能力",
];

export default function ProviderGatewayPage() {
  return (
    <main aria-labelledby="providers-title">
      <h1 id="providers-title">Provider Gateway 模型接入层</h1>
      <p>管理多 Provider 配置、能力路由和模型别名，为后续可插拔接入做准备。</p>
      <section aria-labelledby="provider-capabilities">
        <h2 id="provider-capabilities">统一接入能力</h2>
        <ul>
          {providerCapabilities.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
