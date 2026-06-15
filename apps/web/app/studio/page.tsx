import { StudioPageContent } from './page-content';
export const dynamic = 'force-dynamic';

export default async function StudioPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <StudioPageContent searchParams={searchParams} />;
}
