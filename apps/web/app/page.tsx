import Link from "next/link";

const primaryEntrypoints = [
  {
    href: "/studio",
    title: "Studio 创作链路",
    description: "串起作品、章节目标、Scene Packet、Judge、Repair、批准回写与失败恢复证据。",
  },
  {
    href: "/retrieval",
    title: "Retrieval 证据链路",
    description: "核对资料源、刷新任务、搜索命中和 Scene Packet 可追溯证据。",
  },
  {
    href: "/runs",
    title: "Runs 运行链路",
    description: "查看 JobRun、Checkpoint、ModelRun 摘要和恢复任务边界。",
  },
] as const;

const governanceEntrypoints = [
  { href: "/refinery", title: "Refinery 批量精修诊断" },
  { href: "/artifacts", title: "Artifacts 制品治理" },
  { href: "/evaluations", title: "Evaluations 评测诊断" },
  { href: "/providers", title: "Providers 供应商诊断" },
] as const;

export default function HomePage() {
  return (
    <main aria-labelledby="home-title">
      <h1 id="home-title">StoryForge 可验证长篇创作流水线</h1>
      <p>
        StoryForge 是一个面向长篇小说生产的可验证创作流水线：每一次生成、检索、评审、修复、批准与回写，
        都必须留下可追溯证据，而不是只产出一段孤立文本。
      </p>
      <section aria-labelledby="primary-entrypoints-title">
        <h2 id="primary-entrypoints-title">上线前主入口</h2>
        <nav aria-label="创作流水线主入口">
          <ul>
            {primaryEntrypoints.map((entrypoint) => (
              <li key={entrypoint.href}>
                <Link href={entrypoint.href}>{entrypoint.title}</Link>
                <p>{entrypoint.description}</p>
              </li>
            ))}
          </ul>
        </nav>
      </section>
      <section aria-labelledby="governance-entrypoints-title">
        <h2 id="governance-entrypoints-title">治理与诊断入口</h2>
        <p>这些页面只展示已验证摘要和边界，不伪装为可用的全流程操作。</p>
        <nav aria-label="治理与诊断入口">
          <ul>
            {governanceEntrypoints.map((entrypoint) => (
              <li key={entrypoint.href}>
                <Link href={entrypoint.href}>{entrypoint.title}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </main>
  );
}
