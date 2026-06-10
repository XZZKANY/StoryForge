'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';

type Project = {
  readonly id: number;
  readonly title: string;
  readonly href: string;
};

export function StudioProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/workspaces', {
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Array<{ id: number; title: string; slug: string }>) => {
        const mapped = data.slice(0, 5).map((w) => ({
          id: w.id,
          title: w.title,
          href: `/studio?workspace_id=${w.id}`,
        }));
        setProjects(mapped);
        setLoading(false);
      })
      .catch(() => {
        setError('项目暂不可用');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <li className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>加载中...</span>
        </div>
      </li>
    );
  }

  if (error) {
    return (
      <li className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
        <div className="px-2 py-1 text-xs text-muted-foreground">{error}</div>
      </li>
    );
  }

  if (projects.length === 0) {
    return (
      <li className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
        <div className="px-2 py-1 text-xs text-muted-foreground">暂无项目</div>
      </li>
    );
  }

  return (
    <>
      {projects.map((project) => (
        <li key={project.id} className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
          <Link
            href={project.href}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-normal text-muted-foreground no-underline transition-colors hover:bg-muted/10 hover:text-foreground dark:hover:bg-muted/15"
          >
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="min-w-0 truncate">{project.title}</span>
          </Link>
        </li>
      ))}
    </>
  );
}
