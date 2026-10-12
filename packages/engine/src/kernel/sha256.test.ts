import { expect, it } from 'vitest';
import { sha256Hex } from './sha256';

async function webCrypto(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

it('matches WebCrypto across block and padding boundaries', async () => {
  const lengths = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 1 << 20];
  for (const length of lengths) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + length) & 0xff);
    expect(sha256Hex(bytes), String(length)).toBe(await webCrypto(bytes));
  }
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256Hex('灵力')).toBe(await webCrypto(new TextEncoder().encode('灵力')));
});
