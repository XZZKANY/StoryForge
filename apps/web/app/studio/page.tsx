import { ScenePacketPanel } from "../../components/scene-packet/ScenePacketPanel";

const generationChain = [
  "确认故事目标",
  "检索素材证据",
  "生成 Scene Packet",
  "产出章节草稿",
  "提交修订工坊",
];

export default function StudioPage() {
  return (
    <main aria-labelledby="studio-title">
      <h1 id="studio-title">Studio 创作工作台</h1>
      <p>Studio 用于编排从素材检索到章节草稿的生成链路。</p>
      <section aria-labelledby="generation-chain-title">
        <h2 id="generation-chain-title">生成链路</h2>
        <ol>
          {generationChain.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <ScenePacketPanel />
    </main>
  );
}
