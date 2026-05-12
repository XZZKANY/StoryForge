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
  { label: "章节计划证据", href: "/assets#chapter-plan" },
  { label: "林岚人物卡", href: "/assets#lin-lan" },
  { label: "灯塔港地点卡", href: "/assets#lighthouse-port" },
];

export function ScenePacketPanel({
  title = "灯塔港重逢",
  goal = "让主角在补给船抵达前发现旧无线电留下的新线索。",
  requiredFacts = ["章节目标", "林岚的角色动机", "灯塔港的场景限制"],
  evidenceLinks = defaultEvidenceLinks,
}: ScenePacketPanelProps) {
  return (
    <section aria-labelledby="scene-packet-title">
      <h2 id="scene-packet-title">Scene Packet 场景包</h2>
      <h3>{title}</h3>
      <p>{goal}</p>
      <h4>必要事实</h4>
      <ul>
        {requiredFacts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <h4>证据链接</h4>
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
