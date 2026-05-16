const collaborationSections = [
  "评论时间线",
  "审批请求",
  "审批决策",
  "协作事件",
];

export default function CollaborationPage() {
  return (
    <main aria-labelledby="collaboration-title">
      <h1 id="collaboration-title">Collaboration 协作审批</h1>
      <p>围绕场景评论、版本审批和事件通知组织多人协作闭环。</p>
      <section aria-labelledby="collaboration-sections">
        <h2 id="collaboration-sections">协作能力</h2>
        <ul>
          {collaborationSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
