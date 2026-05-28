import { IdeShell } from '../../components/ide/shell/IdeShell';
import { parseIdeUrlState } from '../../components/ide/url/ide-url-state';

export default async function IdePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedParams)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  const state = parseIdeUrlState(params);
  return <IdeShell initialState={state} />;
}
