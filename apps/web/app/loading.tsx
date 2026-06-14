export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-accent border-t-transparent" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">正在加载 StoryForge 工作台</h1>
        <p className="mt-2 text-muted">正在读取真实 API 数据，请稍候。</p>
      </div>
    </main>
  );
}
