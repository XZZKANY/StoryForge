export type JudgeIssue = {
  id: string;
  severity: "高" | "中" | "低";
  location: string;
  message: string;
};

export type JudgeIssueListProps = {
  issues?: JudgeIssue[];
};

const defaultIssues: JudgeIssue[] = [
  {
    id: "issue-001",
    severity: "高",
    location: "第 3 段第 2 句",
    message: "候选稿遗漏旧无线电线索，削弱后续修订依据。",
  },
  {
    id: "issue-002",
    severity: "中",
    location: "第 5 段开头",
    message: "场景时间从清晨跳到夜晚，需要补充过渡。",
  },
];

export function JudgeIssueList({ issues = defaultIssues }: JudgeIssueListProps) {
  return (
    <section aria-labelledby="judge-issue-title">
      <h2 id="judge-issue-title">评审问题</h2>
      <ul>
        {issues.map((issue) => (
          <li key={issue.id}>
            <strong>严重级别：{issue.severity}</strong>
            <span>位置：{issue.location}</span>
            <p>{issue.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
