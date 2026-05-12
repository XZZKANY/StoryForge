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

const defaultEvidenceLinks: EvidenceLink[] = [
  { label: "???????", href: "/assets#chapter-plan" },
  { label: "???????", href: "/assets#lin-lan" },
  { label: "????????", href: "/assets#lighthouse-port" },
];

export function ScenePacketPanel({
  title = "???????",
  goal = "???????????????????????????",
  requiredFacts = ["????", "??????????", "??????????"],
  evidenceLinks = defaultEvidenceLinks,
}: ScenePacketPanelProps) {
  return (
    <section aria-labelledby="scene-packet-title">
      <h2 id="scene-packet-title">Scene Packet ???</h2>
      <h3>{title}</h3>
      <p>{goal}</p>
      <h4>????</h4>
      <ul>
        {requiredFacts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <h4>????</h4>
      <ul>
        {evidenceLinks.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
