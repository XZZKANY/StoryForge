const workspaceCards = [
  {
    title: "团队工作区",
    description: "聚合成员、作品归属和席位上限，作为第三阶段平台外壳入口。",
  },
  {
    title: "成员席位",
    description: "显示编辑、审校和负责人等角色，支撑后续协作权限治理。",
  },
  {
    title: "作品归属",
    description: "让书、章、场景继续保持真相源，同时接入工作区范围。",
  },
];

export default function WorkspacePage() {
  return (
    <main aria-labelledby="workspace-title">
      <h1 id="workspace-title">Workspace Hub 团队工作区</h1>
      <p>管理工作区、成员席位和作品归属，为协作审批和商业化控制提供统一边界。</p>
      <ul>
        {workspaceCards.map((card) => (
          <li key={card.title}>
            <strong>{card.title}</strong>
            <p>{card.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
