const jobs = [
  { id: "job-001", name: "章节草稿生成", status: "等待人工确认", resumeHref: "/studio" },
  { id: "job-002", name: "修订评审", status: "正在运行", resumeHref: "/refinery" },
  { id: "job-003", name: "素材同步", status: "已完成", resumeHref: "/assets" },
];

export default function JobsPage() {
  return (
    <main aria-labelledby="jobs-title">
      <h1 id="jobs-title">Job Center 任务中心</h1>
      <p>Job Center 用于查看异步任务状态，并从任务回到相关工作区。</p>
      <section aria-labelledby="job-status-title">
        <h2 id="job-status-title">任务状态</h2>
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <strong>{job.name}</strong>，{job.status}
              <a href={job.resumeHref}>继续处理</a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
