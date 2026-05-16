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
    href: "/workspace",
    title: "Workspace Hub 团队工作区",
    description: "管理成员席位、作品归属和第三阶段平台外壳。",
  },
  {
    href: "/collaboration",
    title: "Collaboration 协作审批",
    description: "查看评论时间线、审批请求和协作事件。",
  },
  {
    href: "/commercial",
    title: "Commercial Controls 商业化控制",
    description: "查看套餐额度、席位上限与任务使用情况。",
  },
  {
    href: "/analytics",
    title: "Analytics Center 分析扩展",
    description: "跟踪审批通过率、修复采纳率和事件流统计。",
  },
  {
    href: "/providers",
    title: "Provider Gateway 模型接入层",
    description: "统一管理 LLM、Embedding 和 Reranker 提供方。",
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
