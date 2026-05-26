export type JudgeIssue = {
  id: string;
  severity: '高' | '中' | '低';
  location: string;
  message: string;
};

export type JudgeIssueListProps = {
  issues: JudgeIssue[];
};

export function JudgeIssueList({ issues }: JudgeIssueListProps) {
  if (issues.length === 0) {
    return <p>暂无评审问题。</p>;
  }
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
