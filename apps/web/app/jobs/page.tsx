const jobs = [
  { id: "job-001", name: "??????", status: "??????", resumeHref: "/studio" },
  { id: "job-002", name: "?????", status: "???", resumeHref: "/refinery" },
  { id: "job-003", name: "????", status: "???", resumeHref: "/assets" },
];

export default function JobsPage() {
  return (
    <main aria-labelledby="jobs-title">
      <h1 id="jobs-title">Job Center ????</h1>
      <p>Job Center ???????????????????????</p>
      <section aria-labelledby="job-status-title">
        <h2 id="job-status-title">????</h2>
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <strong>{job.name}</strong>?{job.status}
              <a href={job.resumeHref}>????</a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
