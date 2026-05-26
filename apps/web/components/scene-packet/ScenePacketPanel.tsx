export type EvidenceLink = {
  label: string;
  href: string;
};

export type ScenePacketPanelProps = {
  title?: string;
  goal?: string;
  requiredFacts?: string[];
  evidenceLinks?: EvidenceLink[];
};

export function ScenePacketPanel({
  title,
  goal,
  requiredFacts = [],
  evidenceLinks = [],
}: ScenePacketPanelProps) {
  return (
    <section aria-labelledby="scene-packet-title">
      <h2 id="scene-packet-title">Scene Packet 场景包</h2>
      {title ? <h3>{title}</h3> : <p>暂无场景标题。</p>}
      {goal ? <p>{goal}</p> : <p>暂无场景目标。</p>}
      <h4>必要事实</h4>
      {requiredFacts.length === 0 ? (
        <p>暂无必要事实。</p>
      ) : (
        <ul>
          {requiredFacts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      <h4>证据链接</h4>
      {evidenceLinks.length === 0 ? (
        <p>暂无证据链接。</p>
      ) : (
        <ul>
          {evidenceLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
