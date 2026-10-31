// SHA-1 只用来给观察项、提议生成稳定的短 id，不做完整性校验（那是 sha256.ts）。
export async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `<prefix>_` 加 `parts` 以 `|` 连接后 SHA-1 的前 12 位。 */
export async function sha1Id(prefix: string, parts: readonly string[]): Promise<string> {
  return `${prefix}_${(await sha1Hex(parts.join('|'))).slice(0, 12)}`;
}
