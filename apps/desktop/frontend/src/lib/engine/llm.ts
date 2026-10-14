import { Channel, invoke } from '@tauri-apps/api/core';
import {
  HttpTransportError,
  LlmConfigError,
  LlmConfigFileError,
  type HttpPort,
  type HttpResponse,
  type LlmSource,
  type SecretContext,
} from '@storyforge/engine';
import { assertTauriRuntime } from '../tauri-env';

export type LlmSlot = 'main' | 'polish';

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringRecord(value: unknown): value is Record<string, string> {
  return plainObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

// Native refusals keep their class: config files are 503, egress policy is a 422 config error.
function nativeFailure(error: unknown): Error {
  if (error instanceof Error) return error;
  if (plainObject(error)) {
    const { kind, message } = error;
    if (typeof message === 'string') {
      if (kind === 'config') return new LlmConfigFileError(message);
      if (kind === 'refused') return new LlmConfigError(message);
      if (kind === 'connect' || kind === 'timeout' || kind === 'read')
        return new HttpTransportError(kind, message);
    }
    return Object.assign(new TypeError('Invalid Native LLM error'), { cause: error });
  }
  return new Error(typeof error === 'string' ? error : 'Native LLM request failed');
}

async function call(command: string, args: Record<string, unknown>): Promise<unknown> {
  assertTauriRuntime(command);
  try {
    return await invoke<unknown>(command, args);
  } catch (error) {
    throw nativeFailure(error);
  }
}

/**
 * 配置源与密钥快照。key 不出 Rust：`STORYFORGE_LLM_API_KEY` 只是占位串，
 * Rust 发请求时才换成真 key，所以 WebView 里能脱敏的也只有这个占位串。
 */
export async function nativeLlmSource(
  slot: LlmSlot,
): Promise<{ source: LlmSource; secrets: SecretContext }> {
  const value = await call('get_engine_llm_source', { slot });
  if (!stringRecord(value)) throw new TypeError('Invalid Native LLM source');
  const source = Object.freeze({ ...value });
  const credential = source.STORYFORGE_LLM_API_KEY;
  return { source, secrets: { values: credential ? [credential] : [] } };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Channel 推来的响应体：按到达顺序排队，单个消费者逐块取。 */
class NativeBody implements AsyncIterable<Uint8Array> {
  private readonly chunks: Uint8Array[] = [];
  private failure: Error | null = null;
  private wake: (() => void) | null = null;
  finished = false;

  push(message: unknown): void {
    if (this.finished) return;
    if (plainObject(message) && message.event === 'chunk' && typeof message.data === 'string')
      this.chunks.push(fromBase64(message.data));
    else if (plainObject(message) && message.event === 'end') this.finished = true;
    else if (
      plainObject(message) &&
      message.event === 'error' &&
      (message.kind === 'read' || message.kind === 'timeout') &&
      typeof message.detail === 'string'
    ) {
      this.failure = new HttpTransportError(message.kind, message.detail);
      this.finished = true;
    } else {
      this.failure = new TypeError('Invalid Native LLM body event');
      this.finished = true;
    }
    this.wake?.();
    this.wake = null;
  }

  close(): void {
    this.chunks.length = 0;
    this.finished = true;
    this.wake?.();
    this.wake = null;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      const chunk = this.chunks.shift();
      if (chunk) {
        yield chunk;
        continue;
      }
      if (this.failure) throw this.failure;
      if (this.finished) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

/** 引擎出网端口：请求交 Rust 代发（占位串换真 key、只放行已配置 baseUrl 同源）。 */
export function nativeHttpPort(slot: LlmSlot): HttpPort {
  return {
    async send(request): Promise<HttpResponse> {
      const body = new NativeBody();
      const channel = new Channel<unknown>((message) => body.push(message));
      const head = await call('engine_llm_send', {
        slot,
        request: {
          url: request.url,
          method: request.method,
          headers: { ...request.headers },
          body: request.body === null ? null : toBase64(request.body),
          timeoutSeconds: request.timeoutSeconds,
        },
        onBody: channel,
      });
      if (
        !plainObject(head) ||
        typeof head.id !== 'number' ||
        !Number.isSafeInteger(head.id) ||
        typeof head.status !== 'number' ||
        !Number.isInteger(head.status) ||
        head.status < 100 ||
        head.status > 599 ||
        !stringRecord(head.headers)
      )
        throw new TypeError('Invalid Native LLM response head');
      const id = head.id;
      return {
        status: head.status,
        headers: Object.freeze({ ...head.headers }),
        body,
        close() {
          if (body.finished) return;
          body.close();
          void invoke('engine_llm_close', { id }).catch(() => undefined);
        },
      };
    },
  };
}
