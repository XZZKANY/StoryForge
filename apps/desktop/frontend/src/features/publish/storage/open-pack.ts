import type { PublishBook } from '../model';
import { resolvePlatformPack } from '../packs';
import { projectOpenPackDir } from './paths';
import { writeProjectText } from './json-store';

export type OpenPackMeta = {
  title: string;
  penName: string;
  platform: string;
  blurb: string;
  tags: string[];
  projectPath: string;
};

export async function generateOpenPack(input: {
  projectRoot: string;
  book: PublishBook;
  penName: string;
  blurb: string;
  tags: string[];
}): Promise<string> {
  const dir = projectOpenPackDir(input.projectRoot);
  const meta: OpenPackMeta = {
    title: input.book.title,
    penName: input.penName,
    platform: String(input.book.platform),
    blurb: input.blurb,
    tags: input.tags,
    projectPath: input.book.path,
  };

  const pack = resolvePlatformPack(String(input.book.platform));
  await writeProjectText(input.projectRoot, `${dir}/README.md`, pack.openPackReadme);
  await writeProjectText(
    input.projectRoot,
    `${dir}/meta.json`,
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  await writeProjectText(input.projectRoot, `${dir}/blurb.txt`, `${input.blurb}\n`);
  await writeProjectText(input.projectRoot, `${dir}/tags.txt`, `${input.tags.join(', ')}\n`);
  await writeProjectText(
    input.projectRoot,
    `${dir}/checklist.md`,
    `# 开书检查清单\n\n- [ ] 书名\n- [ ] 简介\n- [ ] 标签\n- [ ] 首批章节\n- [ ] 回 SF 确认已开\n`,
  );
  await writeProjectText(
    input.projectRoot,
    `${dir}/chapters/README.md`,
    `将首批章节路径列于此，或在资源管理器中打开项目章节目录手动复制。\n`,
  );

  return dir;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  return false;
}
