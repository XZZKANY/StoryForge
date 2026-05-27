import { homeContextEmpty } from './home-data';

export function HomeContextStrip() {
  const items = [
    { title: '当前作品', body: homeContextEmpty.currentBook },
    { title: '运行状态', body: homeContextEmpty.bookRun },
    { title: '下一步建议', body: homeContextEmpty.nextStep },
  ];
  return (
    <section
      aria-labelledby="home-context-title"
      className="!m-0 mt-10 !border-0 !bg-transparent !p-0 !shadow-none"
    >
      <h2 id="home-context-title" className="sr-only">
        当前上下文摘要
      </h2>
      <ul className="!m-0 grid grid-cols-1 gap-3 !p-0 md:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.title}
            className="!m-0 rounded-xl !border !border-stone-800 !bg-stone-900/40 !p-4 !shadow-none"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-stone-500">{item.title}</p>
            <p className="mt-2 text-sm text-stone-300">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
