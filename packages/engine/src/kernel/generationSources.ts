import { dumpJson } from './json';
import {
  redactSensitive,
  redactSensitiveText,
  type PlainJson,
  type SecretContext,
} from './redaction';
import { sha256Hex } from './sha256';

/** 最终交付证据超过字节预算（Python 的 ValueError）：写作入口据此拒绝调用模型。 */
export class GenerationSourceBudgetError extends RangeError {}

export const MAX_SOURCE_REFS = 32;
export const MAX_MANIFEST_BYTES = 20_000;

export function bytesSha256(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

export function textSha256(text: string): string {
  return sha256Hex(text);
}

export function selectionSha256(value: unknown): string {
  return textSha256(
    dumpJson(value, { ensureAscii: false, sortKeys: true, separators: [',', ':'] }),
  );
}

/** Python os.path.normcase：Windows 上统一反斜杠并转小写。 */
export function normcase(path: string, platform: 'windows' | 'posix'): string {
  return platform === 'windows' ? path.replace(/\//g, '\\').toLowerCase() : path;
}

const PYTHON_STRIP_NEWLINES = /^\n+|\n+$/g;
const codePoints = (text: string) => Array.from(text).length;

export type SourceRow = {
  source_id: string;
  purpose: string;
  relative_path: string | null;
  selection_source: 'independent_writer_read' | 'request_value';
  evidence_state: 'observed' | 'unverified' | 'unavailable';
  source_complete: boolean | null;
  observed_bytes: number | null;
  observed_bytes_sha256: string | null;
  file_bytes_sha256: string | null;
  content_sha256: string | null;
  observed_content_sha256: string | null;
  omission_reason: string | null;
};

export type ProjectionRow = {
  purpose: string;
  source_ids: string[];
  requested_source_count: number;
  selected_source_count: number;
  channel: 'system' | 'user';
  truncated: boolean;
  omission_reason: string | null;
  source_span: { start: number; end: number; basis: string; unit: string } | null;
  transformation: string;
};

export type ObserveOptions = {
  raw?: Uint8Array | null;
  text?: string | null;
  complete?: boolean | null;
  omissionReason?: string | null;
  origin?: 'project_file' | 'supplied_value';
  /** 读者给出的路径不在项目内。 */
  outsideProject?: boolean;
};

export type ProjectOptions = {
  sourcePurpose?: string | readonly string[];
  channel?: 'system' | 'user';
  truncated?: boolean;
  omissionReason?: string | null;
  sourceSpan?: ProjectionRow['source_span'];
  transformation?: string;
};

/**
 * 一次写作请求里各个独立读者实际读到的来源：只导出哈希、相对身份与取舍，不导出正文。
 * Python 用 ContextVar 隐式传递；这里由调用方显式传入，不存在全局可变状态。
 */
export class GenerationSourceCapture {
  readonly sources: SourceRow[] = [];
  readonly projections: [ProjectionRow, string | null][] = [];
  readonly selections: { purpose: string; value: PlainJson }[] = [];
  contextDelivery: PlainJson = null;
  writingContext: { intent: string; current_file: string } | null = null;

  private constructor(
    readonly hasRoot: boolean,
    readonly projectIdentitySha256: string | null,
    private readonly secrets: SecretContext,
  ) {}

  /**
   * `root` 是调用方已解析的项目根；`writingContextFile` 是已解析、位于项目内的当前文件相对路径
   * （解析不出时传 null，与 Python 解析失败时不建立 writing_context 一致）。
   */
  static async create(options: {
    root: string | null;
    platform: 'windows' | 'posix';
    secrets: SecretContext;
    writingContextFile?: string | null;
  }): Promise<GenerationSourceCapture> {
    const identity = options.root ? normcase(options.root, options.platform) : '';
    const capture = new GenerationSourceCapture(
      Boolean(options.root),
      identity ? await textSha256(identity) : null,
      options.secrets,
    );
    if (options.root && options.writingContextFile) {
      capture.writingContext = {
        intent: 'prose.continue',
        current_file: redactSensitiveText(options.writingContextFile, options.secrets),
      };
    }
    return capture;
  }

  async observe(purpose: string, relativePath: string | null, options: ObserveOptions = {}) {
    const { raw = null, text = null, complete = null, origin = 'project_file' } = options;
    let omissionReason = options.omissionReason ?? null;
    let relative: string | null = null;
    if (this.hasRoot && options.outsideProject) omissionReason = 'outside_project';
    else if (this.hasRoot) relative = relativePath;
    const byteHash = raw === null ? null : await sha256Hex(raw);
    const sourceId =
      'gsrc-' +
      (
        await textSha256(
          dumpJson([this.projectIdentitySha256, purpose, relative, byteHash, omissionReason]),
        )
      ).slice(0, 24);
    const textHash = text === null ? null : await textSha256(text);
    const row: SourceRow = {
      source_id: sourceId,
      purpose,
      relative_path: relative ? redactSensitiveText(relative, this.secrets) : null,
      selection_source: origin === 'project_file' ? 'independent_writer_read' : 'request_value',
      evidence_state:
        raw === null ? 'unavailable' : origin === 'project_file' ? 'observed' : 'unverified',
      source_complete: complete,
      observed_bytes: raw === null ? null : raw.length,
      observed_bytes_sha256: byteHash,
      file_bytes_sha256: complete && origin === 'project_file' ? byteHash : null,
      content_sha256: textHash !== null && complete ? textHash : null,
      observed_content_sha256: textHash,
      omission_reason: omissionReason,
    };
    if (this.sources.some((item) => item.source_id === sourceId)) return;
    if (this.sources.length >= MAX_SOURCE_REFS)
      throw new Error('生成来源证据超过预算，不能静默省略。');
    this.sources.push(row);
  }

  omit(purpose: string, relativePath: string, reason: string) {
    const relative = redactSensitiveText(this.hasRoot ? relativePath : '', this.secrets);
    for (const row of this.sources) {
      if (row.purpose === purpose && row.relative_path === relative) row.omission_reason = reason;
    }
  }

  select(purpose: string, value: PlainJson) {
    const row = { purpose, value: redactSensitive(value, this.secrets) };
    const encoded = dumpJson(row, { ensureAscii: false, sortKeys: true });
    if (
      this.selections.some(
        (item) => dumpJson(item, { ensureAscii: false, sortKeys: true }) === encoded,
      )
    )
      return;
    if (this.selections.length >= MAX_SOURCE_REFS)
      throw new Error('生成选择证据超过预算，不能静默省略。');
    this.selections.push(JSON.parse(JSON.stringify(row)));
  }

  project(purpose: string, text: string | null, options: ProjectOptions = {}) {
    const requested = options.sourcePurpose ?? purpose;
    const purposes = typeof requested === 'string' ? [requested] : requested;
    const ids = this.sources
      .filter((row) => purposes.includes(row.purpose) && row.omission_reason === null)
      .map((row) => row.source_id);
    const row: ProjectionRow = {
      purpose,
      source_ids: ids,
      requested_source_count: this.sources.filter((row) => purposes.includes(row.purpose)).length,
      selected_source_count: ids.length,
      channel: options.channel ?? 'system',
      truncated: options.truncated ?? false,
      omission_reason: options.omissionReason ?? null,
      source_span: options.sourceSpan ?? null,
      transformation: options.transformation ?? 'identity',
    };
    if (this.projections.length >= MAX_SOURCE_REFS)
      throw new Error('生成投影证据超过预算，不能静默省略。');
    this.projections.push([row, text]);
  }

  async continuation(
    content: string,
    anchorLine: number,
    tail: string,
    suffix: string,
    suffixLimit: number,
  ) {
    await this.observe('supplied_manuscript', null, {
      raw: new TextEncoder().encode(content),
      text: content,
      complete: true,
      origin: 'supplied_value',
    });
    const normalized = content.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    const prefix = lines.slice(0, anchorLine).join('\n');
    // Python str.rfind 以码点计位置；只在码点数组上做同样的查找。
    const prefixPoints = Array.from(prefix);
    const tailPoints = Array.from(tail);
    let start = 0;
    if (tail) {
      start = -1;
      for (let i = prefixPoints.length - tailPoints.length; i >= 0; i--) {
        if (tailPoints.every((char, j) => prefixPoints[i + j] === char)) {
          start = i;
          break;
        }
      }
    }
    this.project('current_tail', tail, {
      sourcePurpose: 'supplied_manuscript',
      channel: 'user',
      truncated: codePoints(prefix.replace(PYTHON_STRIP_NEWLINES, '')) > tailPoints.length,
      sourceSpan: {
        start,
        end: start + tailPoints.length,
        basis: 'normalized_supplied_text',
        unit: 'chars',
      },
      transformation: 'cursor_paragraph_tail_v1',
    });
    const remaining = lines.slice(anchorLine).join('\n');
    const suffixStart =
      lines.slice(0, anchorLine).reduce((sum, line) => sum + codePoints(line) + 1, 0) +
      codePoints(remaining) -
      codePoints(remaining.replace(/^\n+/, ''));
    const excerpt = Array.from(suffix).slice(0, suffixLimit).join('');
    this.project('current_suffix', excerpt, {
      sourcePurpose: 'supplied_manuscript',
      channel: 'user',
      truncated: codePoints(suffix) > suffixLimit,
      sourceSpan: excerpt
        ? {
            start: suffixStart,
            end: suffixStart + codePoints(excerpt),
            basis: 'normalized_supplied_text',
            unit: 'chars',
          }
        : null,
      transformation: 'cursor_readonly_suffix_v1',
    });
  }

  /** Pure final binding to the strings handed to the provider seam. */
  async manifest(systemPrompt: string, userPrompt: string): Promise<PlainJson> {
    const projections = [];
    for (const [row, text] of this.projections) {
      const prompt = row.channel === 'system' ? systemPrompt : userPrompt;
      const delivered = Boolean(text) && prompt.includes(text!);
      projections.push({
        ...row,
        delivered,
        delivered_chars: delivered ? codePoints(text!) : 0,
        delivered_source_count: delivered ? row.source_ids.length : 0,
        omitted_source_count: row.requested_source_count - (delivered ? row.source_ids.length : 0),
        excerpt_sha256: delivered ? await textSha256(text!) : null,
        omission_reason: row.omission_reason ?? (delivered ? null : 'not_in_final_request'),
      });
    }
    const observed = new Set(this.projections.map(([row]) => row.purpose));
    const evidence = {
      version: 'generation-sources-v1',
      delivery_boundary: 'writer_provider_seam',
      project_identity_sha256: this.projectIdentitySha256,
      request: {
        system_sha256: await textSha256(systemPrompt),
        user_sha256: await textSha256(userPrompt),
      },
      sources: this.sources,
      writing_context: this.writingContext,
      selections: this.selections,
      context_delivery: this.contextDelivery,
      projections,
      unobserved_purposes: ['author_instructions', 'canon_constraints', 'style_baseline'].filter(
        (purpose) => !observed.has(purpose),
      ),
    };
    const encoded = dumpJson(evidence, { ensureAscii: false, sortKeys: true });
    if (new TextEncoder().encode(encoded).length > MAX_MANIFEST_BYTES)
      throw new GenerationSourceBudgetError('生成来源证据超过字节预算，不能静默省略。');
    return JSON.parse(encoded);
  }

  /** observe_generation_selection：附带有序路径或章序的哈希。 */
  async selectWithHashes(
    purpose: string,
    value: { [key: string]: PlainJson },
    hashes: { orderedPaths?: readonly string[]; ordinals?: ReadonlyMap<string, number> } = {},
  ) {
    const selected: { [key: string]: PlainJson } = { ...value };
    if (hashes.orderedPaths !== undefined)
      selected.ordered_paths_sha256 = await selectionSha256(hashes.orderedPaths);
    if (hashes.ordinals !== undefined)
      selected.ordinals_sha256 = await selectionSha256(Object.fromEntries(hashes.ordinals));
    this.select(purpose, selected);
  }
}
