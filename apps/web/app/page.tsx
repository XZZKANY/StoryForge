import Link from "next/link";

const workspaces = [
  {
    href: "/studio",
    title: "Studio 创作工作台",
    description: "从故事目标进入生成链路，组织场景包与证据素材。",
  },
  {
    href: "/refinery",
    title: "Refinery 修订工坊",
    description: "对照原文与候选稿，查看评审问题并生成修订差异。",
  },
  {
    href: "/assets",
    title: "Asset Center 素材中心",
    description: "集中管理人物、地点、章节计划和证据链接。",
  },
  {
    href: "/jobs",
    title: "Job Center 任务中心",
    description: "追踪长任务状态，并回到对应工作区继续处理。",
  },
  {
    href: "/world",
    title: "World Center 世界观中心",
    description: "查看系列级记忆、世界规则、未回收伏笔和跨书约束。",
  },
  {
    href: "/quality",
    title: "Quality Dashboard 质量看板",
    description: "聚合开放问题、修复采纳率、任务成功率和系列记忆覆盖。",
  },
];

export default function HomePage() {
  return (
    <main aria-labelledby="home-title">
      <h1 id="home-title">StoryForge 前端工作台</h1>
      <p>选择工作区，串联创作、修订、素材和任务管理流程。</p>
      <nav aria-label="前端工作台导航">
        <ul>
          {workspaces.map((workspace) => (
            <li key={workspace.href}>
              <Link href={workspace.href}>{workspace.title}</Link>
              <p>{workspace.description}</p>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
