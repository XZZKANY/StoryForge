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
      className="!m-0 mt-5 w-full !border-0 !bg-transparent !p-0 !shadow-none"
    >
      <h2 id="home-context-title" className="sr-only">
        当前上下文摘要
      </h2>
      <ul className="!m-0 grid grid-cols-1 gap-2.5 !p-0 md:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.title}
            className="!m-0 rounded-[13px] !border !border-[#363530] !bg-[#242422] !p-3 text-left !shadow-none"
          >
            <p className="m-0 text-[13px] font-bold text-[#e7dece]">{item.title}</p>
            <p className="m-0 mt-1 text-xs leading-relaxed text-[#8f887f]">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
