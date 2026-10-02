import { TauriFileSystem } from './tauri-fs';

const HEADER = '<!-- storyforge-writeback-audit-v1 ';
const COMPLETE = '\n<!-- storyforge-writeback-audit-complete -->\n';
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function verify(content: string, operationId: string, payloadHash: string): Promise<void> {
  const lineEnd = content.indexOf('\n');
  const header = content.slice(0, lineEnd);
  if (
    lineEnd < 0 ||
    !header.startsWith(HEADER) ||
    !header.endsWith(' -->') ||
    !content.endsWith(COMPLETE)
  ) {
    throw new Error('写回审计记录不完整；已保留原文件，请核对后修复，不会自动覆盖');
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(header.slice(HEADER.length, -4));
  } catch {
    throw new Error('写回审计记录封套损坏，不能当作补记成功');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error('写回审计记录封套无效');
  const fields = metadata as Record<string, unknown>;
  const body = content.slice(lineEnd + 1, -COMPLETE.length);
  if (
    fields.operationId !== operationId ||
    fields.payloadHash !== payloadHash ||
    fields.bodyHash !== (await digest(body))
  ) {
    throw new Error('写回审计记录身份、内容或摘要不匹配；已拒绝自动覆盖');
  }
}

/** Audit repair is exclusive-create + exact verification, never an overwrite by timestamp. */
export async function writeReceiptAudit(
  projectRoot: string,
  recordPath: string,
  operationId: string,
  semanticPayload: string,
  body: string,
  deliveryTicket?: string,
): Promise<void> {
  const payloadHash = await digest(semanticPayload);
  const readAndVerify = async () =>
    verify(
      await TauriFileSystem.readProjectFile(projectRoot, recordPath),
      operationId,
      payloadHash,
    );
  const metadata = { operationId, payloadHash, bodyHash: await digest(body) };
  const content = `${HEADER}${JSON.stringify(metadata)} -->\n${body}${COMPLETE}`;
  // Existing files are flushed but never overwritten by this native command.
  // Do not turn a sync failure into success merely because reads see cached bytes.
  await TauriFileSystem.createWritebackAudit(projectRoot, operationId, content, deliveryTicket);
  await readAndVerify();
}
