import { ScenePacketPanel } from "../../components/scene-packet/ScenePacketPanel";

const generationChain = [
  "??????",
  "??????",
  "?? Scene Packet",
  "??????",
  "??????",
];

export default function StudioPage() {
  return (
    <main aria-labelledby="studio-title">
      <h1 id="studio-title">Studio ?????</h1>
      <p>Studio ?????????????????</p>
      <section aria-labelledby="generation-chain-title">
        <h2 id="generation-chain-title">???</h2>
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
