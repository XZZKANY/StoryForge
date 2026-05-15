const worldSections = [
  {
    title: "角色与关系",
    items: ["林岚：隐瞒左臂旧伤", "副官：掌握维修窗口", "远航舰队：维持表面秩序"],
  },
  {
    title: "世界规则",
    items: ["灯塔信号每七分钟重复一次", "旧航线记录只能由港口议会解锁"],
  },
  {
    title: "未回收伏笔",
    items: ["失真信号来源未明", "灯塔港底层仍有旧时代导航残片"],
  },
  {
    title: "跨书约束",
    items: ["林岚旧伤必须影响后续谈判", "灯塔信号需要在系列第二卷回收"],
  },
];

export default function WorldCenterPage() {
  return (
    <main aria-labelledby="world-title">
      <h1 id="world-title">World Center 世界观中心</h1>
      <p>聚合系列级记忆、作品资产和章节连续性，供创作前快速核对设定边界。</p>
      <section aria-labelledby="world-overview">
        <h2 id="world-overview">世界观聚合范围</h2>
        <ul>
          <li>系列级记忆用于保存跨书世界规则。</li>
          <li>素材中心资产用于展示角色、地点、组织和伏笔。</li>
          <li>章节连续性用于呈现下一章继承约束。</li>
        </ul>
      </section>
      {worldSections.map((section) => (
        <section key={section.title} aria-labelledby={section.title}>
          <h2 id={section.title}>{section.title}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
