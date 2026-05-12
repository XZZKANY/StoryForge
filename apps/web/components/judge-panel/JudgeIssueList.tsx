export type JudgeIssue = {
  id: string;
  severity: "??" | "??" | "??";
  location: string;
  message: string;
};

export type JudgeIssueListProps = {
  issues?: JudgeIssue[];
};

const defaultIssues: JudgeIssue[] = [
  {
    id: "issue-001",
    severity: "??",
    location: "? 3 ?? 2 ?",
    message: "?????????????????????",
  },
  {
    id: "issue-002",
    severity: "??",
    location: "? 5 ???",
    message: "???????????????????",
  },
];

export function JudgeIssueList({ issues = defaultIssues }: JudgeIssueListProps) {
  return (
    <section aria-labelledby="judge-issue-title">
      <h2 id="judge-issue-title">???</h2>
      <ul>
        {issues.map((issue) => (
          <li key={issue.id}>
            <strong>?????{issue.severity}</strong>
            <span>???{issue.location}</span>
            <p>{issue.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
